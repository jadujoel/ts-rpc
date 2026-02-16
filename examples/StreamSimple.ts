/**
 * Simpler streaming example that demonstrates the core functionality
 */

import { StreamManager } from "../shared/RpcStream.ts";

// Example: Simple number stream
async function* numberStream(count: number) {
	for (let i = 1; i <= count; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		yield i;
	}
}

async function runExample() {
	console.log("=== StreamManager Example ===\n");

	const manager = new StreamManager();

	// Create a receiving stream first (so we have the stream ID)
	console.log("1. Creating a receiving stream...");
	const [streamId, stream] = manager.createReceivingStream<number>();
	console.log(`   Stream ID: ${streamId}`);

	// Create a mock WebSocket
	const mockWS = {
		send: (data: string) => {
			const parsed = JSON.parse(data);
			console.log(`[WS] Sent: ${parsed.type} - ${parsed.payload ?? "(end)"}`);

			// Immediately handle the message (simulating loopback)
			manager.handleStreamMessage(parsed);
		},
		bufferedAmount: 0,
	};

	console.log("\n2. Sending a stream of numbers with the same stream ID...");
	// Send stream using the same ID we created for receiving
	const sendPromise = manager.sendStream(mockWS, numberStream(5), streamId);

	// Consume the receiving stream
	console.log("\n3. Consuming the receiving stream...");
	const reader = stream.getReader();
	const values: number[] = [];

	let result = await reader.read();
	while (!result.done) {
		values.push(result.value);
		console.log(`   Received: ${result.value}`);
		result = await reader.read();
	}

	// Wait for send to complete
	await sendPromise;
	console.log(`\n4. Send completed`);

	console.log(`\n5. Received all values: [${values.join(", ")}]`);
	console.log(`\nActive streams: ${manager.activeStreamCount}`);
	console.log(`Receiving streams: ${manager.receivingStreamCount}`);

	console.log("\n=== Example Complete ===");
}

if (import.meta.main) {
	runExample().catch(console.error);
}

export { runExample };
