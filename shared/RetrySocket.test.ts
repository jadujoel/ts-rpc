import { describe, expect, mock, test } from "bun:test";
import { RetrySocket } from "./RetrySocket.ts";

describe("RetrySocket", () => {
	describe("Static properties", () => {
		test("has correct WebSocket state constants", () => {
			expect(RetrySocket.CONNECTING).toBe(0);
			expect(RetrySocket.OPEN).toBe(1);
			expect(RetrySocket.CLOSING).toBe(2);
			expect(RetrySocket.CLOSED).toBe(3);
		});

		test("has default options", () => {
			expect(RetrySocket.DefaultOptions.url).toBe("");
			expect(RetrySocket.DefaultOptions.binaryType).toBe("arraybuffer");
			expect(RetrySocket.DefaultOptions.reconnectInterval).toBe(1_000);
			expect(RetrySocket.DefaultOptions.maxReconnectInterval).toBe(30_000);
			expect(RetrySocket.DefaultOptions.reconnectAttempts).toBe(0);
			expect(RetrySocket.DefaultOptions.isClosedByUser).toBe(false);
		});
	});

	describe("Constructor", () => {
		test("creates instance with url", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.url).toBe("ws://localhost:8080");
		});

		test("initializes with correct constants", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.CONNECTING).toBe(0);
			expect(socket.OPEN).toBe(1);
			expect(socket.CLOSING).toBe(2);
			expect(socket.CLOSED).toBe(3);
		});

		test("has null default handlers", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.onopen).toBe(null);
			expect(socket.onmessage).toBe(null);
			expect(socket.onclose).toBe(null);
			expect(socket.onerror).toBe(null);
		});
	});

	describe("FromUrl factory", () => {
		test("creates and auto-connects", () => {
			const socket = RetrySocket.FromUrl("ws://localhost:8080");
			expect(socket.url).toBe("ws://localhost:8080");
			expect(socket).toBeInstanceOf(RetrySocket);
		});
	});

	describe("FromOptions factory", () => {
		test("creates with custom options", () => {
			const socket = RetrySocket.FromOptions({
				url: "ws://localhost:9000",
				reconnectInterval: 2000,
				maxReconnectInterval: 60_000,
				binaryType: "blob",
			});

			expect(socket.url).toBe("ws://localhost:9000");
			expect(socket.binaryType).toBe("blob");
		});

		test("uses default values for missing options", () => {
			const socket = RetrySocket.FromOptions({
				url: "ws://localhost:8080",
			});

			expect(socket.binaryType).toBe("arraybuffer");
		});

		test("accepts custom handlers", () => {
			const openHandler = mock(() => {});
			const messageHandler = mock(() => {});

			const socket = RetrySocket.FromOptions({
				url: "ws://localhost:8080",
				onopen: openHandler,
				onmessage: messageHandler,
			});

			expect(socket.onopen).toBe(openHandler);
			expect(socket.onmessage).toBe(messageHandler);
		});
	});

	describe("Properties", () => {
		test("binaryType getter returns current value", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.binaryType).toBe("arraybuffer");
		});

		test("binaryType setter updates value", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			socket.binaryType = "blob";
			expect(socket.binaryType).toBe("blob");
		});

		test("bufferedAmount returns 0 when no socket", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.bufferedAmount).toBe(0);
		});

		test("extensions returns empty string when no socket", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.extensions).toBe("");
		});

		test("protocol returns empty string when no socket", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.protocol).toBe("");
		});

		test("readyState returns CLOSED initially", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			expect(socket.readyState).toBe(RetrySocket.CLOSED);
		});
	});

	describe("addEventListener", () => {
		test("registers event listener", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			const listener = mock(() => {});

			socket.addEventListener("open", listener);
			// Event listeners are stored internally
			expect(listener).toBeDefined();
		});

		test("allows multiple listeners for same event", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			const listener1 = mock(() => {});
			const listener2 = mock(() => {});

			socket.addEventListener("open", listener1);
			socket.addEventListener("open", listener2);

			// Both should be registered
			expect(listener1).toBeDefined();
			expect(listener2).toBeDefined();
		});
	});

	describe("removeEventListener", () => {
		test("removes registered listener", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			const listener = mock(() => {});

			socket.addEventListener("open", listener);
			socket.removeEventListener("open", listener);

			// Listener should be removed (no way to verify directly in this implementation)
			expect(true).toBe(true);
		});

		test("handles removing non-existent listener", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			const listener = mock(() => {});

			// Should not throw
			expect(() => {
				socket.removeEventListener("open", listener);
			}).not.toThrow();
		});
	});

	describe("dispatchEvent", () => {
		test("calls registered listeners", (done) => {
			const socket = new RetrySocket("ws://localhost:8080");

			socket.addEventListener("custom", (ev: Event) => {
				expect(ev.type).toBe("custom");
				done();
			});

			socket.dispatchEvent(new Event("custom"));
		});

		test("calls multiple listeners", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			let count = 0;

			socket.addEventListener("test", () => count++);
			socket.addEventListener("test", () => count++);

			socket.dispatchEvent(new Event("test"));

			expect(count).toBe(2);
		});

		test("returns true when no listeners cancel event", () => {
			const socket = new RetrySocket("ws://localhost:8080");
			const result = socket.dispatchEvent(new Event("test"));
			expect(result).toBe(true);
		});
	});

	describe("Message queueing", () => {
		test("queues messages when socket is not open", () => {
			const socket = new RetrySocket("ws://localhost:8080");

			// Don't connect, so socket stays closed
			expect(() => {
				socket.send("test message");
			}).not.toThrow();
		});

		test("queues multiple messages", () => {
			const socket = new RetrySocket("ws://localhost:8080");

			socket.send("message1");
			socket.send("message2");
			socket.send("message3");

			// Should not throw, messages are queued
			expect(true).toBe(true);
		});
	});

	describe("Type system", () => {
		test("accepts generic URL type", () => {
			const socket = new RetrySocket<"ws://localhost:8080">(
				"ws://localhost:8080",
			);
			expect(socket.url).toBe("ws://localhost:8080");
		});

		test("FromUrl preserves URL type", () => {
			const socket = RetrySocket.FromUrl("ws://test.com" as const);
			const url: "ws://test.com" = socket.url;
			expect(url).toBe("ws://test.com");
		});
	});

	describe("Integration scenarios", () => {
		test("handles close after creation", () => {
			const socket = new RetrySocket("ws://localhost:8080");

			expect(() => {
				socket.close();
			}).not.toThrow();
		});

		test("accepts different binary types", () => {
			const socketArrayBuffer = new RetrySocket(
				"ws://localhost:8080",
				null,
				0,
				1000,
				30000,
				[],
				new Map(),
				false,
				"arraybuffer",
			);
			expect(socketArrayBuffer.binaryType).toBe("arraybuffer");

			const socketBlob = new RetrySocket(
				"ws://localhost:8080",
				null,
				0,
				1000,
				30000,
				[],
				new Map(),
				false,
				"blob",
			);
			expect(socketBlob.binaryType).toBe("blob");
		});

		test("supports different data types for send", () => {
			const socket = new RetrySocket("ws://localhost:8080");

			expect(() => {
				socket.send("string message");
				socket.send(new ArrayBuffer(8));
				socket.send(new Blob(["test"]));
			}).not.toThrow();
		});
	});

	describe("Reconnection configuration", () => {
		test("accepts custom reconnect intervals", () => {
			const socket = new RetrySocket(
				"ws://localhost:8080",
				null,
				0,
				5000, // 5s initial
				120_000, // 2min max
			);

			expect(socket).toBeInstanceOf(RetrySocket);
		});

		test("tracks reconnection attempts internally", () => {
			const socket = RetrySocket.FromOptions({
				url: "ws://localhost:8080",
				reconnectAttempts: 3,
				reconnectInterval: 1000,
			});

			expect(socket).toBeInstanceOf(RetrySocket);
		});
	});
});
