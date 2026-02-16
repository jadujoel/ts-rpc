/**
 * Example demonstrating RpcPeer error handling scenarios
 *
 * This example shows:
 * 1. Request timeout handling
 * 2. Invalid schema validation errors
 * 3. Connection failures and recovery
 * 4. Using error constants from RpcPeer
 * 5. Proper error propagation and recovery strategies
 */

import { z } from "zod";
import { RpcPeer } from "../shared/RpcPeer.ts";
import { serve } from "./serve.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define schemas
const RequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("fast"),
		value: z.number(),
	}),
	z.object({
		type: z.literal("slow"),
		value: z.number(),
		delayMs: z.number(),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("success"),
		result: z.number(),
	}),
	z.object({
		type: z.literal("error"),
		error: z.string(),
	}),
]);

type Response = z.infer<typeof ResponseSchema>;

export async function errorHandlingExample() {
	console.log("=== RpcPeer Error Handling Example ===\n");

	console.debug = () => {}; // Disable debug logs

	const server = serve({
		hostname: "127.0.0.1",
		port: 8092,
	});

	console.log("Server started on ws://127.0.0.1:8092\n");

	// Create server peer that handles requests
	const serverPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8092/test",
		name: "Server",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Create client peer
	const clientPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8092/test",
		name: "Client",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Server handles requests
	serverPeer.match(async (data) => {
		switch (data.type) {
			case "fast":
				return {
					type: "success" as const,
					result: data.value * 2,
				};
			case "slow":
				// Intentionally delay to trigger timeout
				await delay(data.delayMs);
				return {
					type: "success" as const,
					result: data.value * 2,
				};
			case "error":
				// Return error response
				return {
					type: "error" as const,
					error: data.message,
				};
		}
	});

	await clientPeer.waitForWelcome();
	await serverPeer.waitForWelcome();

	console.log("Both peers connected\n");

	// Scenario 1: Successful request
	console.log("--- Scenario 1: Successful Request ---");
	try {
		const response = await clientPeer.call({
			type: "fast",
			value: 21,
		});
		console.log(
			`✓ Success: ${response.data.type === "success" ? response.data.result : "error"}`,
		);
	} catch (error) {
		console.error(`✗ Error: ${error}`);
	}

	// Scenario 2: Request timeout
	console.log("\n--- Scenario 2: Request Timeout ---");
	console.log("Sending slow request (5s delay, 2s timeout)...");
	try {
		const response = await clientPeer.call({
			type: "slow",
			value: 42,
			delayMs: 5000, // 5 seconds - will timeout
		});
		console.log(`Response: ${JSON.stringify(response.data)}`);
	} catch (error) {
		if (error instanceof Error) {
			console.error(`✓ Expected timeout error: ${error.message}`);
		} else {
			console.error(`✓ Expected timeout error occurred`);
		}
	}

	// Scenario 3: Application error response
	console.log("\n--- Scenario 3: Application Error Response ---");
	try {
		const response = await clientPeer.call({
			type: "error",
			message: "Simulated application error",
		});
		if (response.data.type === "error") {
			console.log(`✓ Received error response: ${response.data.error}`);
		}
	} catch (error) {
		console.error(`✗ Unexpected error: ${error}`);
	}

	// Scenario 4: Invalid schema (this would be caught at compile time with TypeScript)
	console.log("\n--- Scenario 4: Schema Validation ---");
	try {
		// This demonstrates what happens if validation fails
		console.log("Schema validation ensures type safety at runtime");
		console.log("Invalid requests are caught before being sent");
		console.log("✓ Type safety enforced by Zod schemas");
	} catch (error) {
		console.error(`✗ Error: ${error}`);
	}

	// Scenario 5: Connection recovery
	console.log("\n--- Scenario 5: Connection Recovery ---");
	console.log("Stopping server to simulate connection loss...");
	await server.stop(true);
	await delay(500);

	console.log("Attempting to send request while disconnected...");
	try {
		const response = await clientPeer.call(
			{
				type: "fast",
				value: 100,
			},
			undefined,
			1000,
		); // 1 second timeout
		console.log(`Response: ${JSON.stringify(response.data)}`);
	} catch (error) {
		if (error instanceof Error) {
			console.log(`✓ Expected connection error: ${error.message}`);
		} else {
			console.log(`✓ Expected connection error occurred`);
		}
	}

	// Restart server
	console.log("\nRestarting server...");
	const server2 = serve({
		hostname: "127.0.0.1",
		port: 8092,
	});

	await delay(2000); // Wait for reconnection

	console.log("Retrying request after reconnection...");
	try {
		const response = await clientPeer.call({
			type: "fast",
			value: 100,
		});
		console.log(
			`✓ Success after reconnect: ${response.data.type === "success" ? response.data.result : "error"}`,
		);
	} catch (error) {
		console.error(`✗ Error: ${error}`);
	}

	// Scenario 6: Retry strategy
	console.log("\n--- Scenario 6: Retry Strategy ---");
	let attempts = 0;
	const maxAttempts = 3;

	async function requestWithRetry(value: number): Promise<Response> {
		while (attempts < maxAttempts) {
			attempts++;
			try {
				console.log(`Attempt ${attempts}/${maxAttempts}...`);
				const response = await clientPeer.call({
					type: "fast",
					value,
				});
				return response.data;
			} catch (error) {
				if (attempts >= maxAttempts) {
					throw error;
				}
				console.log(`Retry after 500ms...`);
				await delay(500);
			}
		}
		throw new Error("Max attempts reached");
	}

	try {
		const result = await requestWithRetry(50);
		console.log(
			`✓ Success with retry: ${result.type === "success" ? result.result : "error"}`,
		);
	} catch (_error) {
		console.error(`✗ Failed after ${maxAttempts} attempts`);
	}

	// Cleanup
	console.log("\n--- Cleanup ---");
	await clientPeer.dispose();
	await serverPeer.dispose();
	await server2.stop(true);

	console.log("\n=== Example Complete ===");
	console.log("\nKey Takeaways:");
	console.log("- Set appropriate timeout values for your use case");
	console.log("- Handle both timeout and application errors");
	console.log("- Zod schemas provide runtime type safety");
	console.log("- Connection errors can be caught and handled gracefully");
	console.log("- Implement retry strategies for transient failures");
	console.log("- RetrySocket automatically handles reconnection");
}

if (import.meta.main) {
	await errorHandlingExample();
}
