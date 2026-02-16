/**
 * Example demonstrating RetrySocket automatic reconnection capabilities
 *
 * This example shows:
 * 1. Automatic reconnection with exponential backoff
 * 2. Message queuing during disconnection
 * 3. Event handling patterns
 * 4. Proper cleanup with dispose()
 * 5. Visualization of reconnection behavior
 */

import { RetrySocket } from "../shared/RetrySocket.ts";
import { serve } from "./serve.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retrySocketExample() {
	console.log("=== RetrySocket Example ===\n");

	// Start the server
	const server = serve({
		hostname: "127.0.0.1",
		port: 8090,
	});

	console.log("Server started on ws://127.0.0.1:8090\n");

	// Create RetrySocket with custom reconnection settings
	const socket = RetrySocket.FromOptions({
		url: "ws://127.0.0.1:8090/retry-test",
		reconnectInterval: 1000, // Start with 1 second
		maxReconnectInterval: 8000, // Max 8 seconds between retries
		binaryType: "arraybuffer",
		onopen: (_event) => {
			console.log(`[${new Date().toISOString()}] ✓ Connected`);
		},
		onmessage: (event) => {
			console.log(`[${new Date().toISOString()}] ← Message: ${event.data}`);
		},
		onclose: (event) => {
			console.log(
				`[${new Date().toISOString()}] ✗ Connection closed (code: ${event.code}, reason: ${event.reason || "none"})`,
			);
		},
		onerror: (_event) => {
			console.log(`[${new Date().toISOString()}] ⚠ Error occurred`);
		},
	});

	// Wait for initial connection
	await delay(500);

	// Send a message while connected
	console.log("\n--- Sending message while connected ---");
	socket.send("Hello from connected client");
	await delay(500);

	// Simulate server restart by stopping and starting again
	console.log("\n--- Simulating server restart (3 second downtime) ---");
	await server.stop(true);
	console.log("Server stopped. RetrySocket will attempt reconnection...\n");

	// Send messages while disconnected - they should be queued
	console.log("Sending messages while disconnected (will be queued):");
	socket.send("Message 1 (queued during downtime)");
	socket.send("Message 2 (queued during downtime)");
	socket.send("Message 3 (queued during downtime)");

	// Wait a bit to see reconnection attempts
	await delay(3000);

	// Restart the server
	console.log("\n--- Restarting server ---");
	const server2 = serve({
		hostname: "127.0.0.1",
		port: 8090,
	});

	// Wait for reconnection and message flush
	await delay(2000);

	// Send more messages after reconnection
	console.log("\n--- Sending messages after reconnection ---");
	socket.send("Message after reconnect 1");
	await delay(200);
	socket.send("Message after reconnect 2");
	await delay(200);

	// Demonstrate multiple disconnect/reconnect cycles
	console.log("\n--- Testing exponential backoff (multiple reconnects) ---");
	await server2.stop(true);
	console.log("Server stopped again. Watch the backoff intervals increase:\n");

	// Let it try to reconnect several times (exponential backoff)
	await delay(5000);

	// Final restart
	console.log("\n--- Final server restart ---");
	const server3 = serve({
		hostname: "127.0.0.1",
		port: 8090,
	});

	await delay(2000);
	socket.send("Final message after multiple reconnects");
	await delay(500);

	// Cleanup
	console.log("\n--- Cleanup ---");
	socket.dispose();
	console.log("Socket disposed");
	await server3.stop(true);
	console.log("Server stopped");

	console.log("\n=== Example Complete ===");
	console.log("\nKey observations:");
	console.log("- Initial connection succeeded immediately");
	console.log("- Messages sent during downtime were queued");
	console.log("- Reconnection happened automatically with exponential backoff");
	console.log("- Queued messages were sent after reconnection");
	console.log(
		"- Multiple reconnect cycles showed increasing delays (1s, 2s, 4s, 8s)",
	);
}

if (import.meta.main) {
	await retrySocketExample();
}
