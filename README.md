# ts-signal-rpc

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
import { Socket } from './shared/socket';
import type { MyRequestApi, MyResponseApi } from './shared/my-api-types';

// Connect to the Relay Server
const url = "ws://127.0.0.1:8080";
const rpc = Socket.fromUrl<MyRequestApi, MyResponseApi>(url);

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

The Client connects to the same relay and sends requests using `.call()`. It gets a strongly-typed response back.

Create `my-client.ts`:

```typescript
import { Socket } from './shared/socket';
import type { MyRequestApi, MyResponseApi } from './shared/my-api-types';

const url = "ws://127.0.0.1:8080";
const client = Socket.fromUrl<MyRequestApi, MyResponseApi>(url);

// Example 1: Update Score
const response = await client.call({
  type: "update-score",
  points: 10
});

// The actual response data is wrapped in a .data property
if (response.data.type === "update-score") {
  console.log("New Score:", response.data.newScore);
}

// Example 2: Get User
const userResponse = await client.call({
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

## Example Provided

The repository comes with a built-in example:

1. **Relay**: `bun serve.ts`
2. **Service**: `bun runner.ts` (Handles `score`, `greet`, `game` requests)
3. **Client**: `bun client.ts` (Sends requests to the service)
