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
| `development` | boolean | false | Enable development mode with additional logging |
| `hot` | boolean | false | Enable hot module reloading (Bun-specific) |
| `logger` | typeof console | console | Custom logger instance |
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

### StreamManager

The `StreamManager` class handles bidirectional streaming over WebSocket connections with multiple concurrent streams.

| Method | Description | Returns |
|--------|-------------|---------|
| `FromOptions(options?)` | Create StreamManager with custom configuration | `StreamManager` |
| `sendStream(ws, iterable, id?)` | Send AsyncIterable as stream over WebSocket | `Promise<streamId>` |
| `createReceivingStream(id?)` | Create ReadableStream for incoming data | `[streamId, ReadableStream]` |
| `handleStreamMessage(message)` | Process incoming stream message | `boolean` |
| `abort(streamId)` | Abort an active outgoing stream | `void` |
| `closeReceivingStream(streamId)` | Close a receiving stream | `void` |
| `cleanup()` | Clean up all active streams on disconnect | `void` |
| `activeStreamCount` | Number of active outgoing streams | `number` |
| `receivingStreamCount` | Number of active receiving streams | `number` |

**StreamManagerOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxBufferedAmount` | number | 1048576 | Maximum buffer size (1MB) before applying backpressure |
| `backpressureDelay` | number | 10 | Delay in ms when waiting for buffer to drain |

### WebSocketCloseCodes

Standard WebSocket close codes and utilities from RFC 6455.

**Close Code Constants:**

| Constant | Code | Description | Can Reconnect |
|----------|------|-------------|---------------|
| `WS_CLOSE_NORMAL` | 1000 | Normal closure | No |
| `WS_CLOSE_GOING_AWAY` | 1001 | Endpoint going away (server shutdown) | Yes |
| `WS_CLOSE_PROTOCOL_ERROR` | 1002 | Protocol error detected | No |
| `WS_CLOSE_UNSUPPORTED` | 1003 | Unsupported data type received | No |
| `WS_CLOSE_NO_STATUS` | 1005 | No status code present (reserved) | No |
| `WS_CLOSE_ABNORMAL` | 1006 | Abnormal closure (reserved) | Yes |
| `WS_CLOSE_INVALID_DATA` | 1007 | Invalid frame payload data | No |
| `WS_CLOSE_POLICY_VIOLATION` | 1008 | Policy violation | No |
| `WS_CLOSE_MESSAGE_TOO_BIG` | 1009 | Message too large | No |
| `WS_CLOSE_MANDATORY_EXTENSION` | 1010 | Required extension not negotiated | No |
| `WS_CLOSE_INTERNAL_ERROR` | 1011 | Internal server error | Yes |
| `WS_CLOSE_SERVICE_RESTART` | 1012 | Service restarting | Yes |
| `WS_CLOSE_TRY_AGAIN_LATER` | 1013 | Server overloaded | Yes |
| `WS_CLOSE_BAD_GATEWAY` | 1014 | Bad gateway or proxy error | Yes |
| `WS_CLOSE_TLS_HANDSHAKE` | 1015 | TLS handshake failure (reserved) | No |

**Utility Functions:**

| Function | Description | Returns |
|----------|-------------|---------|
| `isReservedCloseCode(code)` | Check if close code is reserved | `boolean` |
| `canReconnect(code)` | Check if client should reconnect for this code | `boolean` |
| `getCloseCodeDescription(code)` | Get human-readable description | `string` |

**Example:**
```typescript
import { WS_CLOSE_GOING_AWAY, canReconnect, getCloseCodeDescription } from "./shared/WebSocketCloseCodes.ts";

socket.addEventListener("close", (event) => {
  console.log(`Closed: ${getCloseCodeDescription(event.code)}`);

  if (canReconnect(event.code)) {
    console.log("Reconnecting...");
    setTimeout(() => connect(), 1000);
  }
});
```

## Example Provided

The repository comes with a built-in example:

1. **Relay**: `bun serve.ts`
2. **Service**: `bun runner.ts` (Handles `score`, `greet`, `game` requests)
3. **Client**: `bun client.ts` (Sends requests to the service)

## Advanced Features

### Authentication & Authorization

The server supports token-based authentication and fine-grained authorization:

```typescript
import { serve } from "./examples/serve.ts";
import { SimpleAuthValidator, StrictAuthorizationRules } from "./shared/Authorization.ts";

// Set up authentication
const authValidator = SimpleAuthValidator.FromTokens({
  "secret-token": "user123",
});

// Configure authorization rules
const authRules = StrictAuthorizationRules.FromOptions({
  adminUsers: ["admin"],
  topicPermissions: {
    chat: ["user123", "admin"],  // Who can access topics
  },
});

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
- **Backpressure**: Pauses sending when buffer is full (default: 1MB buffer)
- **Error handling**: Propagates errors across the network
- **Cleanup**: Aborts on disconnect or error
- **Multiplexing**: Multiple streams over one WebSocket

See [examples/stream.ts](examples/stream.ts) and [examples/StreamSimple.ts](examples/StreamSimple.ts) for complete examples.

## Troubleshooting

### Common Issues

**Connection Refused / Cannot Connect**
- Verify server is running and listening on correct port
- Check firewall settings allow WebSocket connections
- Ensure URL scheme matches (ws:// for HTTP, wss:// for HTTPS)
- Verify CORS settings if connecting from browser

**Messages Not Being Received**
- Check that topic names match between server and client
- Verify authentication tokens are valid
- Ensure message size doesn't exceed `maxMessageSize` limit
- Check for authorization rules blocking the message

**Reconnection Loops**
- Check server logs for authentication failures
- Verify `RetrySocket` configuration (max retries, backoff settings)
- Look for `WS_CLOSE_POLICY_VIOLATION` or other error close codes
- Ensure server isn't immediately rejecting reconnection attempts

**Stream Not Completing**
- Verify both ends are using matching stream IDs
- Check for network issues causing buffer backpressure
- Ensure stream cleanup is called on disconnect
- Look for unhandled promise rejections in stream iterators

**High Memory Usage**
- Reduce `maxBufferedAmount` for slower networks
- Implement proper stream backpressure handling
- Check for message loops or recursive sends
- Monitor `activeStreamCount` and `receivingStreamCount`

### Debug Mode

Enable development mode for detailed logging:

```typescript
const server = serve({
  development: true,  // Enable debug logging
  logger: console,    // Or use custom logger
});
```

## Security Best Practices

### Token Storage
- **Never** embed tokens directly in client-side code
- Store tokens in secure storage (httpOnly cookies, localStorage with encryption)
- Use short-lived tokens with refresh mechanism
- Rotate tokens periodically

```typescript
// ❌ BAD - Token in source code
const peer = RpcPeer.FromOptions({
  url: "ws://server/chat?token=hardcoded-secret"
});

// ✅ GOOD - Token from secure storage
const token = await getSecureToken();
const peer = RpcPeer.FromOptions({
  url: `ws://server/chat?token=${encodeURIComponent(token)}`
});
```

### Rate Limiting Configuration

Tune rate limits based on user roles and application needs:

```typescript
import { RateLimiter } from "./shared/Authorization.ts";

// Conservative limits for public users
const publicLimiter = RateLimiter.FromOptions({
  capacity: 10,     // Burst size
  refillRate: 10,   // Tokens per second
});

// Higher limits for authenticated users
const userLimiter = RateLimiter.FromOptions({
  capacity: 100,
  refillRate: 100,
});

// Very high limits for admin users
const adminLimiter = RateLimiter.FromOptions({
  capacity: 1000,
  refillRate: 1000,
});
```

### Input Validation

Always validate incoming messages with Zod schemas:

```typescript
import { z } from "zod";

const messageSchema = z.object({
  type: z.literal("message"),
  text: z.string().max(1000),  // Limit message length
  timestamp: z.number().int().positive(),
});

const peer = RpcPeer.FromOptions({
  url: "ws://server/chat",
  requestSchema: messageSchema,  // Auto-validates all incoming messages
});
```

### Authorization Best Practices

- Use `StrictAuthorizationRules` in production
- Implement principle of least privilege
- Regularly audit authorization rules
- Log authorization failures for security monitoring

```typescript
const authRules = StrictAuthorizationRules.FromOptions({
  adminUsers: ["admin", "moderator"],
  topicPermissions: {
    "public-chat": ["*"],  // Everyone
    "admin-chat": ["admin"],  // Admin only
    "mod-chat": ["admin", "moderator"],  // Admin and moderators
  },
});
```

## Performance Tuning

### Buffer Size Configuration

Adjust buffer sizes based on network conditions:

```typescript
// Fast, reliable network - larger buffers
const streamManager = StreamManager.FromOptions({
  maxBufferedAmount: 5 * 1024 * 1024,  // 5MB
  backpressureDelay: 5,  // Check every 5ms
});

// Slow or unreliable network - smaller buffers
const streamManager = StreamManager.FromOptions({
  maxBufferedAmount: 512 * 1024,  // 512KB
  backpressureDelay: 50,  // Check every 50ms
});
```

### Heartbeat Configuration

Balance between connection reliability and network overhead:

```typescript
// High reliability - frequent heartbeats (more overhead)
const peer = RpcPeer.FromOptions({
  enableHeartbeat: true,
  heartbeatInterval: 10000,  // 10 seconds
});

// Low overhead - infrequent heartbeats (may miss disconnects)
const peer = RpcPeer.FromOptions({
  enableHeartbeat: true,
  heartbeatInterval: 60000,  // 60 seconds
});
```

### Message Size Limits

Set appropriate limits based on your use case:

```typescript
const server = serve({
  maxMessageSize: 10 * 1024,  // 10KB for chat messages
  // maxMessageSize: 1024 * 1024,  // 1MB for file transfers
  // maxMessageSize: 10 * 1024 * 1024,  // 10MB for large data
});
```

### Connection Pooling

Reuse connections when possible:

```typescript
// ❌ BAD - Creating new connection for each request
async function sendMessage(text: string) {
  const peer = RpcPeer.FromUrl("ws://server/chat");
  await peer.send({ text });
  await peer.close();
}

// ✅ GOOD - Reuse single connection
const peer = RpcPeer.FromUrl("ws://server/chat");

async function sendMessage(text: string) {
  await peer.send({ text });
}
```

## Browser Compatibility

### WebSocket Support

ts-rpc requires native WebSocket support (available in all modern browsers):

- ✅ Chrome/Edge 16+
- ✅ Firefox 11+
- ✅ Safari 7+
- ✅ Opera 12.1+
- ✅ iOS Safari 7.1+
- ✅ Android Browser 4.4+

### Polyfills

For older browsers, use a WebSocket polyfill:

```html
<!-- Include before your application -->
<script src="https://cdn.jsdelivr.net/npm/websocket-polyfill@0.0.3/index.js"></script>
```

### Browser-Specific Considerations

**Safari:**
- May close idle connections after ~60 seconds - use heartbeat to keep alive
- Stricter Content Security Policy - ensure WebSocket URLs are allowed

**Mobile Browsers:**
- Connections may close when app goes to background
- Use session persistence to restore state on foreground
- Consider implementing application-level message queuing

**All Browsers:**
- Maximum message size may be limited by browser (typically 1-10MB)
- WebSocket connections count toward browser connection limits
- Use a single connection when possible instead of multiple

### HTTPS / WSS

When serving over HTTPS, use secure WebSocket (wss://):

```typescript
// Development (HTTP)
const peer = RpcPeer.FromUrl("ws://localhost:3000/chat");

// Production (HTTPS) - MUST use wss://
const peer = RpcPeer.FromUrl("wss://example.com/chat");
```

Browsers will block `ws://` connections from `https://` pages for security.

## Deployment

### Production Checklist

- [ ] Use `wss://` for secure connections
- [ ] Enable authentication with `SimpleAuthValidator` or custom validator
- [ ] Configure `StrictAuthorizationRules` for access control
- [ ] Enable rate limiting with appropriate limits
- [ ] Set reasonable `maxMessageSize` limits
- [ ] Configure heartbeat for connection health monitoring
- [ ] Implement proper error handling and logging
- [ ] Set up connection monitoring and alerts
- [ ] Test reconnection behavior under network failures
- [ ] Configure CORS if serving from different origin
- [ ] Use environment variables for configuration
- [ ] Implement graceful shutdown handling

### Environment Variables

```typescript
import { serve } from "./examples/serve.ts";

const server = serve({
  hostname: process.env.WS_HOSTNAME || "localhost",
  port: Number(process.env.WS_PORT) || 3000,
  development: process.env.NODE_ENV === "development",
  maxMessageSize: Number(process.env.MAX_MESSAGE_SIZE) || 1024 * 1024,
});
```

### Monitoring

Track key metrics in production:

- Active connection count
- Message throughput (messages/second)
- Average message size
- Stream count and buffer utilization
- Authentication failure rate
- Rate limit violations
- Connection error rates by close code
