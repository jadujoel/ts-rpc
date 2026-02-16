
## RPC Library Architectural Assessment

### 1. Core Communication & Patterns

* **Request-Response Lifecycle:** How does the library correlate a specific response to its original request? Does it use a `nonce` or `id` system to allow `async/await` syntax on the client?
* **Push/Subscription Model:** Does the library support "Server-Sent Events" over the WebSocket? Can a client subscribe to a specific topic and receive updates indefinitely?
* **Streaming:** Does the library support streaming data (e.g., `AsyncIterable`) for large datasets or real-time logs?
* **Message Ordering:** Does the library guarantee that messages are processed in the order they were sent, or is it concurrent/out-of-order?

### 2. TypeScript & DX (Developer Experience)

* **End-to-End Type Safety:** Can the client infer the full API schema (methods, arguments, and return types) without a manual build step or code generation?
* **Autocomplete & Discovery:** Does the library provide IDE intellisense for available methods once the server's type is imported?
* **Error Serialization:** When an error occurs on the server, is it caught and transmitted as a structured object, or does it simply crash the socket? Does the client receive the original stack trace or a custom error code?
* **Zero-Config Handshake:** How much boilerplate is required to connect? Can it automatically handle JSON parsing/stringifying?

### 3. Connection & State Management

* **Heartbeats & Ghosting:** How does the library handle "zombie" connections? Does it utilize Bun’s native `pong` frames to ensure the peer is actually alive?
* **Reconnection Logic:** When a client reconnects, does the library provide a way to "resume" a session or must the client re-authenticate and re-subscribe to all topics?
* **Backpressure:** Since Bun is extremely fast, how does the library handle a slow client that can't keep up with the server's message rate? Does it expose `ws.getBufferedAmount()`?
* **Middleware:** Can developers intercept messages (e.g., for logging or auth) before they reach the RPC handler?

### 4. Addressing & Routing

* **Peer-to-Peer Targeting:** Does the library maintain an internal registry of "User IDs" mapped to "Socket IDs" to allow one peer to message another directly through the server?
* **Pub/Sub Efficiency:** Does it leverage Bun’s native `ws.subscribe(topic)` and `server.publish(topic, data)` for broadcasting, or does it manually loop through an array of sockets (which is slower)?
* **Namespacing:** Can you separate logic into different "routers" or namespaces (e.g., `/chat` vs `/admin`)?

### 5. Security & Validation

* **Input Sanitization:** Does the library integrate with validation tools like **Zod** or **TypeBox** to ensure incoming WebSocket messages match the expected schema before they reach the logic?
* **Authentication Handshake:** Does it support validating headers or cookies during the initial HTTP `upgrade` to WebSockets?
* **Rate Limiting:** Is there a built-in mechanism to prevent a single client from flooding the RPC with requests?

### 6. Scalability & Performance

* **Serialization Overhead:** Does the library support binary formats (MsgPack, CBOR) to reduce payload size, or is it locked to `JSON.stringify`?
* **Memory Footprint:** How does the library clean up listeners and references when a socket closes to prevent memory leaks in the Bun runtime?
* **Distributed State:** If you run multiple instances of your Bun server, how does the library handle "Targeted Peer Messaging"? (e.g., Does it support a Redis adapter for cross-server communication?)

---

### Implementation Matrix

You can use this table to track your library's progress:

| Feature | Status | Implementation Detail |
| --- | --- | --- |
| **Type Inference** | ⚪ | e.g., `Client<typeof serverRouter>` |
| **Auto-Reconnect** | ⚪ | Exponential backoff? |
| **Validation** | ⚪ | Integrated with Zod/TypeBox? |
| **Bun Publish** | ⚪ | Using `server.publish()`? |
| **Request ID** | ⚪ | Mapping IDs to Promises? |
