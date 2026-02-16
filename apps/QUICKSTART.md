# Quick Start Guide

## Installation Complete! ✅

All three demo applications have been created:

### 📁 Project Structure
```
apps/
├── chat/          # Multi-user chat room
├── auth/          # Authentication & authorization
├── p2p/           # Peer-to-peer messaging
├── shared/        # React hooks and utilities
├── package.json   # Root orchestration
└── README.md      # Full documentation
```

## 🚀 Running the Demos

### Option 1: Run Individual Apps

```bash
# Chat Demo (WebSocket on :8080)
cd apps/chat
bun install
bun run dev

# Auth Demo (WebSocket on :8081)
cd apps/auth
bun install
bun run dev

# P2P Demo (WebSocket on :8082)
cd apps/p2p
bun install
bun run dev
```

### Option 2: Run All Apps at Once

```bash
cd apps
bun run install:all
bun run dev:all
```

## 🧪 Testing the Apps

### Chat App
1. Run `cd apps/chat && bun run dev`
2. Open the URL shown in your browser (Bun will display it)
3. Enter a username and join
4. Open the same URL in another browser window
5. Chat between windows!

### Auth App
1. Run `cd apps/auth && bun run dev`
2. Open the URL in your browser
3. Try different tokens:
   - `admin-token` - Full access (admin)
   - `user-token` - Limited access (user)
   - `demo-token` - Limited access (user)
   - `invalid-token` - Will fail auth
4. Test protected and admin actions

### P2P App
1. Run `cd apps/p2p && bun run dev`
2. Open URL in multiple windows
3. Each window gets a unique peer ID
4. Try both message modes:
   - **Direct**: Select a peer, send private message
   - **Broadcast**: Send to all peers at once

## 📝 What Each Demo Shows

| App | Key Feature | Core API Demonstrated |
|-----|------------|---------------------|
| **Chat** | Topic broadcast | `.send()`, `.match()`, topic subscription |
| **Auth** | Security | `SimpleAuthValidator`, `StrictAuthorizationRules` |
| **P2P** | Routing modes | `.request()` with `to` field, peer discovery |

## 💡 Key Concepts

### Message Routing
- **No `to` field** → Broadcast to all topic subscribers
- **With `to` field** → Direct to specific peer

### RPC Patterns
- `.send()` - Fire and forget
- `.call()` - Request/response
- `.request(data, peerId)` - Direct to specific peer
- `.match()` - Auto-respond to incoming messages

### Connection Lifecycle
1. Connect to WebSocket
2. Receive `welcome` message with client ID
3. `await peer.waitForWelcome()`
4. Start sending/receiving messages

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill process using port 8080 (or 8081, 8082)
lsof -ti:8080 | xargs kill -9
```

### Dependencies Not Found
```bash
cd apps/chat && bun install
cd apps/auth && bun install
cd apps/p2p && bun install
```

### TypeScript Errors
The minor linting errors (unused variables, button types) won't prevent the apps from running. Bun will run them successfully.

## 🎯 Next Steps

1. **Explore the code** - Each app is ~300-400 lines total
2. **Modify and experiment** - Try adding new message types
3. **Read the [main README](README.md)** - Full documentation
4. **Check [../examples/](../examples/)** - More advanced patterns

---

**Ready to go!** Pick an app and run `bun run dev` 🚀
