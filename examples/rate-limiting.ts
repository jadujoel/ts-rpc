/**
 * Example demonstrating rate limiting with RateLimiter and Authorization
 *
 * This example shows:
 * 1. Using RateLimiter independently with token bucket algorithm
 * 2. Different rate limits per user type (admin, user, guest)
 * 3. Handling rate limit exceeded scenarios
 * 4. Integration with StrictAuthorizationRules
 * 5. Visualization of token bucket behavior
 */

import { z } from "zod";
import {
	RateLimiter,
	SimpleAuthValidator,
	StrictAuthorizationRules,
} from "../shared/Authorization.ts";
import { RpcPeer } from "../shared/RpcPeer.ts";
import { serve } from "./serve.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define schemas
const RequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("ping"),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("heavy"),
		data: z.string(),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("pong"),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("success"),
		message: z.string(),
	}),
	z.object({
		type: z.literal("rate-limited"),
		message: z.string(),
		retryAfter: z.number(),
	}),
]);

export async function rateLimitingExample() {
	console.log("=== Rate Limiting Example ===\n");

	console.debug = () => {}; // Disable debug logs

	// Part 1: Standalone RateLimiter usage
	console.log("--- Part 1: Standalone RateLimiter ---\n");

	// Create rate limiter with 5 tokens per second, burst capacity of 10
	const limiter = RateLimiter.FromOptions({
		capacity: 10, // Can burst up to 10 requests
		refillRate: 5, // Refills at 5 tokens per second
	});

	console.log("Rate Limiter Configuration:");
	console.log(`  Capacity: ${limiter.capacity} tokens (burst limit)`);
	console.log(`  Refill Rate: ${limiter.refillRate} tokens/second\n`);

	console.log("Attempting 15 rapid requests:");
	let allowed = 0;
	let denied = 0;

	for (let i = 1; i <= 15; i++) {
		const accepted = limiter.tryConsume("user-1");
		if (accepted) {
			allowed++;
			console.log(`  Request ${i}: ✓ Allowed`);
		} else {
			denied++;
			console.log(`  Request ${i}: ✗ Rate limited`);
		}
	}

	console.log(`\nResults: ${allowed} allowed, ${denied} denied`);
	console.log("(Initial burst of 10 allowed, then 5 more denied)\n");

	// Wait for tokens to refill
	console.log("Waiting 2 seconds for token refill...");
	await delay(2000);

	console.log("Attempting 5 more requests after refill:");
	for (let i = 1; i <= 5; i++) {
		const accepted = limiter.tryConsume("user-1");
		console.log(`  Request ${i}: ${accepted ? "✓ Allowed" : "✗ Rate limited"}`);
	}

	// Part 2: Different rate limits per user type
	console.log("\n\n--- Part 2: Different Limits Per User Type ---\n");

	// Simulate different user types
	const userTypes = [
		{ id: "guest", rate: 1, label: "Guest (1/sec)" },
		{ id: "user", rate: 10, label: "Regular User (10/sec)" },
		{ id: "admin", rate: 100, label: "Admin (100/sec)" },
	];

	for (const userType of userTypes) {
		console.log(`${userType.label}:`);
		const userLimiter = new RateLimiter(userType.rate, userType.rate);

		let successes = 0;
		for (let i = 0; i < 15; i++) {
			if (userLimiter.tryConsume(userType.id)) {
				successes++;
			}
		}
		console.log(`  Allowed ${successes}/15 requests\n`);
	}

	// Part 3: Integration with Authorization
	console.log("--- Part 3: Integration with Authorization ---\n");

	const authRules = StrictAuthorizationRules.FromAdmins(["admin-1"]);

	console.log("Rate limits per user type:");
	console.log(`  Unauthenticated: ${authRules.getRateLimit(undefined)} msg/s`);
	console.log(`  Regular User: ${authRules.getRateLimit("user-1")} msg/s`);
	console.log(`  Admin: ${authRules.getRateLimit("admin-1")} msg/s\n`);

	// Part 4: Real server with rate limiting
	console.log("--- Part 4: Server with Rate Limiting ---\n");

	const authValidator = SimpleAuthValidator.FromTokens({
		"admin-token": "admin-1",
		"user-token": "user-1",
	});

	const server = serve({
		hostname: "127.0.0.1",
		port: 8094,
		authValidator,
		authRules,
		enableRateLimit: true,
	});

	console.log("Server started with rate limiting enabled\n");

	// Create server peer to handle requests
	const serverPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8094/server?token=admin-token",
		name: "ServerPeer",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	serverPeer.match(async (data) => {
		switch (data.type) {
			case "ping":
				return {
					type: "pong" as const,
					timestamp: Date.now(),
				};
			case "heavy":
				return {
					type: "success" as const,
					message: "Processed",
				};
		}
	});

	await serverPeer.waitForWelcome();

	// Create admin peer
	const adminPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8094/test?token=admin-token",
		name: "Admin",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	adminPeer.match(async (data) => {
		switch (data.type) {
			case "ping":
				return {
					type: "pong" as const,
					timestamp: Date.now(),
				};
			case "heavy":
				return {
					type: "success" as const,
					message: "Processed",
				};
		}
	});

	await adminPeer.waitForWelcome();

	console.log("Admin connected. Testing burst requests:");

	// Test burst of requests
	let adminSuccess = 0;
	let adminFailed = 0;

	const requests = Array.from({ length: 20 }, (_, i) => i + 1);

	console.log("Sending 20 rapid requests as admin...");

	for (const i of requests) {
		try {
			await adminPeer.call(
				{
					type: "ping",
					timestamp: Date.now(),
				},
				serverPeer.clientId,
			);
			adminSuccess++;
			if (i % 5 === 0) {
				console.log(`  Completed ${i} requests...`);
			}
		} catch {
			adminFailed++;
			console.log(`  Request ${i}: Rate limited`);
		}
	}

	console.log(
		`\nAdmin Results: ${adminSuccess} succeeded, ${adminFailed} failed`,
	);
	console.log("(Admin has high limit, should succeed)\n");

	// Part 5: Rate limit visualization
	console.log("--- Part 5: Token Bucket Visualization ---\n");

	const visualLimiter = RateLimiter.FromOptions({
		capacity: 5,
		refillRate: 2, // 2 tokens per second
	});

	console.log("Visualization of token bucket (capacity: 5, refill: 2/sec):\n");

	async function visualizeRequest(userId: string, requestNum: number) {
		const accepted = visualLimiter.tryConsume(userId);
		const timestamp = new Date().toISOString().substring(11, 23);
		console.log(
			`[${timestamp}] Request ${requestNum}: ${accepted ? "✓ PASS" : "✗ BLOCKED"}`,
		);
		return accepted;
	}

	// Initial burst
	console.log("Initial burst (5 requests):");
	for (let i = 1; i <= 5; i++) {
		await visualizeRequest("demo-user", i);
	}

	console.log("\nNext 3 requests (should be blocked):");
	for (let i = 6; i <= 8; i++) {
		await visualizeRequest("demo-user", i);
		await delay(100);
	}

	console.log("\nWaiting 1 second for 2 tokens to refill...");
	await delay(1000);

	console.log("Next 3 requests (2 should pass, 1 blocked):");
	for (let i = 9; i <= 11; i++) {
		await visualizeRequest("demo-user", i);
		await delay(100);
	}

	console.log("\nWaiting 2.5 seconds for 5 tokens to refill...");
	await delay(2500);

	console.log("Final 5 requests (all should pass):");
	for (let i = 12; i <= 16; i++) {
		await visualizeRequest("demo-user", i);
		await delay(100);
	}

	// Cleanup
	console.log("\n--- Cleanup ---");
	await adminPeer.dispose();
	await serverPeer.dispose();
	await server.stop(true);

	console.log("\n=== Example Complete ===");
	console.log("\nKey Concepts:");
	console.log("- Token bucket algorithm: burst capacity + steady refill rate");
	console.log("- Capacity: maximum tokens (burst limit)");
	console.log("- Refill rate: tokens added per second");
	console.log("- Different limits for different user types");
	console.log("- Rate limiting integrated with authorization");
	console.log("- Tokens refill automatically over time");
	console.log(
		"- tryConsume() returns true if token available, false if rate limited",
	);
}

if (import.meta.main) {
	await rateLimitingExample();
}
