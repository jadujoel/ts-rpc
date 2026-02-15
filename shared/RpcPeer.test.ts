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
});
