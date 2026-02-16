/**
 * Example: Using Authentication and Authorization
 *
 * This example demonstrates how to set up and use the authentication
 * and authorization features of ts-signal-rpc.
 */

import { z } from "zod";
import { serve } from "../serve.ts";
import {
	SimpleAuthValidator,
	StrictAuthorizationRules,
} from "../shared/Authorization.ts";
import { RpcPeer } from "../shared/RpcPeer.ts";

console.debug = () => {};

// 1. Set up authentication validator with some test tokens
const validator = SimpleAuthValidator.FromTokens({
	"user1-secret-token": "user1",
	"user2-secret-token": "user2",
	"admin-secret-token": "admin",
});

// 2. Set up authorization rules
const rules = StrictAuthorizationRules.FromOptions({
	adminUsers: ["admin"], // admin users
	topicPermissions: new Map([
		["chat", new Set(["user1", "user2", "admin"])], // chat topic accessible to these users
		["admin-only", new Set(["admin"])], // admin-only topic
	]),
});

// 3. Start server with authentication and authorization
const server = serve({
	hostname: "127.0.0.1",
	port: 0,
	authValidator: validator,
	authRules: rules,
	enableRateLimit: true,
	maxMessageSize: 1024 * 100, // 100KB max message
	enableSessionPersistence: true, // Enable session restoration
});

console.log(`Server running at ${server.url}`);

// Convert HTTP URL to WebSocket URL
const wsUrl = server.url
	.toString()
	.replace("http://", "ws://")
	.replace("https://", "wss://");
console.log("\nTo connect with authentication:");
console.log(
	`1. WebSocket URL with token: ${wsUrl}chat?token=user1-secret-token`,
);
console.log(
	"2. HTTP Authorization header: Authorization: Bearer user1-secret-token\n",
);

// Example client with authentication
async function exampleClient() {
	// Define API schema
	const RequestSchema = z.discriminatedUnion("type", [
		z.object({ type: z.literal("greet"), name: z.string() }),
		z.object({ type: z.literal("ping") }),
	]);

	const ResponseSchema = z.discriminatedUnion("type", [
		z.object({ type: z.literal("greeting"), message: z.string() }),
		z.object({ type: z.literal("pong") }),
	]);

	type RequestApi = z.infer<typeof RequestSchema>;

	// Create client with authentication token
	// Option 1: Pass token in URL
	const client1 = RpcPeer.FromOptions({
		url: `${wsUrl}chat?token=user1-secret-token`,
		name: "AuthenticatedClient1",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
		enableHeartbeat: true, // Enable heartbeat
		heartbeatInterval: 30000, // 30 seconds
	});

	// Set up request handler
	client1.match(async (data: RequestApi, from?: string) => {
		console.log(`Client1 received request from ${from}:`, data);
		if (data.type === "greet") {
			return { type: "greeting", message: `Hello ${data.name}!` };
		}
		if (data.type === "ping") {
			return { type: "pong" };
		}
	});

	await client1.waitForWelcome();
	console.log(
		`Client1 connected! name ${client1.name} ${client1.sessionId} ClientId: ${client1.clientId}, SessionId: ${client1.sessionId}`,
	);

	// Create second client (simulating reconnection with session persistence)
	const sessionId = client1.sessionId; // Save session ID
	const clientId = client1.clientId; // Save client ID

	console.log(
		`\nSimulating reconnection with session: ${sessionId}, clientId: ${clientId}`,
	);

	// Close first connection
	await client1.close();

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 1000));

	// Reconnect with same session
	const client1Reconnected = RpcPeer.FromOptions({
		url: `${wsUrl}chat?token=user1-secret-token`,
		name: "AuthenticatedClient1Reconnected",
		sessionId, // Pass saved session ID for restoration
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
		enableHeartbeat: true,
	});

	// Set up request handler for reconnected client
	client1Reconnected.match(async (data: RequestApi, from?: string) => {
		console.log(`Client1Reconnected received request from ${from}:`, data);
		if (data.type === "greet") {
			return { type: "greeting", message: `Hello ${data.name}!` };
		}
		if (data.type === "ping") {
			return { type: "pong" };
		}
	});

	await new Promise((resolve) => {
		client1Reconnected.addEventListener("welcome", (ev) => {
			const detail = (ev as CustomEvent).detail;
			console.log(
				`Client1 reconnected! ClientId: ${detail.clientId}, SessionId: ${detail.sessionId}, Restored: ${detail.restoredSession}`,
			);
			console.log(
				`Session restored: ${detail.clientId === clientId && detail.restoredSession}`,
			);
			resolve(undefined);
		});
	});

	// Create another client with different user
	const client2 = RpcPeer.FromOptions({
		url: `${wsUrl}chat?token=user2-secret-token`,
		name: "AuthenticatedClient2",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
		enableHeartbeat: true,
	});

	// Set up request handler for client2
	client2.match(async (data: RequestApi, from?: string) => {
		console.log(`Client2 received request from ${from}:`, data);
		if (data.type === "greet") {
			return { type: "greeting", message: `Hello ${data.name}!` };
		}
		if (data.type === "ping") {
			return { type: "pong" };
		}
	});

	await new Promise((resolve) => {
		client2.addEventListener("welcome", (ev) => {
			const detail = (ev as CustomEvent).detail;
			console.log(`Client2 connected! ClientId: ${detail.clientId}`);
			resolve(undefined);
		});
	});

	// Send a request from client2 to client1
	console.log("\nSending request from client2 to client1...");
	if (!client1Reconnected.clientId) {
		throw new Error("Client1 not connected");
	}
	const response = await client2.call(
		{ type: "greet", name: "Alice" },
		client1Reconnected.clientId,
	);
	console.log("Received response:", response.data);

	// Test rate limiting by sending many requests rapidly
	console.log(
		"\nTesting rate limiting (sending 60 requests simultaneously)...",
	);
	const promises = [];
	if (!client1Reconnected.clientId) {
		throw new Error("Client1 not connected");
	}
	for (let i = 0; i < 60; i++) {
		promises.push(
			client2
				.call({ type: "ping" }, client1Reconnected.clientId)
				.then(() => ({ success: true, index: i }))
				.catch((err) => ({ success: false, index: i, error: err.message })),
		);
	}
	const results = await Promise.allSettled(promises);

	const successful = results.filter(
		(r) => r.status === "fulfilled" && r.value.success,
	).length;
	const failed = results.filter(
		(r) => r.status === "fulfilled" && !r.value.success,
	).length;

	console.log(
		`\nRate limiting test complete: ${successful} succeeded, ${failed} rate-limited/failed`,
	);
	console.log(`(user2 rate limit: ${rules.getRateLimit("user2")} msg/s)`);

	// Clean up
	setTimeout(async () => {
		await client1Reconnected.close();
		await client2.close();
		server.stop();
		process.exit(0);
	}, 2000);
}

// Run example if this file is executed directly
if (import.meta.main) {
	await exampleClient();
}
