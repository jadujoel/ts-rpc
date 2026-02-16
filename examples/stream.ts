/**
 * Example demonstrating streaming capabilities with RpcPeer
 *
 * This example shows:
 * 1. Sending an AsyncIterable stream from server to client
 * 2. Handling backpressure automatically (pauses when buffer is full)
 * 3. Multiplexing multiple streams over one WebSocket connection
 * 4. Proper cleanup on connection close or early abort
 * 5. Type-safe request/response handling with discriminated unions
 * 6. Reading streams using ReadableStream API
 *
 * STREAMING LIFECYCLE:
 * - Client requests a stream via RPC
 * - Server responds with streamId
 * - Server sends StreamData messages with payload chunks
 * - Client receives data via ReadableStream
 * - Stream ends with StreamEnd or StreamError message
 * - Either party can abort at any time
 *
 * BACKPRESSURE HANDLING:
 * - StreamManager monitors WebSocket bufferedAmount
 * - When buffer exceeds threshold (default: 1MB), sending pauses
 * - Prevents memory overflow when network is slower than data generation
 * - Automatically resumes when buffer drains
 *
 * ERROR HANDLING:
 * - Errors in generator propagate as StreamError messages
 * - Connection loss aborts all active streams
 * - Clients can abort streams early with closeReceivingStream()
 */

import type { ServerWebSocket } from "bun";
import { z } from "zod";
import { RpcPeer } from "../shared/RpcPeer.ts";
import type { WebSocketData } from "./serve.ts";

// Define schemas using discriminated unions for type safety
const RequestSchema = z.discriminatedUnion("method", [
	z.object({
		method: z.literal("requestNumberStream"),
	}),
	z.object({
		method: z.literal("requestDataFeed"),
	}),
	z.object({
		method: z.literal("requestLogStream"),
	}),
]);

const ResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("number-stream"),
		streamId: z.string(),
	}),
	z.object({
		type: z.literal("data-feed"),
		streamId: z.string(),
	}),
	z.object({
		type: z.literal("log-stream"),
		streamId: z.string(),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

export type StreamRequest = z.infer<typeof RequestSchema>;
export type StreamResponse = z.infer<typeof ResponseSchema>;

// STREAM GENERATORS
// These async generators demonstrate different types of data streams
// AsyncIterables are the key to streaming - they produce values over time

// Example 1: Streaming numbers (demonstrates simple incremental data)
// Use case: Progress updates, counters, pagination
async function* numberStream(start: number, end: number, delay = 100) {
	for (let i = start; i <= end; i++) {
		await new Promise((resolve) => setTimeout(resolve, delay));
		yield i; // Each yield sends one chunk to the stream
	}
}

// Example 2: Streaming structured data (demonstrates complex objects)
// Use case: Database query results, API responses, real-time updates
async function* dataFeed() {
	const data = [
		{ id: 1, message: "First update" },
		{ id: 2, message: "Second update" },
		{ id: 3, message: "Third update" },
		{ id: 4, message: "Fourth update" },
		{ id: 5, message: "Fifth update" },
	];

	for (const item of data) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		yield item;
	}
}

// Example 3: Streaming log entries (demonstrates continuous monitoring)
// Use case: Server logs, application telemetry, real-time monitoring
async function* logStream() {
	const logLevels = ["info", "warn", "error", "debug"];
	for (let i = 0; i < 20; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		yield {
			timestamp: new Date().toISOString(),
			level: logLevels[Math.floor(Math.random() * logLevels.length)],
			message: `Log entry ${i + 1}`,
		};
	}
}

// Helper functions to send streams over WebSocket
async function sendNumberStream(
	ws: ServerWebSocket<unknown>,
	streamId: string,
	start: number,
	end: number,
	delay: number,
): Promise<void> {
	try {
		for await (const num of numberStream(start, end, delay)) {
			ws.send(
				JSON.stringify({
					type: "StreamData",
					streamId,
					payload: num,
				}),
			);
		}
		ws.send(
			JSON.stringify({
				type: "StreamEnd",
				streamId,
			}),
		);
	} catch (err) {
		ws.send(
			JSON.stringify({
				type: "StreamError",
				streamId,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}

async function sendDataFeed(
	ws: ServerWebSocket<unknown>,
	streamId: string,
): Promise<void> {
	try {
		for await (const data of dataFeed()) {
			ws.send(
				JSON.stringify({
					type: "StreamData",
					streamId,
					payload: data,
				}),
			);
		}
		ws.send(
			JSON.stringify({
				type: "StreamEnd",
				streamId,
			}),
		);
	} catch (err) {
		ws.send(
			JSON.stringify({
				type: "StreamError",
				streamId,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}

async function sendLogStream(
	ws: ServerWebSocket<unknown>,
	streamId: string,
): Promise<void> {
	try {
		for await (const log of logStream()) {
			ws.send(
				JSON.stringify({
					type: "StreamData",
					streamId,
					payload: log,
				}),
			);
		}
		ws.send(
			JSON.stringify({
				type: "StreamEnd",
				streamId,
			}),
		);
	} catch (err) {
		ws.send(
			JSON.stringify({
				type: "StreamError",
				streamId,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}

/**
 * Server-side: Handle stream requests and send streams
 */
async function runServer() {
	const server = Bun.serve<WebSocketData>({
		port: 3000,
		fetch(req, server) {
			const url = new URL(req.url);

			if (url.pathname === "/ws") {
				const success = server.upgrade(req);
				if (success) {
					return;
				}
			}

			return new Response("Expected WebSocket", { status: 400 });
		},
		websocket: {
			open(ws) {
				console.log("[Server] Client connected");

				// Send welcome message
				const clientId = crypto.randomUUID();
				ws.send(
					JSON.stringify({
						category: "welcome",
						clientId,
					}),
				);
			},
			message(ws, message) {
				try {
					const data = JSON.parse(message as string);

					// Check if this is a stream request
					if (data.category === "request" && data.data) {
						const parsed = RequestSchema.safeParse(data.data);
						if (!parsed.success) {
							console.error("[Server] Invalid request:", parsed.error);
							ws.send(
								JSON.stringify({
									category: "response",
									requestId: data.requestId,
									data: {
										type: "error",
										message: "Invalid request format",
									} satisfies StreamResponse,
								}),
							);
							return;
						}

						const request = parsed.data;

						switch (request.method) {
							case "requestNumberStream": {
								console.log("[Server] Starting number stream...");
								const streamId = crypto.randomUUID();
								const response: StreamResponse = {
									type: "number-stream",
									streamId,
								};
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: response,
									}),
								);
								sendNumberStream(ws, streamId, 1, 10, 100);
								break;
							}
							case "requestDataFeed": {
								console.log("[Server] Starting data feed stream...");
								const streamId = crypto.randomUUID();
								const response: StreamResponse = {
									type: "data-feed",
									streamId,
								};
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: response,
									}),
								);
								sendDataFeed(ws, streamId);
								break;
							}
							case "requestLogStream": {
								console.log("[Server] Starting log stream...");
								const streamId = crypto.randomUUID();
								const response: StreamResponse = {
									type: "log-stream",
									streamId,
								};
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: response,
									}),
								);
								sendLogStream(ws, streamId);
								break;
							}
						}
					}
				} catch (err) {
					console.error("[Server] Error handling message:", err);
				}
			},
			close(_ws) {
				console.log("[Server] Client disconnected");
			},
		},
	});

	console.log(`[Server] Listening on ws://localhost:${server.port}/ws`);
	return server;
}

/**
 * Client-side: Request streams and consume them
 */
async function runClient() {
	const peer = RpcPeer.FromOptions({
		url: "ws://localhost:3000/ws",
		requestSchema: RequestSchema,
		responseSchema: ResponseSchema,
		name: "Client",
	});

	// Wait for connection
	await peer.waitForWelcome();
	console.log("[Client] Connected to server");

	// Example 1: Request and consume number stream
	console.log("\n=== Example 1: Number Stream ===");
	const numberResponse = await peer.request<StreamResponse, StreamRequest>({
		method: "requestNumberStream",
	});

	// Type-safe discriminated union handling
	const numberData = numberResponse.data;
	if (numberData.type === "error") {
		throw new Error(`Server error: ${numberData.message}`);
	}
	if (numberData.type !== "number-stream") {
		throw new Error(`Unexpected stream type: ${numberData.type}`);
	}

	// TypeScript now knows numberData has streamId property
	const [numberStreamId, numberStream] = peer.receiveStream<number>(
		numberData.streamId,
	);
	console.log(`[Client] Receiving number stream: ${numberStreamId}`);

	// Convert ReadableStream to async iteration
	const numberReader = numberStream.getReader();
	try {
		let result = await numberReader.read();
		while (!result.done) {
			console.log(`[Client] Received number: ${result.value}`);
			result = await numberReader.read();
		}
		console.log("[Client] Number stream completed");
	} finally {
		numberReader.releaseLock();
	}

	// Example 2: Request and consume data feed
	console.log("\n=== Example 2: Data Feed Stream ===");
	const dataResponse = await peer.request<StreamResponse, StreamRequest>({
		method: "requestDataFeed",
	});

	const dataResponseData = dataResponse.data;
	if (dataResponseData.type === "error") {
		throw new Error(`Server error: ${dataResponseData.message}`);
	}
	if (dataResponseData.type !== "data-feed") {
		throw new Error(`Unexpected stream type: ${dataResponseData.type}`);
	}

	const [dataStreamId, dataStream] = peer.receiveStream<{
		id: number;
		message: string;
	}>(dataResponseData.streamId);
	console.log(`[Client] Receiving data feed: ${dataStreamId}`);

	// Convert ReadableStream to async iteration
	const dataReader = dataStream.getReader();
	try {
		let result = await dataReader.read();
		while (!result.done) {
			console.log(`[Client] Received data:`, result.value);
			result = await dataReader.read();
		}
		console.log("[Client] Data feed completed");
	} finally {
		dataReader.releaseLock();
	}

	// Example 3: Request and consume log stream
	console.log("\n=== Example 3: Log Stream ===");
	const logResponse = await peer.request<StreamResponse, StreamRequest>({
		method: "requestLogStream",
	});

	const logResponseData = logResponse.data;
	if (logResponseData.type === "error") {
		throw new Error(`Server error: ${logResponseData.message}`);
	}
	if (logResponseData.type !== "log-stream") {
		throw new Error(`Unexpected stream type: ${logResponseData.type}`);
	}

	const [logStreamId, logStream] = peer.receiveStream<{
		timestamp: string;
		level: string;
		message: string;
	}>(logResponseData.streamId);
	console.log(`[Client] Receiving log stream: ${logStreamId}`);

	// Convert ReadableStream to async iteration
	const logReader = logStream.getReader();
	try {
		let count = 0;
		let result = await logReader.read();
		while (!result.done) {
			const log = result.value;
			console.log(`[Client] ${log.level.toUpperCase()}: ${log.message}`);
			count++;

			// EARLY ABORT DEMONSTRATION
			// Streams can be closed before completion
			// Useful for: canceling slow operations, limiting results, handling user cancellation
			// closeReceivingStream() cleanly shuts down the stream on the client side
			if (count === 10) {
				console.log(
					"[Client] Aborting stream early (simulating user cancellation)...",
				);
				peer.closeReceivingStream(logStreamId);
				break;
			}
			result = await logReader.read();
		}
		console.log("[Client] Log stream completed or aborted");
	} finally {
		logReader.releaseLock();
	}

	// Clean up
	console.log("\n[Client] Closing connection...");
	await peer.dispose();
	console.log("[Client] Disconnected");
}

/**
 * Run the example
 */
async function main() {
	console.log("=== RPC Streaming Example ===\n");

	// Start server
	const server = await runServer();

	// Give server time to start
	await new Promise((resolve) => setTimeout(resolve, 100));

	// Run client
	try {
		await runClient();
	} catch (err) {
		console.error("[Client] Error:", err);
	}

	// Shutdown server
	console.log("\n[Server] Shutting down...");
	await server.stop(true);
	console.log("[Server] Shutdown complete");
}

// Run if executed directly
if (import.meta.main) {
	main().catch(console.error);
}

export { runServer, runClient, numberStream, dataFeed, logStream };
