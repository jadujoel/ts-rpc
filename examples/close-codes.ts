/**
 * Example demonstrating WebSocket close code handling
 *
 * This example shows:
 * 1. Different close scenarios with proper codes
 * 2. Using canReconnect() to determine reconnection strategy
 * 3. Using isReservedCloseCode() to validate application codes
 * 4. Getting human-readable descriptions with getCloseCodeDescription()
 * 5. Distinguishing between graceful shutdown and error scenarios
 */

import {
	canReconnect,
	getCloseCodeDescription,
	isReservedCloseCode,
	WS_CLOSE_ABNORMAL,
	WS_CLOSE_GOING_AWAY,
	WS_CLOSE_INTERNAL_ERROR,
	WS_CLOSE_NO_STATUS,
	WS_CLOSE_NORMAL,
	WS_CLOSE_POLICY_VIOLATION,
	WS_CLOSE_PROTOCOL_ERROR,
	WS_CLOSE_SERVICE_RESTART,
	WS_CLOSE_TRY_AGAIN_LATER,
} from "../shared/WebSocketCloseCodes.ts";
import { serve } from "./serve.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function demonstrateCloseCode(code: number) {
	const description = getCloseCodeDescription(code);
	const shouldReconnect = canReconnect(code);
	const isReserved = isReservedCloseCode(code);

	console.log(`\nClose Code: ${code}`);
	console.log(`  Description: "${description}"`);
	console.log(`  Can Reconnect: ${shouldReconnect ? "✓ Yes" : "✗ No"}`);
	console.log(
		`  Is Reserved: ${isReserved ? "✓ Yes (cannot be set by app)" : "✗ No (app can use)"}`,
	);

	if (shouldReconnect) {
		console.log("  → Client should attempt reconnection");
	} else if (isReserved) {
		console.log("  → This code is set by the WebSocket implementation");
	} else {
		console.log("  → Connection closed intentionally, no reconnect needed");
	}
}

export async function closeCodesExample() {
	console.log("=== WebSocket Close Codes Example ===\n");

	// Part 1: Demonstrate utility functions
	console.log("--- Close Code Utility Functions ---");

	console.log("\n1. Normal closure (successful completion):");
	demonstrateCloseCode(WS_CLOSE_NORMAL);

	console.log("\n2. Going away (server shutdown, client navigation):");
	demonstrateCloseCode(WS_CLOSE_GOING_AWAY);

	console.log("\n3. Protocol error:");
	demonstrateCloseCode(WS_CLOSE_PROTOCOL_ERROR);

	console.log("\n4. Policy violation (e.g., rate limit exceeded):");
	demonstrateCloseCode(WS_CLOSE_POLICY_VIOLATION);

	console.log("\n5. Internal server error:");
	demonstrateCloseCode(WS_CLOSE_INTERNAL_ERROR);

	console.log("\n6. Service restart (should reconnect):");
	demonstrateCloseCode(WS_CLOSE_SERVICE_RESTART);

	console.log("\n7. Try again later (server overload):");
	demonstrateCloseCode(WS_CLOSE_TRY_AGAIN_LATER);

	console.log("\n8. Reserved codes (cannot be set by application):");
	demonstrateCloseCode(WS_CLOSE_NO_STATUS);
	demonstrateCloseCode(WS_CLOSE_ABNORMAL);

	// Part 2: Demonstrate actual close scenarios
	console.log("\n\n--- Actual WebSocket Close Scenarios ---");

	const server = serve({
		hostname: "127.0.0.1",
		port: 8091,
	});

	console.log("\nServer started on ws://127.0.0.1:8091");

	// Scenario 1: Normal closure
	console.log("\n1. Testing Normal Closure:");
	const ws1 = new WebSocket("ws://127.0.0.1:8091/test");
	await new Promise((resolve) => {
		ws1.onopen = resolve;
	});
	console.log("  Connected");

	ws1.onclose = (event) => {
		console.log(
			`  Closed with code ${event.code}: ${getCloseCodeDescription(event.code)}`,
		);
		if (canReconnect(event.code)) {
			console.log("  → Would reconnect");
		} else {
			console.log("  → No reconnection needed");
		}
	};

	ws1.close(WS_CLOSE_NORMAL, "Task completed");
	await delay(100);

	// Scenario 2: Service restart
	console.log("\n2. Testing Service Restart:");
	const ws2 = new WebSocket("ws://127.0.0.1:8091/test");
	await new Promise((resolve) => {
		ws2.onopen = resolve;
	});
	console.log("  Connected");

	ws2.onclose = (event) => {
		console.log(
			`  Closed with code ${event.code}: ${getCloseCodeDescription(event.code)}`,
		);
		if (canReconnect(event.code)) {
			console.log("  → Would attempt reconnection after delay");
		}
	};

	ws2.close(WS_CLOSE_SERVICE_RESTART, "Server restarting");
	await delay(100);

	// Scenario 3: Policy violation (no reconnect)
	console.log("\n3. Testing Policy Violation:");
	const ws3 = new WebSocket("ws://127.0.0.1:8091/test");
	await new Promise((resolve) => {
		ws3.onopen = resolve;
	});
	console.log("  Connected");

	ws3.onclose = (event) => {
		console.log(
			`  Closed with code ${event.code}: ${getCloseCodeDescription(event.code)}`,
		);
		if (!canReconnect(event.code)) {
			console.log("  → No reconnection (policy violation)");
		}
	};

	ws3.close(WS_CLOSE_POLICY_VIOLATION, "Rate limit exceeded");
	await delay(100);

	// Scenario 4: Server error (should reconnect)
	console.log("\n4. Testing Internal Server Error:");
	const ws4 = new WebSocket("ws://127.0.0.1:8091/test");
	await new Promise((resolve) => {
		ws4.onopen = resolve;
	});
	console.log("  Connected");

	ws4.onclose = (event) => {
		console.log(
			`  Closed with code ${event.code}: ${getCloseCodeDescription(event.code)}`,
		);
		if (canReconnect(event.code)) {
			console.log("  → Would attempt reconnection (transient error)");
		}
	};

	ws4.close(WS_CLOSE_INTERNAL_ERROR, "Database connection failed");
	await delay(100);

	// Cleanup
	await server.stop(true);
	console.log("\n=== Example Complete ===");

	console.log("\n\nSummary:");
	console.log(
		"- Use getCloseCodeDescription() for user-friendly error messages",
	);
	console.log("- Use canReconnect() to implement smart reconnection logic");
	console.log(
		"- Use isReservedCloseCode() to validate application close codes",
	);
	console.log("- Codes 1000-1003, 1008-1014 are for application use");
	console.log(
		"- Codes 1005, 1006, 1015 are reserved (set by WebSocket implementation)",
	);
	console.log(
		"- Reconnect for: going away, abnormal, server error, service restart, try again, bad gateway",
	);
}

if (import.meta.main) {
	await closeCodesExample();
}
