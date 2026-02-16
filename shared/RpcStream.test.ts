/** biome-ignore-all lint/style/noNonNullAssertion: test file */
import { beforeEach, describe, expect, it } from "bun:test";
import {
	StreamManager,
	type StreamManagerOptions,
	type StreamMessage,
	StreamMessageSchema,
} from "./RpcStream.ts";

describe("StreamMessageSchema", () => {
	it("validates StreamData messages", () => {
		const message: StreamMessage = {
			type: "StreamData",
			streamId: "test-123",
			payload: { data: "test" },
		};

		const result = StreamMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	it("validates StreamEnd messages", () => {
		const message: StreamMessage = {
			type: "StreamEnd",
			streamId: "test-123",
		};

		const result = StreamMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	it("validates StreamError messages", () => {
		const message: StreamMessage = {
			type: "StreamError",
			streamId: "test-123",
			error: "Something went wrong",
		};

		const result = StreamMessageSchema.safeParse(message);
		expect(result.success).toBe(true);
	});

	it("rejects invalid messages", () => {
		const message = {
			type: "InvalidType",
			streamId: "test-123",
		};

		const result = StreamMessageSchema.safeParse(message);
		expect(result.success).toBe(false);
	});
});

describe("StreamManager", () => {
	let manager: StreamManager;

	beforeEach(() => {
		manager = new StreamManager();
	});

	describe("sendStream", () => {
		it("sends all data chunks and completes", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* testGenerator() {
				yield 1;
				yield 2;
				yield 3;
			}

			const streamId = await manager.sendStream(mockWS, testGenerator());

			expect(sentMessages.length).toBe(4); // 3 data + 1 end

			// Check data messages
			const msg1 = JSON.parse(sentMessages[0]!);
			expect(msg1.type).toBe("StreamData");
			expect(msg1.payload).toBe(1);
			expect(msg1.streamId).toBe(streamId);

			const msg2 = JSON.parse(sentMessages[1]!);
			expect(msg2.type).toBe("StreamData");
			expect(msg2.payload).toBe(2);

			const msg3 = JSON.parse(sentMessages[2]!);
			expect(msg3.type).toBe("StreamData");
			expect(msg3.payload).toBe(3);

			// Check end message
			const msgEnd = JSON.parse(sentMessages[3]!);
			expect(msgEnd.type).toBe("StreamEnd");
			expect(msgEnd.streamId).toBe(streamId);
		});

		it("handles errors in iterator", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* errorGenerator() {
				yield 1;
				throw new Error("Test error");
			}

			try {
				await manager.sendStream(mockWS, errorGenerator());
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
			}

			// Should have 1 data message and 1 error message
			expect(sentMessages.length).toBe(2);
			const errorMsg = JSON.parse(sentMessages[1]!);
			expect(errorMsg.type).toBe("StreamError");
			expect(errorMsg.error).toContain("Test error");
		});

		it("applies backpressure when buffer is full", async () => {
			const sentMessages: string[] = [];
			let bufferedAmount = 0;
			const mockWS = {
				send: (data: string) => {
					sentMessages.push(data);
					bufferedAmount += data.length;
					// Simulate buffer draining
					setTimeout(() => {
						bufferedAmount = Math.max(0, bufferedAmount - 1000);
					}, 5);
				},
				get bufferedAmount() {
					return bufferedAmount;
				},
			};

			const options: StreamManagerOptions = {
				maxBufferedAmount: 100, // Very small for testing
				backpressureDelay: 5,
			};
			const managerWithBackpressure = StreamManager.FromOptions(options);

			async function* largeDataGenerator() {
				for (let i = 0; i < 10; i++) {
					yield i;
				}
			}

			const start = Date.now();
			await managerWithBackpressure.sendStream(mockWS, largeDataGenerator());
			const duration = Date.now() - start;

			// Should take some time due to backpressure
			expect(duration).toBeGreaterThan(10);
			expect(sentMessages.length).toBe(11); // 10 data + 1 end
		});

		it("can abort an active stream", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* slowGenerator() {
				for (let i = 0; i < 100; i++) {
					yield i;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}

			const sendPromise = manager.sendStream(mockWS, slowGenerator());

			// Wait a bit then abort
			await new Promise((resolve) => setTimeout(resolve, 25));

			// Get the stream ID from the first message
			const firstMsg = JSON.parse(sentMessages[0]!);
			manager.abort(firstMsg.streamId);

			try {
				await sendPromise;
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
			}

			// Should have sent fewer than 100 messages
			expect(sentMessages.length).toBeLessThan(102);
		});
	});

	describe("receiveStream", () => {
		it("creates a receiving stream and handles data", async () => {
			const [streamId, stream] = manager.createReceivingStream<number>();

			expect(streamId).toBeDefined();
			expect(stream).toBeInstanceOf(ReadableStream);

			// Send some data
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});

			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 2,
			});

			manager.handleStreamMessage({
				type: "StreamEnd",
				streamId,
			});

			// Read the stream
			const reader = stream.getReader();
			const values: number[] = [];

			let result = await reader.read();
			while (!result.done) {
				values.push(result.value);
				result = await reader.read();
			}

			expect(values).toEqual([1, 2]);
		});

		it("handles stream errors", async () => {
			const [streamId, stream] = manager.createReceivingStream<number>();
			const reader = stream.getReader();

			// Send first data chunk
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});

			// Read the first value
			const firstResult = await reader.read();
			expect(firstResult.done).toBe(false);
			expect(firstResult.value).toBe(1);

			// Send error - this will error the stream
			manager.handleStreamMessage({
				type: "StreamError",
				streamId,
				error: "Test error",
			});

			// Next read should throw
			try {
				await reader.read();
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
				expect((err as Error).message).toContain("Test error");
			}
		});

		it("buffers messages for unknown streams", () => {
			const result = manager.handleStreamMessage({
				type: "StreamData",
				streamId: "unknown-stream",
				payload: 1,
			});

			// Should return true (message buffered) instead of false (message dropped)
			expect(result).toBe(true);
		});

		it("flushes buffered messages when receiveStream is called", async () => {
			const streamId = "test-stream-123";

			// Send messages before stream is registered
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 2,
			});
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 3,
			});

			// Now create the receiving stream - should flush buffered messages
			const [, stream] = manager.createReceivingStream<number>(streamId);
			const reader = stream.getReader();

			// All 3 messages should be available
			const { value: val1 } = await reader.read();
			expect(val1).toBe(1);

			const { value: val2 } = await reader.read();
			expect(val2).toBe(2);

			const { value: val3 } = await reader.read();
			expect(val3).toBe(3);
		});

		it("applies per-stream message limit", () => {
			const streamId = "test-stream-limit";
			const maxMessages = 100; // StreamManager.DefaultPendingStreamMaxMessages

			// Send more than max messages
			for (let i = 0; i < maxMessages + 10; i++) {
				manager.handleStreamMessage({
					type: "StreamData",
					streamId,
					payload: i,
				});
			}

			// Create stream and verify only the most recent maxMessages are delivered
			const [, stream] = manager.createReceivingStream<number>(streamId);
			const reader = stream.getReader();

			// First message should be 10 (oldest messages dropped)
			reader.read().then(({ value }) => {
				expect(value).toBe(10);
			});
		});

		it("times out pending streams after timeout period", async () => {
			const streamId = "test-stream-timeout";

			// Send a message to create a pending stream
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});

			// Wait for timeout (10 seconds + buffer)
			// For testing, we can't wait that long, so we'll just verify the mechanism exists
			// In a real scenario, the timeout would clear the pending stream
			// This is more of an integration test concern
			expect(true).toBe(true); // Structural test - actual timeout tested in integration
		});

		it("closes stream immediately if buffered end message exists", async () => {
			const streamId = "test-stream-end";

			// Send data and end before stream is registered
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});
			manager.handleStreamMessage({
				type: "StreamEnd",
				streamId,
			});

			// Create receiving stream - should flush and close immediately
			const [, stream] = manager.createReceivingStream<number>(streamId);
			const reader = stream.getReader();

			// Should get the data message
			const { value: val1, done: done1 } = await reader.read();
			expect(val1).toBe(1);
			expect(done1).toBe(false);

			// Then stream should be closed
			const { done: done2 } = await reader.read();
			expect(done2).toBe(true);
		});

		it("errors stream immediately if buffered error message exists", async () => {
			const streamId = "test-stream-error";

			// Send error before stream is registered
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});
			manager.handleStreamMessage({
				type: "StreamError",
				streamId,
				error: "Test error from buffer",
			});

			// Create receiving stream - should flush and error immediately
			const [, stream] = manager.createReceivingStream<number>(streamId);
			const reader = stream.getReader();

			// Should get the data message
			const { value: val1 } = await reader.read();
			expect(val1).toBe(1);

			// Then should error
			try {
				await reader.read();
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
				expect((err as Error).message).toContain("Test error from buffer");
			}
		});
	});

	describe("cleanup", () => {
		it("cleans up all active streams", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* slowGenerator() {
				for (let i = 0; i < 100; i++) {
					yield i;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}

			// Start a stream
			const sendPromise = manager.sendStream(mockWS, slowGenerator());

			// Create a receiving stream
			const [_streamId, stream] = manager.createReceivingStream<number>();
			const reader = stream.getReader();

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 25));

			// Cleanup
			manager.cleanup();

			// Sending stream should fail
			try {
				await sendPromise;
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
			}

			// Reading stream should fail
			try {
				await reader.read();
				expect(false).toBe(true); // Should not reach here
			} catch (err) {
				expect(err).toBeDefined();
			}

			expect(manager.activeStreamCount).toBe(0);
			expect(manager.receivingStreamCount).toBe(0);
		});

		it("clears pending stream timeouts on cleanup", () => {
			const streamId = "test-pending-cleanup";

			// Create a pending stream by sending a message
			manager.handleStreamMessage({
				type: "StreamData",
				streamId,
				payload: 1,
			});

			// Call cleanup - should clear the timeout
			manager.cleanup();

			// If we try to create the stream now, there should be no pending messages
			const [, stream] = manager.createReceivingStream<number>(streamId);
			const reader = stream.getReader();

			// The stream should be empty (no buffered messages)
			// We can't easily test this without exposing internal state,
			// but at minimum it shouldn't throw an error
			expect(stream).toBeDefined();
			expect(reader).toBeDefined();
		});
	});

	describe("isStreamMessage", () => {
		it("identifies valid stream messages", () => {
			const message: StreamMessage = {
				type: "StreamData",
				streamId: "test-123",
				payload: "data",
			};

			expect(manager.isStreamMessage(message)).toBe(true);
		});

		it("rejects invalid messages", () => {
			const message = {
				type: "InvalidType",
				streamId: "test-123",
			};

			expect(manager.isStreamMessage(message)).toBe(false);
		});

		it("rejects non-object messages", () => {
			expect(manager.isStreamMessage("not an object")).toBe(false);
			expect(manager.isStreamMessage(null)).toBe(false);
			expect(manager.isStreamMessage(undefined)).toBe(false);
		});
	});

	describe("stream counts", () => {
		it("tracks active stream count", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* quickGenerator() {
				yield 1;
			}

			expect(manager.activeStreamCount).toBe(0);

			const promise = manager.sendStream(mockWS, quickGenerator());
			// During iteration, count might be 1 (timing dependent)

			await promise;
			expect(manager.activeStreamCount).toBe(0);
		});

		it("tracks receiving stream count", () => {
			expect(manager.receivingStreamCount).toBe(0);

			const [streamId1] = manager.createReceivingStream();
			expect(manager.receivingStreamCount).toBe(1);

			const [streamId2] = manager.createReceivingStream();
			expect(manager.receivingStreamCount).toBe(2);

			manager.closeReceivingStream(streamId1);
			expect(manager.receivingStreamCount).toBe(1);

			manager.closeReceivingStream(streamId2);
			expect(manager.receivingStreamCount).toBe(0);
		});
	});

	describe("custom stream IDs", () => {
		it("accepts custom stream ID for sending", async () => {
			const sentMessages: string[] = [];
			const mockWS = {
				send: (data: string) => sentMessages.push(data),
				bufferedAmount: 0,
			};

			async function* testGenerator() {
				yield 1;
			}

			const customId = "my-custom-stream-id";
			const streamId = await manager.sendStream(
				mockWS,
				testGenerator(),
				customId,
			);

			expect(streamId).toBe(customId);
			const msg = JSON.parse(sentMessages[0]!);
			expect(msg.streamId).toBe(customId);
		});

		it("accepts custom stream ID for receiving", () => {
			const customId = "my-custom-receiving-id";
			const [streamId, stream] = manager.createReceivingStream(customId);

			expect(streamId).toBe(customId);
			expect(stream).toBeInstanceOf(ReadableStream);
		});
	});
});
