# ts--rpc

This repo explores valid typed remote procedure calls (RPC) using WebSockets and TypeScript. It uses a relay server architecture where a "Service" and a "Client" communicate via a shared WebSocket topic.

## Usage Guide

This guide explains how to set up the system with your own types and logic.

### 1. Define your API Types

First, define the contracts for your requests and responses. It is best to use a **Discriminated Union** with a `type` field to distinguish between different actions.

Create a shared file (e.g., `shared/my-api-types.ts`):

```typescript
// Define request types
export type MyRequestApi =
  | { readonly type: "get-user"; readonly id: string }
  | { readonly type: "update-score"; readonly points: number }
  | { readonly type: "unknown" }; // Good practice to have a fallback

// Define response types
export type MyResponseApi =
  | { readonly type: "get-user"; readonly name: string; readonly age: number }
  | { readonly type: "update-score"; readonly newScore: number }
  | { readonly type: "error"; readonly message: string };
```

### 2. Start the Relay Server

You need a WebSocket server that acts as a relay (Pub/Sub). This library provides a `serve.ts` that handles this using Bun.

Run the server:

```bash
bun serve.ts
```

This starts a WebSocket server (defaulting to port 3000 or 8080 depending on env) that essentially broadcasts messages between connected parties on the same path (topic).

### 3. Create the Service (RPC Server)

The Service connects to the relay and listens for requests. It uses the `match` method to handle incoming requests and return responses.

Create `my-service.ts`:

```typescript
import { RpcPeer } from './shared/RpcPeer';
import type { MyRequestApi, MyResponseApi } from './shared/my-api-types';

// Connect to the Relay Server
const url = "ws://127.0.0.1:8080";
const rpc = RpcPeer.FromUrl<MyRequestApi, MyResponseApi>(url);

// Define your logic state
let currentScore = 0;
const database = { "1": { name: "Alice", age: 25 } };

// Listen and Match requests
rpc.match(async (request) => {
  console.log("Received request:", request);

  switch (request.type) {
    case "get-user":
      const user = database[request.id];
      if (user) {
        return { type: "get-user", ...user };
      }
      return { type: "error", message: "User not found" };

    case "update-score":
      currentScore += request.points;
      return { type: "update-score", newScore: currentScore };

    default:
      return { type: "error", message: "Unknown request type" };
  }
});

console.log("Service is running...");
```

Run it: `bun my-service.ts`

### 4. Create the Client

The Client connects to the same relay and sends requests using `.request()` (or its alias `.call()`). It gets a strongly-typed response back.

Create `my-client.ts`:

```typescript
import { RpcPeer } from './shared/RpcPeer';
import type { MyRequestApi, MyResponseApi } from './shared/my-api-types';

const url = "ws://127.0.0.1:8080";
const client = RpcPeer.FromUrl<MyRequestApi, MyResponseApi>(url);

// Wait for connection to be established
await client.waitForWelcome();

// Example 1: Update Score
const response = await client.request({
  type: "update-score",
  points: 10
});

// The actual response data is wrapped in a .data property
if (response.data.type === "update-score") {
  console.log("New Score:", response.data.newScore);
}

// Example 2: Get User
const userResponse = await client.request({
  type: "get-user",
  id: "1"
});

if (userResponse.data.type === "get-user") {
  console.log("User:", userResponse.data.name);
} else {
  // Typescript knows this must be the error case (or other cases)
  // assuming your union is exhaustive or you check for specific types
  // Note: userResponse.data type is strictly narrowed if possible,
  // but accessing properties usually requires checking the discriminator first.
  if (userResponse.data.type === "error") {
      console.error("Error:", userResponse.data.message);
  }
}
```

Run it: `bun my-client.ts`

## Architecture

This library uses a **relay server architecture** for peer-to-peer communication:

```
┌─────────┐          ┌─────────────┐          ┌─────────┐
│ Client  │ ◄───────► │ Relay Server│ ◄───────► │ Service │
│  (Peer) │  WebSocket│   (Hub)     │  WebSocket│  (Peer) │
└─────────┘           └─────────────┘            └─────────┘
```

### Message Routing

The relay server supports two routing modes:

1. **Direct Peer-to-Peer**: Messages with a `to` field are routed directly to the target peer by client ID
   ```typescript
   peer.request({ type: "ping" }, "target-client-id-456");
   ```

2. **Topic Broadcast**: Messages without a `to` field are broadcast to all subscribers on the topic
   ```typescript
   // Connects to topic "chat"
   const peer = RpcPeer.FromOptions({ url: "ws://server/chat", ... });
   peer.send({ type: "message", text: "Hello everyone!" });
   ```

### Connection Lifecycle

1. **Connect**: Client opens WebSocket to server
2. **Welcome**: Server assigns unique `clientId` and optional `sessionId`
3. **Ready**: Client can send/receive messages
4. **Reconnect**: `RetrySocket` automatically reconnects with exponential backoff
5. **Restore**: Using `sessionId` preserves identity across reconnections

### Key Components

- **RpcPeer**: Client-side WebSocket wrapper with RPC and streaming
- **RetrySocket**: Automatic reconnection with message queueing
- **StreamManager**: Multiplexes multiple streams over one connection
- **serve()**: Relay server with auth, rate limiting, and routing

## API Reference

### RpcPeer Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `FromOptions(options)` | Create a new peer with custom configuration | `RpcPeer` |
| `FromUrl(url)` | Create a new peer with default configuration | `RpcPeer` |
| `waitForWelcome(timeout?)` | Wait for server welcome message | `Promise<clientId>` |
| `request(data, to?, timeout?)` | Send request and wait for response | `Promise<RpcResponse>` |
| `send(data)` | Send one-way message (fire-and-forget) | `void` |
| `match(handler)` | Register auto-responder for incoming requests | `void` |
| `respondTo(request, data)` | Send response to a specific request | `void` |
| `sendStream(iterable, id?)` | Send AsyncIterable as stream | `Promise<streamId>` |
| `receiveStream(id?)` | Create receiving stream | `[streamId, ReadableStream]` |
| `abortStream(id)` | Abort outgoing stream | `void` |
| `close(code?, reason?, timeout?)` | Gracefully close connection | `Promise<void>` |
| `dispose()` | Clean up all resources | `Promise<void>` |

### RpcPeerFromOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | required | WebSocket URL (ws:// or wss://) |
| `name` | string | "RpcPeer" | Display name for this peer |
| `requestSchema` | z.Schema | undefined | Zod schema for request validation |
| `responseSchema` | z.Schema | undefined | Zod schema for response validation |
| `sessionId` | string | undefined | Session ID for reconnection |
| `enableHeartbeat` | boolean | false | Enable automatic heartbeat pings |
| `heartbeatInterval` | number | 30000 | Heartbeat interval in milliseconds |

### ServeOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hostname` | string | "localhost" | Hostname to bind to |
| `port` | number | 3000 | Port to listen on |
| `authValidator` | AuthValidator | NoAuthValidator | Authentication validator |
| `authRules` | AuthorizationRules | DefaultAuthorizationRules | Authorization rules |
| `enableRateLimit` | boolean | true | Enable per-user rate limiting |
| `maxMessageSize` | number | 1048576 | Maximum message size in bytes (1MB) |
| `enableSessionPersistence` | boolean | true | Enable session restoration |

### Authorization Classes

| Class | Description | Use Case |
|-------|-------------|----------|
| `NoAuthValidator` | Allows all connections | Development, public servers |
| `SimpleAuthValidator` | Token-based authentication | Simple apps with static tokens |
| `DefaultAuthorizationRules` | Permissive rules (allows all) | Development |
| `StrictAuthorizationRules` | Role-based access control | Production with fine-grained control |

## Example Provided

The repository comes with a built-in example:

1. **Relay**: `bun serve.ts`
2. **Service**: `bun runner.ts` (Handles `score`, `greet`, `game` requests)
3. **Client**: `bun client.ts` (Sends requests to the service)

## Advanced Features

### Authentication & Authorization

The server supports token-based authentication and fine-grained authorization:

```typescript
import { serve } from "./serve.ts";
import { SimpleAuthValidator, StrictAuthorizationRules } from "./shared/Auth.ts";

// Set up authentication
const authValidator = new SimpleAuthValidator();
authValidator.addToken("secret-token", "user123");

// Configure authorization rules
const authRules = new StrictAuthorizationRules(
  ["admin"],  // Admin users
  new Map([
    ["chat", new Set(["user123", "admin"])],  // Who can access topics
  ])
);

const server = serve({
  authValidator,
  authRules,
  enableRateLimit: true,
  maxMessageSize: 1024 * 1024,  // 1MB max
});
```

Clients authenticate with tokens:
```typescript
const client = RpcPeer.FromOptions({
  url: "ws://localhost:3000/chat?token=secret-token",
  // ...
});
```

### Session Persistence

Clients can restore their identity after reconnection:

```typescript
// First connection - save session ID
client.addEventListener("welcome", (ev) => {
  localStorage.setItem("sessionId", ev.detail.sessionId);
});

// Reconnect with same session
const sessionId = localStorage.getItem("sessionId");
const client = RpcPeer.FromOptions({
  sessionId,  // Restores previous clientId
  url: "ws://localhost:3000/chat",
});
```

### Heartbeat / Keep-Alive

Enable automatic heartbeat to detect zombie connections:

```typescript
const client = RpcPeer.FromOptions({
  url: "ws://localhost:3000/chat",
  enableHeartbeat: true,
  heartbeatInterval: 30000,  // 30 seconds
});
```

### Rate Limiting & Resource Limits

Built-in protection against abuse:
- Message size limits (default: 1MB)
- Rate limiting per user (token bucket algorithm)
- Automatic cleanup on disconnect

See [examples/authorization.ts](examples/authorization.ts) for complete demonstration.

## Streaming

The library supports bidirectional streaming for efficient transmission of large datasets or real-time updates.

### Sending a Stream

Send an `AsyncIterable` as a stream:

```typescript
async function* generateData() {
  for (let i = 0; i < 100; i++) {
    yield { count: i, timestamp: Date.now() };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const streamId = await peer.sendStream(generateData());
console.log(`Stream ${streamId} started`);
```

### Receiving a Stream

Create a receiving stream and process incoming data:

```typescript
const [streamId, stream] = peer.receiveStream<{count: number; timestamp: number}>();

// Send the streamId to the remote peer so they know where to send data

for await (const data of stream) {
  console.log(`Received: count=${data.count}, time=${data.timestamp}`);
}
```

### Bidirectional Streaming

Both peers can send and receive simultaneously:

```typescript
// Peer A: Send and receive
const [receiveId, receiveStream] = peerA.receiveStream();
// Tell peer B about receiveId...

const sendStreamId = await peerA.sendStream(generateData());
// Process incoming stream
for await (const data of receiveStream) {
  console.log('Received from B:', data);
}
```

Streams automatically handle:
- **Backpressure**: Pauses sending when buffer is full
- **Error handling**: Propagates errors across the network
- **Cleanup**: Aborts on disconnect or error
- **Multiplexing**: Multiple streams over one WebSocket

See [examples/stream.ts](examples/stream.ts) and [examples/StreamSimple.ts](examples/StreamSimple.ts) for complete examples.
