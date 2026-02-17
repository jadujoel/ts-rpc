# ts--rpc Demo Applications

Interactive React applications demonstrating the features of **ts--rpc** - a TypeScript WebSocket RPC library with relay server architecture.

## 🎯 Available Demos

### 1. Chat App - Multi-User Messaging
**Location:** [apps/chat/](chat/)
**Port:** 8080 (WebSocket server)
**Features:**
- Topic-based broadcast messaging
- Real-time multi-user chat room
- User presence tracking
- Message history
- Auto-scrolling chat interface

**What it demonstrates:**
- `RpcPeer` basic usage with `.send()` and `.match()`
- Topic subscription patterns
- Broadcast messaging (messages without `to` field)
- Welcome message handling with `waitForWelcome()`
- Zod schema validation

**Run:**
```bash
cd apps/chat
bun install
bun run dev
```

The client will be served via Bun. Open the provided URL in multiple browser windows to chat between them.

---

### 2. Auth App - Authentication & Authorization
**Location:** [apps/auth/](auth/)
**Port:** 8081 (WebSocket server)
**Features:**
- Token-based authentication
- Role-based authorization (Admin vs User)
- Protected actions requiring auth
- Admin-only operations
- Rate limiting per role
- Session profile display

**What it demonstrates:**
- `SimpleAuthValidator` with token validation
- `StrictAuthorizationRules` with role-based access control
- Different rate limits per user type (admin: 1000 msg/s, user: 100 msg/s)
- Authorization failures and error handling
- Authentication headers in WebSocket upgrade

**Valid Tokens:**
- `admin-token` - Admin user (full access)
- `user-token` - Regular user (protected actions only)
- `demo-token` - Demo user (protected actions only)
- `invalid-token` - Will fail authentication

**Run:**
```bash
cd apps/auth
bun install
bun run dev
```

The client will be served via Bun. Open the provided URL and try different tokens to see authorization in action.

---

### 3. P2P App - Peer-to-Peer Messaging
**Location:** [apps/p2p/](p2p/)
**Port:** 8082 (WebSocket server)
**Features:**
- Direct peer-to-peer messaging
- Broadcast messaging to all peers
- Live peer directory
- Message routing modes
- Real-time peer discovery

**What it demonstrates:**
- Direct messaging using `to` field for targeted delivery
- Broadcast vs peer-to-peer message routing
- `.request()` for request-response patterns
- Client ID management
- Peer discovery patterns

**Run:**
```bash
cd apps/p2p
bun install
bun run dev
```

The client will be served via Bun. Open the provided URL in multiple windows and send direct messages between specific peers or broadcast to all.

---

## 🚀 Quick Start

### Install Dependencies
```bash
# From apps/ directory
bun install
```

### Run All Demos Simultaneously
```bash
# From apps/ directory
bun run dev
```

This uses Bun workspaces to start all three demos on different ports. Each demo will output its URL when started. Open the URLs in your browser.

### Run Individual Demos
```bash
# Navigate to specific app directory
cd apps/chat
bun install
bun run dev

# Or for auth
cd apps/auth
bun install
bun run dev

# Or for p2p
cd apps/p2p
bun install
bun run dev
```

### Build All Demos
```bash
# From apps/ directory
bun run build
```

### Type Check All Demos
```bash
# From apps/ directory
bun run validate
```

---

## 📁 Project Structure

```
apps/
├── chat/              # Chat room demo
│   ├── client/        # React frontend
│   │   ├── App.tsx
│   │   ├── index.tsx
│   │   ├── style.css
│   │   └── index.html
│   ├── server/        # Bun WebSocket server
│   │   └── index.ts
│   ├── shared/        # Shared schemas
│   │   └── schema.ts
│   └── package.json
│
├── auth/              # Authentication demo
│   ├── client/
│   ├── server/
│   ├── shared/
│   └── package.json
│
├── p2p/               # Peer-to-peer demo
│   ├── client/
│   ├── server/
│   ├── shared/
│   └── package.json
│
├── shared/            # Common utilities
│   ├── useRpcPeer.ts  # React hook for RPC peer
│   ├── types.ts       # Shared TypeScript types
│   └── logger.ts      # Logging utility
│
├── package.json       # Root orchestration
└── README.md          # This file
```

---

## 🛠 Technology Stack

- **Runtime:** [Bun](https://bun.sh) - Fast JavaScript runtime with native WebSocket support
- **Frontend:** [React 18](https://react.dev) - UI library
- **Bundler:** Bun's native bundler (no Vite needed!)
- **Validation:** [Zod](https://zod.dev) - TypeScript-first schema validation
- **RPC Library:** ts--rpc (from parent directory)

---

## 🧩 Shared Utilities

### `useRpcPeer` Hook
React hook for managing RPC peer connections with automatic state management.

```tsx
import { useRpcPeer } from "../shared/useRpcPeer.ts";

const { peer, connectionState, clientId, connect, disconnect } = useRpcPeer({
  url: "ws://localhost:8080",
  requestSchema: RequestSchema,
  responseSchema: ResponseSchema,
  autoConnect: true
});
```

### Common Types
Shared TypeScript interfaces used across all apps:
- `User` - User information with ID, name, and role
- `Message` - Message structure with metadata

---

## 💡 Key Concepts Demonstrated

### 1. Message Routing
- **Broadcast:** Omit `to` field → all topic subscribers receive
- **Direct:** Include `to` field → only specific client receives

### 2. Request/Response Patterns
- `.send()` - Fire-and-forget message
- `.call()` - Send request, await response
- `.request()` - Send to specific peer with `to` parameter
- `.match()` - Auto-respond to incoming requests

### 3. Connection Management
- `waitForWelcome()` - Wait for server to assign client ID
- Connection state tracking (disconnected → connecting → connected)
- Automatic client ID assignment

### 4. Schema Validation
- All messages validated with Zod schemas
- Discriminated unions for type-safe message handling
- Type inference from schemas

### 5. Authentication Flow
1. Client sends token in query parameter or header
2. Server validates with `AuthValidator`
3. Server checks permissions with `AuthorizationRules`
4. WebSocket upgrade if authorized

---

## 🎨 UI Features

Each demo includes:
- ✅ Real-time connection status indicator
- ✅ Client ID display
- ✅ Clean, modern UI with gradients
- ✅ Responsive design
- ✅ Auto-scrolling message lists
- ✅ Keyboard shortcuts (Enter to send)
- ✅ Activity logs and feedback

---

## 🔧 Development

### Prerequisites
- [Bun](https://bun.sh) v1.0+
- Modern browser with WebSocket support

### Install Dependencies
```bash
cd apps/chat && bun install
cd apps/auth && bun install
cd apps/p2p && bun install
```

### Development Mode
Each app runs with:
- **Hot reload** for client code (Bun's `--hot` flag)
- **TypeScript compilation** on the fly
- **Concurrent server and client** via `&` in npm scripts

### Build for Production
```bash
# Build all apps
bun run build:all

# Or individually
cd apps/chat && bun run build
```

---

## 📚 Related Documentation

- [Main README](../README.md) - Library documentation
- [Examples](../examples/) - CLI examples
- [Shared Code](../shared/) - Core library implementation
- [API Docs](../api/) - API reference

---

## 🤝 Contributing

These demos are part of the ts--rpc library. To contribute:

1. Fork the repository
2. Create a feature branch
3. Add or improve demos
4. Test thoroughly (open multiple browser windows!)
5. Submit a pull request

---

## 📝 License

Same as ts--rpc library. See [../LICENSE](../LICENSE).

---

## 🎓 Learning Path

**Recommended order:**
1. **Chat** - Start here for basic RPC concepts
2. **P2P** - Learn message routing patterns
3. **Auth** - Understand security and authorization

Each app builds on concepts from the previous one while remaining self-contained.

---

## 🐛 Troubleshooting

### Port Already in Use
If you see "Address already in use", stop other services:
```bash
# Find process using port
lsof -ti:8080 | xargs kill -9  # Or 8081, 8082
```

### Connection Failed
- Ensure server is running before opening client
- Check console for error messages
- Verify WebSocket URL matches server port

### Hot Reload Not Working
- Restart dev server
- Clear browser cache
- Check Bun version: `bun --version`

---

## 💬 Feedback

Found a bug? Have an idea for improvement?
Open an issue on the main repository!

---

**Happy coding! 🚀**
