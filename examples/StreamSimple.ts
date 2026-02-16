/**
 * Simplified streaming example demonstrating core StreamManager functionality.
 *
 * This example is simpler than stream.ts because it:
 * - Uses StreamManager directly instead of full RPC infrastructure
 * - Simulates WebSocket with a mock object (loopback pattern)
 * - Demonstrates the core streaming APIs without server/client separation
 * - Shows how to use the same stream ID for both sending and receiving
 *
 * WHEN TO USE THIS PATTERN:
 * - Testing streaming code without a real WebSocket connection
 * - Understanding StreamManager internals
 * - Building custom streaming solutions
 * - Debugging stream issues in isolation
 *
 * WHEN TO USE stream.ts PATTERN INSTEAD:
 * - Production code with real RPC communication
 * - Multi-peer streaming scenarios
 * - Need authentication, authorization, or other RPC features
 * - Bidirectional streams between separate processes
 *
 * KEY CONCEPTS DEMONSTRATED:
 * 1. Creating a receiving stream first to get the stream ID
 * 2. Using the same ID for sending (loopback pattern)
 * 3. Reading from ReadableStream using getReader()
 * 4. Automatic message handling with handleStreamMessage()
 * 5. Stream ID management and lifecycle tracking
 */

import { StreamManager } from "../shared/RpcStream.ts";

// ASYNC GENERATOR: The source of streaming data
// AsyncIterables are the foundation of streaming - they produce values over time
// This simple generator yields numbers with a delay between each
async function* numberStream(count: number) {
	for (let i = 1; i <= count; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		yield i; // yield pauses execution and emits a value
	}
}

async function runExample() {
	console.log("=== StreamManager Example ===\n");

	const manager = new StreamManager();

	// STEP 1: Create a receiving stream
	// This sets up a ReadableStream and registers it with the manager
	// The stream ID is used to route incoming messages to the correct stream
	console.log("1. Creating a receiving stream...");
	const [streamId, stream] = manager.createReceivingStream<number>();
	console.log(`   Stream ID: ${streamId}`);

	// STEP 2: Create a mock WebSocket for demonstration
	// In production, this would be a real WebSocket connection
	// The send() method immediately loops back messages to demonstrate the flow
	const mockWS = {
		send: (data: string) => {
			const parsed = JSON.parse(data);
			console.log(`[WS] Sent: ${parsed.type} - ${parsed.payload ?? "(end)"}`);

			// LOOPBACK: Immediately handle the message we just sent
			// This simulates receiving messages from the other end of the WebSocket
			// handleStreamMessage() routes the message to the correct receiving stream
			manager.handleStreamMessage(parsed);
		},
		bufferedAmount: 0, // Used for backpressure management
	};

	console.log("\n2. Sending a stream of numbers with the same stream ID...");
	// STEP 3: Send the stream
	// sendStream() takes an AsyncIterable and converts it to stream messages
	// Using the same streamId connects the sender to our receiver (loopback)
	const sendPromise = manager.sendStream(mockWS, numberStream(5), streamId);

	// STEP 4: Consume the receiving stream
	// ReadableStream provides a standard way to read streamed data
	console.log("\n3. Consuming the receiving stream...");
	const reader = stream.getReader(); // Get a reader to pull values
	const values: number[] = [];

	let result = await reader.read();
	while (!result.done) {
		values.push(result.value);
		console.log(`   Received: ${result.value}`);
		result = await reader.read(); // Each read() waits for the next value
	}

	// STEP 5: Wait for sender to finish
	// The sendPromise resolves when all data has been sent and StreamEnd is emitted
	await sendPromise;
	console.log(`\n4. Send completed`);

	console.log(`\n5. Received all values: [${values.join(", ")}]`);

	// STREAM TRACKING: StreamManager keeps count of active streams
	// These should both be 0 after completion (streams auto-cleanup)
	console.log(`\nActive streams: ${manager.activeStreamCount}`);
	console.log(`Receiving streams: ${manager.receivingStreamCount}`);

	console.log("\n=== Example Complete ===");
}

if (import.meta.main) {
	runExample().catch(console.error);
}

export { runExample };
