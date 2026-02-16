# WebSocket Streaming Implementation

This document describes the streaming capabilities added to the ts-signal-rpc library.

## Overview

The streaming implementation allows you to send `AsyncIterable` data (like generators or async iterators) over WebSocket connections. This is useful for:

- **Real-time data feeds**: Stock prices, sensor data, logs
- **Large dataset transfers**: Paginated results, database cursors
- **Progressive responses**: Search results, AI completions
- **Bidirectional streams**: Chat applications, collaborative editing

## Architecture

### Core Components

1. **StreamManager** (`shared/RpcStream.ts`)
   - Manages multiple concurrent streams over a single WebSocket
   - Handles backpressure to prevent memory issues
   - Multiplexes stream messages with regular RPC messages
   - Provides automatic cleanup on connection close

2. **Stream Message Protocol**
   ```typescript
   type StreamMessageType = "StreamData" | "StreamEnd" | "StreamError";

   interface StreamMessage {
     type: StreamMessageType;
     streamId: string;
     payload?: unknown;    // Present for StreamData
     error?: string;       // Present for StreamError
   }
   ```

3. **RpcPeer Integration**
   - `sendStream(iterable, streamId?)` - Send an AsyncIterable as a stream
   - `receiveStream<T>(streamId?)` - Create a ReadableStream to receive data
   - `abortStream(streamId)` - Cancel an active outgoing stream
   - `closeReceivingStream(streamId)` - Close an incoming stream

## Key Features

### 1. Backpressure Handling

The `StreamManager` monitors the WebSocket's `bufferedAmount` and automatically applies backpressure when the buffer gets full:

```typescript
const options: StreamOptions = {
  maxBufferedAmount: 1_048_576,  // 1MB default
  backpressureDelay: 10,         // 10ms delay when waiting
};

const manager = new StreamManager(options);
```

When `bufferedAmount` exceeds the threshold, the stream pauses until the buffer drains.

### 2. Multiplexing

Multiple streams can run concurrently over the same WebSocket connection. Each stream has a unique ID:

```typescript
// Server side - send multiple streams
const stream1 = peer.sendStream(dataFeed1());
const stream2 = peer.sendStream(dataFeed2());
const stream3 = peer.sendStream(dataFeed3());

// Client side - receive all three streams
const [id1, stream1] = peer.receiveStream();
const [id2, stream2] = peer.receiveStream();
const [id3, stream3] = peer.receiveStream();
```

### 3. Resource Cleanup

When the WebSocket connection closes, all active streams are automatically cleaned up:

- Outgoing streams are aborted and their iterators are closed
- Incoming streams are errored with "Connection closed"
- No memory leaks or dangling resources

### 4. Error Handling

Errors in stream iterators are automatically caught and sent as `StreamError` messages:

```typescript
async function* mayFail() {
  yield 1;
  yield 2;
  throw new Error("Something went wrong");
}

// Error is automatically propagated to receiver
await peer.sendStream(mayFail());
```

## Usage Example

### Basic Streaming

```typescript
import { RpcPeer } from "./shared/RpcPeer.ts";

// Server: Send a stream
async function* numberStream() {
  for (let i = 1; i <= 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    yield i;
  }
}

const streamId = await peer.sendStream(numberStream());

// Client: Receive the stream
const [streamId, stream] = peer.receiveStream<number>(streamId);

for await (const num of stream) {
  console.log("Received:", num);
}
```

### Coordinated Stream IDs

For request-response patterns, coordinate stream IDs:

```typescript
// Server: Handle stream request
peer.match(async (data) => {
  if (data.method === "requestData") {
    const streamId = crypto.randomUUID();

    // Start streaming in background
    peer.sendStream(dataFeed(), streamId);

    // Return stream ID to client
    return { streamId };
  }
});

// Client: Request and consume stream
const response = await peer.request({ method: "requestData" });
const [streamId, stream] = peer.receiveStream(response.data.streamId);

for await (const data of stream) {
  console.log("Received:", data);
}
```

### Early Termination

Streams can be aborted or closed early:

```typescript
// Abort outgoing stream
peer.abortStream(streamId);

// Close incoming stream
peer.closeReceivingStream(streamId);

// Or break from consumer loop
for await (const data of stream) {
  if (shouldStop(data)) {
    peer.closeReceivingStream(streamId);
    break;
  }
}
```

## Performance Considerations

### 1. Chunk Size

Larger chunks reduce overhead but increase latency. Find the right balance:

```typescript
// Small chunks - lower latency, more overhead
async function* smallChunks() {
  for (let i = 0; i < 1000; i++) {
    yield i;  // ~4 bytes per message
  }
}

// Larger chunks - less overhead, higher latency
async function* largerChunks() {
  const batch = [];
  for (let i = 0; i < 1000; i++) {
    batch.push(i);
    if (batch.length === 100) {
      yield batch;  // ~400 bytes per message
      batch.length = 0;
    }
  }
  if (batch.length > 0) yield batch;
}
```

### 2. Backpressure Tuning

Adjust backpressure settings based on your network and data rate:

```typescript
// High-throughput, reliable network
const fastOptions = {
  maxBufferedAmount: 16_777_216,  // 16MB
  backpressureDelay: 5,
};

// Low-bandwidth or unreliable network
const slowOptions = {
  maxBufferedAmount: 262_144,  // 256KB
  backpressureDelay: 50,
};
```

### 3. Memory Usage

Streams are memory-efficient because they don't buffer large amounts of data:

```typescript
// Bad: Load entire dataset into memory
const data = await loadAllData();
peer.send({ data });  // Sends all at once

// Good: Stream data incrementally
async function* streamData() {
  for await (const chunk of loadDataChunks()) {
    yield chunk;  // Memory is released as each chunk is sent
  }
}
peer.sendStream(streamData());
```

## Comparison with Alternatives

### vs. HTTP/2 Streams

**Advantages of WebSocket Streaming:**
- Single persistent connection (no handshake overhead)
- Full duplex (bidirectional streaming)
- Lower latency for initiating streams
- Works with WebSocket infrastructure

**Disadvantages:**
- Manual backpressure implementation
- No built-in flow control
- All streams share one connection

### vs. Server-Sent Events (SSE)

**Advantages of WebSocket Streaming:**
- Bidirectional (SSE is server-to-client only)
- Binary data support
- Better performance
- More flexible protocol

### vs. Regular RPC Messages

**When to use streaming:**
- Data size is large or unknown
- Data arrives gradually over time
- Need to process data before all arrives
- Want to show progress

**When to use regular RPC:**
- Data is small and fits in one message
- Need atomic request-response
- Simpler protocol is preferred

## Testing

The implementation includes comprehensive tests (`shared/RpcStream.test.ts`):

```bash
bun test shared/RpcStream.test.ts
```

Tests cover:
- Message schema validation
- Sending and receiving streams
- Backpressure handling
- Error propagation
- Stream multiplexing
- Resource cleanup
- Custom stream IDs

## Examples

See these files for working examples:

- **`example-stream-simple.ts`** - Basic StreamManager usage
- **`example-stream.ts`** - Full client-server example (needs Bun websocket fixes)

Run the simple example:
```bash
bun run example-stream-simple.ts
```

## Implementation Notes

### Design Decisions

1. **Stream IDs must be coordinated** - The sender and receiver must agree on the stream ID. This is typically done via an initial RPC request-response.

2. **ReadableStream for receiving** - We use the Web Streams API (`ReadableStream`) for incoming streams because it's standard, well-supported, and works with `for await...of`.

3. **No automatic buffering** - The `StreamManager` doesn't buffer data. If the receiver is slow, backpressure propagates to the sender.

4. **Separate from RPC messages** - Stream messages use a different schema than RPC messages, detected early in message handling.

### Limitations

1. **No ordering guarantees across streams** - If you send stream A then stream B, messages may arrive interleaved.

2. **No automatic reconnection** - If the WebSocket closes, all streams are terminated. (The underlying `RetrySocket` handles reconnection for the connection itself.)

3. **No resume capability** - If a stream is interrupted, you must start over.

## Future Enhancements

Possible improvements:

- **Automatic chunking** - Helper to batch small items into larger messages
- **Compression** - Optional compression for text data
- **Resume support** - Ability to resume interrupted streams
- **Stream priority** - Prioritize certain streams over others
- **Flow control** - Per-stream rate limiting
