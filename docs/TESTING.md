# Testing Guide

## Overview

This project includes comprehensive unit and integration tests covering all major components.

## Test Files

```
shared/
  ├── api.test.ts           # API schema validation tests
  ├── socket.test.ts        # RpcPeer unit tests
  └── RetrySocket.test.ts   # RetrySocket unit tests
tests/
  ├── integration.test.ts   # End-to-end integration tests
  └── serve.test.ts         # Server configuration tests
```

## Running Tests

### Run all tests
```bash
bun test
```

### Run tests in watch mode
```bash
bun test --watch
```

### Run tests with coverage
```bash
bun test --coverage
```

### Run specific test file
```bash
bun test shared/api.test.ts
```

## Test Coverage

### API Schemas (`shared/api.test.ts`)
- ✅ Request schema validation (unknown, score, greet, game)
- ✅ Response schema validation (unknown, score, greet, game, error)
- ✅ Type safety and inference
- ✅ Invalid data rejection

### RPC Message Protocol (`shared/socket.test.ts`)
- ✅ RPC message schema validation (request, response, welcome)
- ✅ Promise.withResolvers polyfill
- ✅ RpcPeer instantiation and configuration
- ✅ Client ID assignment
- ✅ Request/response handling
- ✅ Schema validation with Zod
- ✅ Timeout management
- ✅ Match handler registration
- ✅ Error handling

### RetrySocket (`shared/RetrySocket.test.ts`)
- ✅ Constructor and factory methods
- ✅ WebSocket state constants
- ✅ Event listener management
- ✅ Message queueing when disconnected
- ✅ Binary type support
- ✅ Properties and getters
- ✅ Reconnection configuration

### Integration Tests (`tests/integration.test.ts`)
- ✅ Client-server connection establishment
- ✅ Welcome message with unique client IDs
- ✅ Request-response flow (score, greet, game)
- ✅ Request timeout handling
- ✅ Multiple simultaneous clients
- ✅ Unique ID generation per client
- ✅ Schema validation in real scenarios
- ✅ Bidirectional peer-to-peer communication

### Server Tests (`tests/serve.test.ts`)
- ✅ Default configuration values
- ✅ Path traversal protection
- ✅ WebSocket topic extraction
- ✅ UUID generation and format
- ✅ Message routing logic (direct vs broadcast)
- ✅ Welcome message structure
- ✅ CLI argument parsing
- ✅ HTTP method routing
- ✅ WebSocket upgrade detection

## Current Status

```
✅ 112 tests passing
🎯 174 assertions
⏱️  Execution time: ~8s
```

## Test Philosophy

- **Unit tests**: Test individual functions and classes in isolation
- **Integration tests**: Test complete request-response flows with real WebSocket connections
- **Schema validation**: Ensure runtime type safety matches compile-time types
- **Error paths**: Validate error handling and edge cases

## Notes

- Integration tests start a real WebSocket server on port `8765`
- Some tests include intentional delays for async operations
- "Reconnecting" console messages during tests are expected behavior (RetrySocket attempting reconnection after test cleanup)
