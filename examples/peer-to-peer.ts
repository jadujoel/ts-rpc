/**
 * Example demonstrating peer-to-peer messaging through RpcPeer
 *
 * This example shows:
 * 1. Multiple clients connecting to a relay server
 * 2. Using the 'to' parameter for targeted peer-to-peer messages
 * 3. Server routing messages between clients
 * 4. Broadcast vs direct messaging patterns
 * 5. Client discovery and messaging
 */

import { z } from "zod";
import { RpcPeer } from "../shared/RpcPeer.ts";
import { serve } from "./serve.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define schemas for peer-to-peer messaging
const RequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("broadcast"),
		from: z.string(),
		message: z.string(),
	}),
	z.object({
		type: z.literal("direct"),
		from: z.string(),
		to: z.string(),
		message: z.string(),
	}),
	z.object({
		type: z.literal("list-peers"),
	}),
	z.object({
		type: z.literal("hello"),
		name: z.string(),
	}),
	z.object({
		type: z.literal("incoming-message"),
		from: z.string(),
		message: z.string(),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("ack"),
		message: z.string(),
	}),
	z.object({
		type: z.literal("peers"),
		peerIds: z.array(z.string()),
	}),
]);

export async function peerToPeerExample() {
	console.log("=== Peer-to-Peer Messaging Example ===\n");

	console.debug = () => {}; // Disable debug logs
	console.time = () => {}; // Disable time logs

	const server = serve({
		hostname: "127.0.0.1",
		port: 8093,
	});

	console.log("Relay server started on ws://127.0.0.1:8093\n");

	// Create relay server peer
	const relayPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8093/relay",
		name: "RelayServer",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Track all connected peers
	const connectedPeers = new Map<string, string>(); // clientId -> name

	// Server handles routing
	relayPeer.match(async (data, from) => {
		switch (data.type) {
			case "hello":
				if (from === undefined) {
					throw new Error("from is required for hello message");
				}
				connectedPeers.set(from, data.name);
				console.log(`  [Relay] ${data.name} (${from}) joined`);
				return {
					type: "ack" as const,
					message: `Welcome ${data.name}`,
				};

			case "list-peers":
				return {
					type: "peers" as const,
					peerIds: Array.from(connectedPeers.keys()),
				};

			case "broadcast":
				console.log(
					`  [Relay] Broadcasting from ${data.from}: "${data.message}"`,
				);
				// In a real implementation, relay would forward to all peers
				// For this example, we'll just acknowledge
				return {
					type: "ack" as const,
					message: "Broadcast sent",
				};

			case "direct":
				console.log(`  [Relay] Routing message ${data.from} → ${data.to}`);
				// In a real relay, this would forward to the target peer
				return {
					type: "ack" as const,
					message: `Message routed to ${data.to}`,
				};
		}
	});

	await relayPeer.waitForWelcome();

	// Create three client peers
	console.log("Creating three client peers...\n");

	const alice = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8093/relay",
		name: "Alice",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	const bob = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8093/relay",
		name: "Bob",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	const charlie = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8093/relay",
		name: "Charlie",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Handle incoming messages for each peer
	alice.match(async (data) => {
		if (data.type === "incoming-message") {
			console.log(`  [Alice] ← Received from ${data.from}: "${data.message}"`);
		}
		return { type: "ack" as const, message: "ok" };
	});

	bob.match(async (data) => {
		if (data.type === "incoming-message") {
			console.log(`  [Bob] ← Received from ${data.from}: "${data.message}"`);
		}
		return { type: "ack" as const, message: "ok" };
	});

	charlie.match(async (data) => {
		if (data.type === "incoming-message") {
			console.log(
				`  [Charlie] ← Received from ${data.from}: "${data.message}"`,
			);
		}
		return { type: "ack" as const, message: "ok" };
	});

	await alice.waitForWelcome();
	await bob.waitForWelcome();
	await charlie.waitForWelcome();

	console.log("All peers connected\n");

	// All peers introduce themselves
	console.log("--- Phase 1: Peer Introduction ---");
	const aliceResponse = await alice.call({
		type: "hello",
		name: "Alice",
	});
	console.log(
		`Alice: ${aliceResponse.data.type === "ack" ? aliceResponse.data.message : ""}`,
	);

	const bobResponse = await bob.call({
		type: "hello",
		name: "Bob",
	});
	console.log(
		`Bob: ${bobResponse.data.type === "ack" ? bobResponse.data.message : ""}`,
	);

	const charlieResponse = await charlie.call({
		type: "hello",
		name: "Charlie",
	});
	console.log(
		`Charlie: ${charlieResponse.data.type === "ack" ? charlieResponse.data.message : ""}\n`,
	);

	// List all peers
	console.log("--- Phase 2: Peer Discovery ---");
	const peerList = await alice.call({
		type: "list-peers",
	});
	if (peerList.data.type === "peers") {
		console.log(
			`Alice discovered peers: ${peerList.data.peerIds.join(", ")}\n`,
		);
	}

	// Broadcast message
	console.log("--- Phase 3: Broadcast Message ---");
	await alice.call({
		type: "broadcast",
		from: "Alice",
		message: "Hello everyone!",
	});
	await delay(200);

	// Direct peer-to-peer messages using 'to' parameter
	console.log("\n--- Phase 4: Direct Peer-to-Peer Messages ---");

	console.log("Alice → Bob (direct):");
	const directResponse1 = await alice.call(
		{
			type: "direct",
			from: "Alice",
			to: bob.clientId,
			message: "Hey Bob, how are you?",
		},
		bob.clientId, // Using 'to' parameter for direct messaging
	);
	console.log(
		`  Response: ${directResponse1.data.type === "ack" ? directResponse1.data.message : ""}`,
	);

	await delay(200);

	console.log("\nBob → Charlie (direct):");
	const directResponse2 = await bob.call(
		{
			type: "direct",
			from: "Bob",
			to: charlie.clientId,
			message: "Charlie, can you help with the project?",
		},
		charlie.clientId,
	);
	console.log(
		`  Response: ${directResponse2.data.type === "ack" ? directResponse2.data.message : ""}`,
	);

	await delay(200);

	console.log("\nCharlie → Alice (direct):");
	const directResponse3 = await charlie.call(
		{
			type: "direct",
			from: "Charlie",
			to: alice.clientId,
			message: "Alice, thanks for organizing!",
		},
		alice.clientId,
	);
	console.log(
		`  Response: ${directResponse3.data.type === "ack" ? directResponse3.data.message : ""}`,
	);

	await delay(200);

	// Multiple messages in sequence
	console.log("\n--- Phase 5: Message Chain ---");
	console.log("Alice → Bob → Charlie chain:");
	await alice.call(
		{
			type: "direct",
			from: "Alice",
			to: bob.clientId,
			message: "Start the chain!",
		},
		bob.clientId,
	);

	await delay(100);

	await bob.call(
		{
			type: "direct",
			from: "Bob",
			to: charlie.clientId,
			message: "Continuing the chain...",
		},
		charlie.clientId,
	);

	await delay(100);

	await charlie.call(
		{
			type: "direct",
			from: "Charlie",
			to: alice.clientId,
			message: "Chain complete!",
		},
		alice.clientId,
	);

	await delay(200);

	// Cleanup
	console.log("\n--- Cleanup ---");
	await alice.dispose();
	await bob.dispose();
	await charlie.dispose();
	await relayPeer.dispose();
	await server.stop(true);

	console.log("\n=== Example Complete ===");
	console.log("\nKey Concepts:");
	console.log("- Each peer has a unique clientId for addressing");
	console.log("- Use the 'to' parameter in call() for direct peer messaging");
	console.log("- Server can route messages between peers");
	console.log("- Broadcast vs direct messaging patterns");
	console.log("- Peer discovery through server coordination");
	console.log("- All communication is type-safe with Zod schemas");
}

if (import.meta.main) {
	await peerToPeerExample();
}
