/** biome-ignore-all lint/suspicious/noExplicitAny: test file */
/** biome-ignore-all lint/style/noNonNullAssertion: test file */
/** biome-ignore-all lint/complexity/noBannedTypes: test file */
import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { RpcMessageSchema, RpcPeer } from "./RpcPeer.ts";

describe("RpcMessageSchema", () => {
	test("validates request message", () => {
		const message = {
			category: "request",
			requestId: "req-123",
			data: { type: "test" },
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	test("validates request message with from and to", () => {
		const message = {
			category: "request",
			requestId: "req-123",
			from: "client-1",
			to: "client-2",
			data: { type: "test" },
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	test("validates response message", () => {
		const message = {
			category: "response",
			requestId: "req-123",
			data: { result: "success" },
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	test("validates welcome message", () => {
		const message = {
			category: "welcome",
			clientId: "client-abc-123",
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	test("rejects message with invalid category", () => {
		const message = {
			category: "invalid",
			requestId: "req-123",
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(false);
	});

	test("rejects request without requestId", () => {
		const message = {
			category: "request",
			data: { type: "test" },
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(false);
	});

	test("rejects welcome without clientId", () => {
		const message = {
			category: "welcome",
		};
		const result = RpcMessageSchema.safeParse(message);
		expect(result.success).toBe(false);
	});
});

describe("Promise.withResolvers polyfill", () => {
	test("creates a deferred promise", () => {
		const { promise, resolve, reject } = Promise.withResolvers();
		expect(promise).toBeInstanceOf(Promise);
		expect(typeof resolve).toBe("function");
		expect(typeof reject).toBe("function");
	});

	test("resolve works correctly", async () => {
		const { promise, resolve } = Promise.withResolvers();
		resolve(42);
		const result = await promise;
		expect(result).toBe(42);
	});

	test("reject works correctly", async () => {
		const { promise, reject } = Promise.withResolvers();
		reject(new Error("test error"));
		try {
			await promise;
			expect(true).toBe(false); // Should not reach here
		} catch (err: any) {
			expect(err.message).toBe("test error");
		}
	});
});

// Mock WebSocket for testing
class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	binaryType: BinaryType = "arraybuffer";
	url: string;
	private listeners: Map<string, Set<Function>> = new Map();

	constructor(url: string) {
		this.url = url;
		// Auto-open after a tick
		setTimeout(() => {
			this.readyState = MockWebSocket.OPEN;
			this.trigger("open", new Event("open"));
		}, 0);
	}

	send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
		if (this.readyState !== MockWebSocket.OPEN) {
			throw new Error("WebSocket is not open");
		}
		// Echo back for testing
		setTimeout(() => {
			const message = typeof data === "string" ? data : "binary";
			this.trigger("message", { data: message });
		}, 0);
	}

	close() {
		this.readyState = MockWebSocket.CLOSING;
		setTimeout(() => {
			this.readyState = MockWebSocket.CLOSED;
			this.trigger("close", new CloseEvent("close"));
		}, 0);
	}

	addEventListener(type: string, listener: Function) {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)?.add(listener);
	}

	removeEventListener(type: string, listener: Function) {
		this.listeners.get(type)?.delete(listener);
	}

	private trigger(type: string, event: any) {
		const listeners = this.listeners.get(type);
		if (listeners) {
			listeners.forEach((listener) => {
				listener(event);
			});
		}
	}

	get bufferedAmount() {
		return 0;
	}
	get extensions() {
		return "";
	}
	get protocol() {
		return "";
	}

	CONNECTING = MockWebSocket.CONNECTING;
	OPEN = MockWebSocket.OPEN;
	CLOSING = MockWebSocket.CLOSING;
	CLOSED = MockWebSocket.CLOSED;
}

describe("RpcPeer", () => {
	// Note: Full RpcPeer tests require a running WebSocket server
	// These are unit tests for the basic structure

	test("FromOptions creates an instance", () => {
		const TestRequestSchema = z.object({ type: z.literal("test") });
		const TestResponseSchema = z.object({ result: z.string() });

		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: TestRequestSchema,
			responseSchema: TestResponseSchema,
		});

		expect(peer).toBeInstanceOf(RpcPeer);
		expect(peer.url).toBe("ws://localhost:8080");
	});

	test("state getter returns valid states", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		const state = peer.state;
		expect(["closed", "connecting", "open", "closing"]).toContain(state);
	});

	test("clientId is undefined initially", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		expect(peer.clientId).toBeUndefined();
	});

	test("pendingPromises map is initialized", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		expect(peer.pendingPromises).toBeInstanceOf(Map);
		expect(peer.pendingPromises.size).toBe(0);
	});

	test("handleMessage processes welcome messages", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		const welcomeEvent = new MessageEvent("message", {
			data: JSON.stringify({
				category: "welcome",
				clientId: "test-client-123",
			}),
		});

		peer.handleMessage(welcomeEvent);
		expect(peer.clientId).toBe("test-client-123");
	});

	test("handleMessage dispatches request event", (done) => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		peer.addEventListener("request", ((ev: CustomEvent) => {
			expect(ev.detail.category).toBe("request");
			expect(ev.detail.data.type).toBe("test");
			done();
		}) as EventListener);

		const requestEvent = new MessageEvent("message", {
			data: JSON.stringify({
				category: "request",
				requestId: "req-123",
				data: { type: "test" },
			}),
		});

		peer.handleMessage(requestEvent);
	});

	test("handleMessage validates request data with schema", () => {
		const strictSchema = z.object({ type: z.literal("valid") });
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: strictSchema,
			responseSchema: z.any(),
		});

		const consoleDebugMock = mock(() => {});
		const originalDebug = console.debug;
		console.debug = consoleDebugMock;

		// Invalid request
		const invalidEvent = new MessageEvent("message", {
			data: JSON.stringify({
				category: "request",
				requestId: "req-123",
				data: { type: "invalid" },
			}),
		});

		peer.handleMessage(invalidEvent);
		expect(consoleDebugMock).toHaveBeenCalled();

		console.debug = originalDebug;
	});

	test("send creates proper RPC request", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		// Mock the retrySocket.send
		const sendMock = mock(() => 0 as const);
		peer.retrySocket.send = sendMock;

		peer.send({ type: "test" });

		expect(sendMock).toHaveBeenCalled();
		const sentData = JSON.parse(sendMock.mock.calls.at(0)!.at(0)!);
		expect(sentData.category).toBe("request");
		expect(sentData.data.type).toBe("test");
		expect(sentData.requestId).toBeDefined();
	});

	test("request returns a promise", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		peer.retrySocket.send = mock(() => 0 as const);

		const promise = peer.request({ type: "test" });
		expect(promise).toBeInstanceOf(Promise);
	});

	test("request timeout rejects promise", async () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		peer.retrySocket.send = mock(() => 0 as const);

		const promise = peer.request({ type: "test" }, 100);

		try {
			await promise;
			expect(true).toBe(false); // Should not reach here
		} catch (err: any) {
			expect(err.message).toBe("Request timed out");
		}
	});

	test("respondTo sends response to correct recipient", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		const sendMock = mock(() => 0 as const);
		peer.retrySocket.send = sendMock;
		peer.clientId = "responder-123";

		const request = {
			category: "request" as const,
			requestId: "req-456",
			from: "requester-789",
			data: { type: "test" },
		};

		peer.respondTo(request, { result: "success" });

		expect(sendMock).toHaveBeenCalled();
		const sentData = JSON.parse(sendMock.mock.calls.at(0)!.at(0)!);
		expect(sentData.category).toBe("response");
		expect(sentData.requestId).toBe("req-456");
		expect(sentData.from).toBe("responder-123");
		expect(sentData.to).toBe("requester-789");
		expect(sentData.data.result).toBe("success");
	});

	test("match registers request handler", (done) => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		peer.retrySocket.send = mock(() => 0 as const);

		peer.match((data, from) => {
			expect(data.type).toBe("test");
			expect(from).toBe("sender-123");
			done();
			return { result: "handled" };
		});

		// Simulate incoming request
		const requestEvent = new MessageEvent("message", {
			data: JSON.stringify({
				category: "request",
				requestId: "req-789",
				from: "sender-123",
				data: { type: "test" },
			}),
		});

		peer.handleMessage(requestEvent);
	});

	test("call is alias for request", () => {
		const peer = RpcPeer.FromOptions({
			url: "ws://localhost:8080",
			requestSchema: z.any(),
			responseSchema: z.any(),
		});

		expect(peer.call).toBe(peer.request);
	});

	describe("dispose", () => {
		test("dispose closes connection and clears pending promises", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			// Make dispose not actually wait for close
			peer.retrySocket.close = mock(async () => {});
			peer.retrySocket.dispose = mock(async () => {});
			peer.retrySocket.send = mock(() => 0 as const);

			const promise = peer.request({ type: "test" }, 5000);

			await peer.dispose();

			// Promise should be rejected
			try {
				await promise;
				expect(true).toBe(false); // Should not reach here
			} catch (err: any) {
				expect(err.message).toBe("Connection closed");
			}

			expect(peer.pendingPromises.size).toBe(0);
		});
	});

	describe("state getter", () => {
		test("returns correct state names", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			const validStates = ["closed", "connecting", "open", "closing"];
			expect(validStates).toContain(peer.state);
		});
	});

	describe("welcomed", () => {
		test("returns false when clientId is undefined", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			expect(peer.welcomed()).toBe(false);
		});

		test("returns true when clientId is set", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			peer.clientId = "test-client-123";
			expect(peer.welcomed()).toBe(true);
		});
	});

	describe("waitForWelcome", () => {
		test("resolves immediately if already welcomed", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			peer.clientId = "existing-client-id";
			const clientId = await peer.waitForWelcome();
			expect(clientId).toBe("existing-client-id");
		});

		test("rejects on timeout if no welcome received", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			try {
				await peer.waitForWelcome(100);
				expect(true).toBe(false); // Should not reach here
			} catch (err: any) {
				expect(err.message).toBe("Request timed out");
			}
		});

		test("resolves when welcome event is received", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			const welcomePromise = peer.waitForWelcome(1000);

			// Dispatch welcome event
			setTimeout(() => {
				const welcomeEvent = new MessageEvent("message", {
					data: JSON.stringify({
						category: "welcome",
						clientId: "new-client-123",
					}),
				});
				peer.handleMessage(welcomeEvent);
			}, 50);

			const clientId = await welcomePromise;
			expect(clientId).toBe("new-client-123");
		});
	});

	describe("close", () => {
		test("resolves immediately if state is closed", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			// Close the peer first
			peer.retrySocket.close = mock(async () => {});
			await peer.close();

			// Now close again - should resolve immediately
			await expect(peer.close()).resolves.toBeUndefined();
		});

		test("accepts custom close code and reason", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			// Just verify the method accepts the parameters without error
			const closeMock = mock(async () => {});
			peer.retrySocket.close = closeMock;

			// Don't await, just verify it can be called
			peer.close(1001, "Going Away", 100);

			expect(closeMock).toHaveBeenCalled();
		});
	});

	describe("Static event factories", () => {
		test("ResponseEvent creates CustomEvent", () => {
			const response = {
				category: "response" as const,
				requestId: "req-123",
				data: { result: "success" },
			};

			const event = RpcPeer.ResponseEvent(response);
			expect(event).toBeInstanceOf(CustomEvent);
			expect(event.type).toBe("response");
			expect(event.detail).toEqual(response);
		});

		test("RequestEvent creates CustomEvent", () => {
			const request = {
				category: "request" as const,
				requestId: "req-456",
				data: { type: "test" },
			};

			const event = RpcPeer.RequestEvent(request);
			expect(event).toBeInstanceOf(CustomEvent);
			expect(event.type).toBe("request");
			expect(event.detail).toEqual(request);
		});

		test("WelcomeEvent creates CustomEvent", () => {
			const welcome = {
				category: "welcome" as const,
				clientId: "client-789",
			};

			const event = RpcPeer.WelcomeEvent(welcome);
			expect(event).toBeInstanceOf(CustomEvent);
			expect(event.type).toBe("welcome");
			expect(event.detail).toEqual(welcome);
		});
	});

	describe("Static Errors", () => {
		test("has InvalidMessageFormat error", () => {
			expect(RpcPeer.Errors.InvalidMessageFormat).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.InvalidMessageFormat.message).toBe(
				"Invalid message format",
			);
		});

		test("has InvalidRequestData error", () => {
			expect(RpcPeer.Errors.InvalidRequestData).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.InvalidRequestData.message).toBe(
				"Invalid request data",
			);
		});

		test("has InvalidResponseData error", () => {
			expect(RpcPeer.Errors.InvalidResponseData).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.InvalidResponseData.message).toBe(
				"Invalid response data",
			);
		});

		test("has RequestTimedOut error", () => {
			expect(RpcPeer.Errors.RequestTimedOut).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.RequestTimedOut.message).toBe("Request timed out");
		});

		test("has ConnectionClosed error", () => {
			expect(RpcPeer.Errors.ConnectionClosed).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.ConnectionClosed.message).toBe("Connection closed");
		});

		test("has CloseTimedOut error", () => {
			expect(RpcPeer.Errors.CloseTimedOut).toBeInstanceOf(Error);
			expect(RpcPeer.Errors.CloseTimedOut.message).toBe("Close timed out");
		});
	});

	describe("Static Timeouts", () => {
		test("has Request timeout", () => {
			expect(RpcPeer.Timeouts.Request).toBe(4_000);
		});

		test("has Close timeout", () => {
			expect(RpcPeer.Timeouts.Close).toBe(4_000);
		});

		test("has Welcome timeout", () => {
			expect(RpcPeer.Timeouts.Welcome).toBe(4_000);
		});
	});

	describe("handleMessage with invalid JSON", () => {
		test("returns false for invalid JSON", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			const invalidEvent = new MessageEvent("message", {
				data: "not valid json {",
			});

			const result = peer.handleMessage(invalidEvent);
			expect(result).toBe(false);
		});
	});

	describe("handleMessage with response", () => {
		test("resolves pending promise with response data", async () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			peer.retrySocket.send = mock(() => 0 as const);

			const requestPromise = peer.request({ type: "test" }, 5000);

			// Get the request ID that was sent
			const sentData = JSON.parse(
				(peer.retrySocket.send as any).mock.calls[0][0],
			);
			const requestId = sentData.requestId;

			// Simulate response
			const responseEvent = new MessageEvent("message", {
				data: JSON.stringify({
					category: "response",
					requestId: requestId,
					data: { result: "success" },
				}),
			});

			peer.handleMessage(responseEvent);

			const response = await requestPromise;
			expect(response.category).toBe("response");
			expect(response.data.result).toBe("success");
		});
	});

	describe("send includes from field", () => {
		test("includes from in request when clientId is set", () => {
			const peer = RpcPeer.FromOptions({
				url: "ws://localhost:8080",
				requestSchema: z.any(),
				responseSchema: z.any(),
			});

			peer.clientId = "sender-123";
			peer.retrySocket.send = mock(() => 0 as const);

			peer.send({ type: "test" });

			const sentData = JSON.parse(
				(peer.retrySocket.send as any).mock.calls[0][0],
			);
			expect(sentData.from).toBe("sender-123");
		});
	});

	describe("isWelcomeMessage helper", () => {
		test("returns true for valid welcome message", () => {
			const message = {
				category: "welcome",
				clientId: "test-123",
			};

			const result = RpcPeer.MessageSchema.safeParse(message);
			expect(result.success).toBe(true);
		});

		test("returns false for non-object", () => {
			const result = RpcPeer.MessageSchema.safeParse("not an object");
			expect(result.success).toBe(false);
		});
	});
});
