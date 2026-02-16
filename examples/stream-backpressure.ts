/**
 * Example demonstrating advanced RpcStream features with backpressure
 *
 * This example shows:
 * 1. Backpressure handling with slow consumers
 * 2. Multiple concurrent streams over one connection
 * 3. Bidirectional streaming (both peers sending streams)
 * 4. Stream abort from sender side
 * 5. Visualization of buffer behavior and delays
 */

import { z } from "zod";
import { serve } from "../serve.ts";
import { RpcPeer } from "../shared/RpcPeer.ts";

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define schemas
const RequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("fast-stream"),
		count: z.number(),
	}),
	z.object({
		type: z.literal("large-data-stream"),
		chunks: z.number(),
		chunkSize: z.number(),
	}),
	z.object({
		type: z.literal("bidirectional"),
		clientStreamId: z.string(),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("stream"),
		streamId: z.string(),
		description: z.string(),
	}),
	z.object({
		type: z.literal("ack"),
		message: z.string(),
	}),
]);

export async function streamBackpressureExample() {
	console.log("=== RpcStream Advanced Features Example ===\n");

	console.debug = () => {}; // Disable debug logs

	const server = serve({
		hostname: "127.0.0.1",
		port: 8095,
	});

	console.log("Server started on ws://127.0.0.1:8095\n");

	// Create server peer
	const serverPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8095/stream",
		name: "Server",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Create client peer
	const clientPeer = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8095/stream",
		name: "Client",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
	});

	// Server handles stream requests
	serverPeer.match(async (data) => {
		switch (data.type) {
			case "fast-stream": {
				const count = data.count;
				// Create fast stream
				async function* fastStream() {
					for (let i = 1; i <= count; i++) {
						yield { index: i, timestamp: Date.now() };
						await delay(50); // Fast: 20 items/sec
					}
				}

				const streamId = await serverPeer.sendStream(fastStream());
				return {
					type: "stream" as const,
					streamId,
					description: `Fast stream with ${count} items`,
				};
			}

			case "large-data-stream": {
				// Create stream with large payloads to trigger backpressure
				const { chunks, chunkSize } = data;
				async function* largeDataStream() {
					console.log(
						`  [Server] Starting large data stream (${chunks} chunks × ${chunkSize} bytes)`,
					);
					let totalBytes = 0;

					for (let i = 1; i <= chunks; i++) {
						const chunk = "X".repeat(chunkSize);
						totalBytes += chunkSize;

						const startTime = Date.now();
						yield {
							chunkIndex: i,
							totalChunks: chunks,
							data: chunk,
							totalBytesSent: totalBytes,
						};
						const endTime = Date.now();

						const delayMs = endTime - startTime;
						if (delayMs > 5) {
							console.log(
								`  [Server] Chunk ${i} delayed by ${delayMs}ms (backpressure)`,
							);
						}

						await delay(10); // Small delay between chunks
					}
					console.log(
						`  [Server] Stream complete. Sent ${totalBytes} bytes total`,
					);
				}

				const streamId = await serverPeer.sendStream(largeDataStream());
				return {
					type: "stream" as const,
					streamId,
					description: "Large data stream",
				};
			}

			case "bidirectional": {
				// Server also sends a stream back
				async function* serverResponse() {
					for (let i = 1; i <= 5; i++) {
						yield { serverMessage: `Response ${i}`, timestamp: Date.now() };
						await delay(100);
					}
				}

				const streamId = await serverPeer.sendStream(serverResponse());

				return {
					type: "stream" as const,
					streamId,
					description: "Bidirectional response stream",
				};
			}
		}
	});

	await serverPeer.waitForWelcome();
	await clientPeer.waitForWelcome();

	console.log("Both peers connected\n");

	// Scenario 1: Multiple concurrent streams
	console.log("--- Scenario 1: Multiple Concurrent Streams ---");
	console.log("Starting 3 streams simultaneously...\n");

	// Request multiple streams concurrently - no race condition!
	const streamPromises = [
		clientPeer.call({ type: "fast-stream", count: 5 }),
		clientPeer.call({ type: "fast-stream", count: 5 }),
		clientPeer.call({ type: "fast-stream", count: 5 }),
	];

	const responses = await Promise.all(streamPromises);

	// Setup receivers for all streams
	const streamReaders = responses.map((response, index) => {
		if (response.data.type !== "stream") {
			console.log(`  [Stream${index + 1}] Failed to get stream`);
			return null;
		}

		const [, stream] = clientPeer.receiveStream<{
			index: number;
			timestamp: number;
		}>(response.data.streamId);
		return {
			streamName: `Stream${index + 1}`,
			reader: stream.getReader(),
		};
	});

	// Filter out nulls
	const validStreams = streamReaders.filter(
		(
			s,
		): s is {
			streamName: string;
			reader: ReadableStreamDefaultReader<{
				index: number;
				timestamp: number;
			}>;
		} => s !== null,
	);

	console.log("Consuming 3 streams concurrently:");

	const consumeStream = async (
		reader: ReadableStreamDefaultReader<{
			index: number;
			timestamp: number;
		}>,
		streamName: string,
	): Promise<void> => {
		let count = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				count++;
				console.log(`  [${streamName}] Item ${count}: index=${value.index}`);
			}
			console.log(`  [${streamName}] Complete (${count} items)\n`);
		} finally {
			reader.releaseLock();
		}
	};

	await Promise.all(
		validStreams.map(({ reader, streamName }) =>
			consumeStream(reader, streamName),
		),
	);

	// Scenario 2: Backpressure with large data
	console.log("\n--- Scenario 2: Backpressure with Large Data ---");
	console.log(
		"Sending large chunks to trigger backpressure (1MB buffer limit)...\n",
	);

	const largeDataResponse = await clientPeer.call({
		type: "large-data-stream",
		chunks: 20,
		chunkSize: 100_000, // 100KB chunks = 2MB total (exceeds 1MB buffer)
	});

	if (largeDataResponse.data.type === "stream") {
		const stream = clientPeer.receiveStream<{
			chunkIndex: number;
			totalChunks: number;
			data: string;
			totalBytesSent: number;
		}>(largeDataResponse.data.streamId);
		if (stream) {
			const reader = stream[1].getReader();
			let chunkCount = 0;
			let totalBytesReceived = 0;

			console.log("Client consuming slowly (500ms per chunk)...\n");

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					chunkCount++;
					totalBytesReceived += value.data.length;

					console.log(
						`  [Client] Chunk ${value.chunkIndex}/${value.totalChunks} received (${(totalBytesReceived / 1024).toFixed(0)}KB total)`,
					);

					// Slow consumer - introduces backpressure
					await delay(500);
				}

				console.log(
					`\n  [Client] Stream complete: ${chunkCount} chunks, ${(totalBytesReceived / 1024).toFixed(0)}KB total`,
				);
			} finally {
				reader.releaseLock();
			}
		}
	}

	// Scenario 3: Bidirectional streaming
	console.log("\n\n--- Scenario 3: Bidirectional Streaming ---");
	console.log("Both client and server sending streams...\n");

	// Client sends stream to server
	async function* clientStream() {
		console.log("  [Client] Sending stream to server...");
		for (let i = 1; i <= 5; i++) {
			yield { clientMessage: `Message ${i}`, timestamp: Date.now() };
			await delay(150);
		}
		console.log("  [Client] Stream sending complete");
	}

	const clientStreamId = await clientPeer.sendStream(clientStream());

	// Request server to send stream back
	const bidirectionalResponse = await clientPeer.call({
		type: "bidirectional",
		clientStreamId,
	});

	if (bidirectionalResponse.data.type === "stream") {
		// Consume server's response stream
		const serverStream = clientPeer.receiveStream<{
			serverMessage: string;
			timestamp: number;
		}>(bidirectionalResponse.data.streamId)[1];
		if (serverStream) {
			const reader = serverStream.getReader();

			console.log("  [Client] Receiving server response stream...\n");

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					console.log(`  [Client] ← ${value.serverMessage}`);
				}
			} finally {
				reader.releaseLock();
			}
		}
	}

	// Scenario 4: Stream abort
	console.log("\n\n--- Scenario 4: Stream Abort ---");
	console.log("Starting stream and aborting early...\n");

	const abortResponse = await clientPeer.call({
		type: "fast-stream",
		count: 100, // Long stream
	});

	if (abortResponse.data.type === "stream") {
		const stream = clientPeer.receiveStream<ArrayBuffer>(
			abortResponse.data.streamId,
		);
		if (stream) {
			const reader = stream[1].getReader();
			let itemCount = 0;

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					itemCount++;
					const data = JSON.parse(new TextDecoder().decode(value));
					console.log(`  [Client] Item ${itemCount}: index=${data.index}`);

					// Abort after 3 items
					if (itemCount >= 3) {
						console.log("  [Client] Aborting stream early...");
						await reader.cancel("Client decided to stop");
						break;
					}
				}
			} finally {
				reader.releaseLock();
			}

			console.log(
				`  [Client] Aborted after ${itemCount} items (100 requested)`,
			);
		}
	}

	// Cleanup
	console.log("\n--- Cleanup ---");
	await clientPeer.dispose();
	await serverPeer.dispose();
	await server.stop(true);

	console.log("\n=== Example Complete ===");
	console.log("\nKey Observations:");
	console.log("- Multiple streams can run concurrently over one WebSocket");
	console.log("- Backpressure activates when buffer exceeds 1MB");
	console.log("- Slow consumers cause sender delays (visible in logs)");
	console.log("- Bidirectional streaming: both peers can send simultaneously");
	console.log("- Streams can be aborted early with reader.cancel()");
	console.log("- Automatic cleanup when connection closes");
}

if (import.meta.main) {
	await streamBackpressureExample();
}
