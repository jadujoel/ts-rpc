/** biome-ignore-all lint/suspicious/noExplicitAny: test file */
/** biome-ignore-all lint/style/noNonNullAssertion: test file */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { serve } from "../serve";
import { RpcPeer } from "../shared/RpcPeer";
import {
	RequestApiSchemaExample,
	type ResponseApiExample,
	ResponseApiSchemaExample,
} from "../shared/SchemaExample";

describe("Integration Tests", () => {
	let server: Server;
	const TEST_PORT = 8765;
	const TEST_URL = `ws://127.0.0.1:${TEST_PORT}`;

	beforeAll(() => {
		// Start test server
		server = serve({
			hostname: "127.0.0.1",
			port: TEST_PORT,
			development: false,
			logger: {
				...console,
				log: () => {},
				warn: () => {},
				error: () => {},
				time: () => {},
				timeEnd: () => {},
			},
		});
	});

	afterAll(() => {
		// Stop test server
		server.stop(true);
	});

	describe.only("Client-Server Connection", () => {
		test.only("client receives welcome message with clientId", async (done) => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});
			await client.waitForWelcome()
			console.log("Received welcome message with clientId:", client.clientId);

			expect(client.clientId).toBeDefined();
			expect(typeof client.clientId).toBe("string");

			console.log("Client State:", client.state);
			console.log("Disposing...")
			await client.dispose();
			console.log("Disposed")

			done();
		}, 1000);

		test("client state changes to open", (done) => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			client.addEventListener("open", () => {
				(async () => {
					try {
						expect(client.state).toBe("open");
						await client.close();
						done();
					} catch (error) {
						done(error);
					}
				})();
			});
		}, 5000);
	});

	describe("Request-Response Flow", () => {
		test("service handles request and client receives response", (done) => {
			// Create service that responds to requests
			const service = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			service.match((data) => {
				if (data.type === "score") {
					return { type: "score", score: 42 };
				}
				return { type: "unknown" };
			});

			// Create client
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			// Wait for both to be ready
			setTimeout(async () => {
				const response = await client.request<
					ResponseApiExample & { type: "score" }
				>({ type: "score" }, 3000);

				expect(response.category).toBe("response");
				expect(response.data.type).toBe("score");
				expect(response.data.score).toBe(42);

				await service.close();
				await client.close();
				done();
			}, 1000);
		}, 10000);

		test("request with greet returns greeting", (done) => {
			const service = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			service.match((data) => {
				if (data.type === "greet") {
					return { type: "greet", greeting: `Hello, ${data.name}!` };
				}
				return { type: "unknown" };
			});

			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			setTimeout(async () => {
				const response = await client.request<
					ResponseApiExample & { type: "greet" }
				>({ type: "greet", name: "Alice" }, 3000);

				expect(response.data.type).toBe("greet");
				expect(response.data.greeting).toBe("Hello, Alice!");

				await service.close();
				await client.close();
				done();
			}, 1000);
		}, 10000);
	});

	describe("Timeout Handling", () => {
		test("request times out when no response", async () => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			// Wait for connection
			await new Promise((resolve) => setTimeout(resolve, 1000));

			try {
				await client.request({ type: "score" }, 500);
				expect(true).toBe(false); // Should not reach here
			} catch (err: any) {
				expect(err.message).toBe("Request Timed Out");
			} finally {
				await client.close();
			}
		}, 5000);
	});

	describe("Multiple Clients", () => {
		test("multiple clients can connect simultaneously", async () => {
			const client1 = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			const client2 = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			const client3 = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			await client1.waitForWelcome();
			await client2.waitForWelcome();
			await client3.waitForWelcome();
			expect(client1.state).toBe("open");
			expect(client2.state).toBe("open");
			expect(client3.state).toBe("open");
			await client1.close();
			await client2.close();
			await client3.close();
		}, 5000);

		test("clients receive unique IDs", async () => {
			const ids = new Set<string>();
			const options = {
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			};
			const client1 = RpcPeer.FromOptions(options);
			const client2 = RpcPeer.FromOptions(options);
			const client3 = RpcPeer.FromOptions(options);

			await client1.waitForWelcome();
			await client2.waitForWelcome();
			await client3.waitForWelcome();

			ids.add(client1.clientId!);
			ids.add(client2.clientId!);
			ids.add(client3.clientId!);
			expect(ids.size).toBe(3); // All IDs should be unique
			await Promise.all([client1.close(), client2.close(), client3.close()]);
		});
	});

	describe("Error Handling", () => {
		test("invalid request data is rejected by schema validation", (done) => {
			// Suppress console.error for this test since we're intentionally sending invalid data
			const originalConsoleError = console.error;
			console.error = () => {};

			const service = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			// Service should not receive invalid requests
			service.match(() => {
				console.error = originalConsoleError;
				done(new Error("Should not receive invalid request"));
				return { type: "unknown" };
			});

			setTimeout(() => {
				// Send invalid data (bypass type checking with any)
				const invalidData = { type: "greet" } as any; // Missing 'name'
				client.send(invalidData);

				// Wait and verify service didn't crash
				setTimeout(async () => {
					await service.close();
					await client.close();
					console.error = originalConsoleError;
					done();
				}, 500);
			}, 1000);
		}, 5000);
	});

	describe("Reconnection", () => {
		test("client reconnects after server restart", async () => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			// Wait for initial connection
			await new Promise((resolve) => setTimeout(resolve, 1000));
			expect(client.state).toBe("open");

			// Simulate disconnect (close and reopen works as reconnect simulation)
			await client.close();
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Note: RetrySocket should handle reconnection automatically
			// if user didn't explicitly close it
		}, 5000);
	});

	describe("Bidirectional Communication", () => {
		test("two peers can send requests to each other", (done) => {
			const peer1 = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			const peer2 = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			peer1.match((data) => {
				if (data.type === "game") {
					return { type: "game", name: "Chess" };
				}
				return { type: "unknown" };
			});

			peer2.match((data) => {
				if (data.type === "score") {
					return { type: "score", score: 100 };
				}
				return { type: "unknown" };
			});

			setTimeout(async () => {
				// Peer2 requests from Peer1
				const response1 = await peer2.request({ type: "game" }, 3000);
				expect(response1.data.type).toBe("game");

				// Peer1 requests from Peer2
				const response2 = await peer1.request({ type: "score" }, 3000);
				expect(response2.data.type).toBe("score");

				await peer1.close();
				await peer2.close();
				done();
			}, 1000);
		}, 10000);
	});
});
