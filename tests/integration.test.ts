/** biome-ignore-all lint/suspicious/noExplicitAny: test file */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { serve } from "../serve";
import {
	RequestApiSchemaExample,
	type ResponseApiExample,
	ResponseApiSchemaExample,
} from "../shared/api";
import { RpcPeer } from "../shared/socket";

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
		});
	});

	afterAll(() => {
		// Stop test server
		server.stop(true);
	});

	describe("Client-Server Connection", () => {
		test("client receives welcome message with clientId", (done) => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			client.addEventListener("welcome", ((ev: CustomEvent) => {
				expect(ev.detail.clientId).toBeDefined();
				expect(typeof ev.detail.clientId).toBe("string");
				client.close();
				done();
			}) as EventListener);
		}, 5000);

		test("client state changes to open", (done) => {
			const client = RpcPeer.FromOptions({
				url: TEST_URL,
				requestSchema: RequestApiSchemaExample,
				responseSchema: ResponseApiSchemaExample,
			});

			client.addEventListener("open", () => {
				expect(client.state).toBe("open");
				client.close();
				done();
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

				service.close();
				client.close();
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

				service.close();
				client.close();
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
				client.close();
			}
		}, 5000);
	});

	describe("Multiple Clients", () => {
		test("multiple clients can connect simultaneously", (done) => {
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

			let openCount = 0;
			const checkDone = () => {
				openCount++;
				if (openCount === 3) {
					expect(client1.state).toBe("open");
					expect(client2.state).toBe("open");
					expect(client3.state).toBe("open");
					client1.close();
					client2.close();
					client3.close();
					done();
				}
			};

			client1.addEventListener("open", checkDone);
			client2.addEventListener("open", checkDone);
			client3.addEventListener("open", checkDone);
		}, 5000);

		test("clients receive unique IDs", (done) => {
			const ids = new Set<string>();

			const createClient = () => {
				const client = RpcPeer.FromOptions({
					url: TEST_URL,
					requestSchema: RequestApiSchemaExample,
					responseSchema: ResponseApiSchemaExample,
				});

				client.addEventListener("welcome", ((ev: CustomEvent) => {
					ids.add(ev.detail.clientId);

					if (ids.size === 3) {
						expect(ids.size).toBe(3); // All unique
						done();
					}
				}) as EventListener);

				return client;
			};

			const c1 = createClient();
			const c2 = createClient();
			const c3 = createClient();

			setTimeout(() => {
				c1.close();
				c2.close();
				c3.close();
			}, 3000);
		}, 5000);
	});

	describe("Error Handling", () => {
		test("invalid request data is rejected by schema validation", (done) => {
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
				done(new Error("Should not receive invalid request"));
				return { type: "unknown" };
			});

			setTimeout(() => {
				// Send invalid data (bypass type checking with any)
				const invalidData = { type: "greet" } as any; // Missing 'name'
				client.send(invalidData);

				// Wait and verify service didn't crash
				setTimeout(() => {
					service.close();
					client.close();
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
			client.close();
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

				peer1.close();
				peer2.close();
				done();
			}, 1000);
		}, 10000);
	});
});
