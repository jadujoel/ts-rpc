/**
 * Example demonstrating various authentication and authorization scenarios
 *
 * This example shows:
 * 1. NoAuthValidator vs SimpleAuthValidator vs custom validator
 * 2. Authentication failure scenarios (invalid token, missing token)
 * 3. Authorization failures (permission denied, topic access denied)
 * 4. Custom AuthValidator implementation with JWT-style tokens
 * 5. Different permission models and role-based access
 */

import { z } from "zod";
import { serve } from "../serve.ts";
import {
	type AuthContext,
	type AuthValidator,
	NoAuthValidator,
	SimpleAuthValidator,
	StrictAuthorizationRules,
} from "../shared/Authorization.ts";
import { RpcPeer } from "../shared/RpcPeer.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define schemas
const RequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("public"),
		message: z.string(),
	}),
	z.object({
		type: z.literal("private"),
		message: z.string(),
	}),
	z.object({
		type: z.literal("admin-only"),
		action: z.string(),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("success"),
		message: z.string(),
	}),
	z.object({
		type: z.literal("unauthorized"),
		reason: z.string(),
	}),
	z.object({
		type: z.literal("forbidden"),
		reason: z.string(),
	}),
]);

/**
 * Custom JWT-style token validator
 */
class JwtStyleAuthValidator implements AuthValidator {
	constructor(
		private readonly secretKey: string,
		private readonly validUsers: Map<
			string,
			{ userId: string; role: string; permissions: string[] }
		>,
	) {}

	async validate(
		token: string | null,
		_httpRequest: globalThis.Request,
	): Promise<AuthContext | null> {
		if (!token) {
			console.log("  [Auth] No token provided");
			return null;
		}

		// Simple token format: "jwt.{userId}.{signature}"
		const parts = token.split(".");
		if (parts.length !== 3 || parts[0] !== "jwt") {
			console.log("  [Auth] Invalid token format");
			return null;
		}

		const userId = parts[1];
		if (!userId) {
			console.log("  [Auth] Missing userId in token");
			return null;
		}

		const signature = parts[2];

		// Verify signature (very simplified)
		const expectedSignature = Buffer.from(
			`${userId}:${this.secretKey}`,
		).toString("base64");
		if (signature !== expectedSignature) {
			console.log(`  [Auth] Invalid signature for user ${userId}`);
			return null;
		}

		const userData = this.validUsers.get(userId);
		if (!userData) {
			console.log(`  [Auth] User ${userId} not found`);
			return null;
		}

		console.log(`  [Auth] ✓ Authenticated user: ${userId} (${userData.role})`);

		return {
			userId: userData.userId,
			sessionId: undefined,
			permissions: new Set(userData.permissions),
			connectedAt: new Date(),
			lastActivityAt: new Date(),
		};
	}
}

export async function authScenariosExample() {
	console.log("=== Authentication & Authorization Scenarios Example ===\n");

	console.debug = () => {}; // Disable debug logs

	// Scenario 1: NoAuthValidator (open access)
	console.log("--- Scenario 1: NoAuthValidator (Open Access) ---");
	console.log("Starting server with no authentication...\n");

	const noAuthServer = serve({
		hostname: "127.0.0.1",
		port: 8096,
		authValidator: new NoAuthValidator(),
	});

	const openPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8096/open",
		name: "OpenClient",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	openPeer.match((data) => {
		return {
			type: "success" as const,
			message: `Processed ${data.type} request`,
		};
	});

	await openPeer.waitForWelcome();
	console.log("✓ Connected without authentication");

	const publicResponse = await openPeer.call({
		type: "public",
		message: "Hello world",
	});
	console.log(
		`✓ Public request: ${publicResponse.data.type === "success" ? publicResponse.data.message : "failed"}`,
	);

	await openPeer.dispose();
	await noAuthServer.stop(true);

	// Scenario 2: SimpleAuthValidator with valid token
	console.log("\n--- Scenario 2: SimpleAuthValidator (Token Auth) ---");

	const authValidator = SimpleAuthValidator.FromTokens({
		"user-token-123": "user-1",
		"admin-token-456": "admin-1",
	});

	const authServer = serve({
		hostname: "127.0.0.1",
		port: 8096,
		authValidator,
	});

	console.log("\nAttempting connection with valid token...");
	const authenticatedPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8096/auth?token=user-token-123",
		name: "AuthenticatedClient",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	authenticatedPeer.match((data) => {
		return {
			type: "success" as const,
			message: `Authenticated request processed: ${data.type}`,
		};
	});

	await authenticatedPeer.waitForWelcome();
	console.log("✓ Connected with valid token");

	const authResponse = await authenticatedPeer.call({
		type: "private",
		message: "Authenticated message",
	});
	console.log(
		`✓ Private request: ${authResponse.data.type === "success" ? authResponse.data.message : "failed"}`,
	);

	await authenticatedPeer.dispose();

	// Scenario 3: Authentication failure - invalid token
	console.log("\n--- Scenario 3: Authentication Failure ---");

	console.log("Attempting connection with invalid token...");
	try {
		const invalidPeer = RpcPeer.FromOptions({
			url: "ws://127.0.0.1:8096/auth?token=invalid-token",
			name: "InvalidClient",
			requestSchema: RequestSchema,
			responseSchema: ResponseSchema,
		});

		// Wait a bit to see if connection is rejected
		await delay(500);
		const welcomePromise = invalidPeer.waitForWelcome();
		await Promise.race([welcomePromise, delay(1000)]);

		console.log("⚠ Connection was not immediately rejected");
		await invalidPeer.dispose();
	} catch {
		console.log(`✓ Connection rejected with invalid token`);
	}

	await authServer.stop(true);

	// Scenario 4: StrictAuthorizationRules with role-based access
	console.log("\n--- Scenario 4: Role-Based Authorization ---");

	const authRules = StrictAuthorizationRules.FromAdmins(["admin-1"]);

	// Add topic permissions
	authRules.canSubscribeToTopic = (userId, topic) => {
		console.log(`  [AuthZ] Check: ${userId || "anonymous"} → topic "${topic}"`);

		if (!userId) return false;
		if (userId === "admin-1") return true;

		// Regular users can only access "public" topics
		return topic.startsWith("public");
	};

	const strictServer = serve({
		hostname: "127.0.0.1",
		port: 8096,
		authValidator,
		authRules,
	});

	console.log("\nConnecting admin user...");
	const adminPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8096/test?token=admin-token-456",
		name: "AdminClient",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	console.log("Connecting regular user...");
	const userPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8096/test?token=user-token-123",
		name: "UserClient",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	adminPeer.match((data) => {
		if (data.type === "admin-only") {
			return {
				type: "success" as const,
				message: `Admin action executed: ${data.action}`,
			};
		}
		return {
			type: "success" as const,
			message: "Request processed",
		};
	});

	userPeer.match((data) => {
		if (data.type === "admin-only") {
			return {
				type: "forbidden" as const,
				reason: "Admin access required",
			};
		}
		return {
			type: "success" as const,
			message: "Request processed",
		};
	});

	await adminPeer.waitForWelcome();
	await userPeer.waitForWelcome();

	console.log("\n✓ Both users connected");

	// Admin can perform admin actions
	console.log("\nAdmin performing admin action...");
	const adminActionResponse = await adminPeer.call({
		type: "admin-only",
		action: "delete-all-data",
	});
	console.log(
		`  Admin: ${adminActionResponse.data.type === "success" ? adminActionResponse.data.message : "failed"}`,
	);

	// Regular user cannot perform admin actions
	console.log("Regular user attempting admin action...");
	const userActionResponse = await userPeer.call({
		type: "admin-only",
		action: "delete-all-data",
	});
	console.log(
		`  User: ${userActionResponse.data.type === "forbidden" ? userActionResponse.data.reason : "unexpected"}`,
	);

	await adminPeer.dispose();
	await userPeer.dispose();
	await strictServer.stop(true);

	// Scenario 5: Custom JWT-style validator
	console.log("\n--- Scenario 5: Custom JWT-Style Validator ---");

	const jwtValidator = new JwtStyleAuthValidator(
		"super-secret-key",
		new Map([
			[
				"alice",
				{
					userId: "alice",
					role: "developer",
					permissions: ["read", "write"],
				},
			],
			[
				"bob",
				{
					userId: "bob",
					role: "admin",
					permissions: ["read", "write", "delete"],
				},
			],
		]),
	);

	const jwtServer = serve({
		hostname: "127.0.0.1",
		port: 8096,
		authValidator: jwtValidator,
	});

	// Generate tokens
	function generateToken(userId: string): string {
		const signature = Buffer.from(`${userId}:super-secret-key`).toString(
			"base64",
		);
		return `jwt.${userId}.${signature}`;
	}

	const aliceToken = generateToken("alice");
	const bobToken = generateToken("bob");
	const invalidToken = "jwt.eve.wrong-signature";

	console.log("\nAttempting connections with JWT-style tokens...\n");

	// Alice connects
	console.log("Alice connecting with valid token:");
	const alicePeer = RpcPeer.FromOptions({
		url: `ws://127.0.0.1:8096/jwt?token=${aliceToken}`,
		name: "Alice",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	alicePeer.match((data) => ({
		type: "success" as const,
		message: `Alice processed: ${data.type}`,
	}));

	await alicePeer.waitForWelcome();
	console.log("✓ Alice authenticated\n");

	// Bob connects
	console.log("Bob connecting with valid token:");
	const bobPeer = RpcPeer.FromOptions({
		url: `ws://127.0.0.1:8096/jwt?token=${bobToken}`,
		name: "Bob",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	bobPeer.match((data) => ({
		type: "success" as const,
		message: `Bob processed: ${data.type}`,
	}));

	await bobPeer.waitForWelcome();
	console.log("✓ Bob authenticated\n");

	// Eve tries with invalid token
	console.log("Eve attempting connection with invalid signature:");
	try {
		const evePeer = RpcPeer.FromOptions({
			url: `ws://127.0.0.1:8096/jwt?token=${invalidToken}`,
			name: "Eve",
			requestSchema: RequestSchema,
			responseSchema: ResponseSchema,
		});

		await delay(500);
		console.log("⚠ Eve's connection was not immediately rejected");
		await evePeer.dispose();
	} catch {
		console.log("✓ Eve's connection rejected (invalid signature)\n");
	}

	// Scenario 6: Rate limiting by role
	console.log("--- Scenario 6: Rate Limiting by Role ---");

	console.log("\nRate limits:");
	console.log("  Admin (bob): 1000 msg/s");
	console.log("  User (alice): 50 msg/s\n");

	const aliceRequests = [];
	const bobRequests = [];

	// Send rapid requests
	console.log("Sending 60 rapid requests from each user...");

	for (let i = 0; i < 60; i++) {
		aliceRequests.push(
			alicePeer
				.call({ type: "public", message: `Alice msg ${i}` })
				.catch(() => "rate-limited"),
		);
		bobRequests.push(
			bobPeer
				.call({ type: "public", message: `Bob msg ${i}` })
				.catch(() => "rate-limited"),
		);
	}

	const [aliceResults, bobResults] = await Promise.all([
		Promise.all(aliceRequests),
		Promise.all(bobRequests),
	]);

	const aliceSuccess = aliceResults.filter((r) => r !== "rate-limited").length;
	const bobSuccess = bobResults.filter((r) => r !== "rate-limited").length;

	console.log(`\nResults:`);
	console.log(`  Alice (user): ${aliceSuccess}/60 succeeded`);
	console.log(`  Bob (admin): ${bobSuccess}/60 succeeded`);

	// Cleanup
	console.log("\n--- Cleanup ---");
	await alicePeer.dispose();
	await bobPeer.dispose();
	await jwtServer.stop(true);

	console.log("\n=== Example Complete ===");
	console.log("\nKey Concepts:");
	console.log("- NoAuthValidator: open access (development/testing)");
	console.log("- SimpleAuthValidator: token-based authentication");
	console.log("- Custom validators: implement AuthValidator interface");
	console.log("- StrictAuthorizationRules: role-based access control");
	console.log("- Rate limiting: different limits per role");
	console.log("- Authentication: verify identity (who are you?)");
	console.log("- Authorization: verify permissions (what can you do?)");
}

if (import.meta.main) {
	await authScenariosExample();
}
