import { serve } from "../serve.ts";
import { RpcPeer } from "../shared/RpcPeer.ts";
import {
	RequestApiSchemaExample,
	ResponseApiSchemaExample,
} from "../shared/SchemaExample.ts";

export async function example() {
	console.debug = () => {}; // Disable debug logs for cleaner output
	const server = serve({
		hostname: "127.0.0.1",
		port: 8080,
	});

	const peer1 = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8080/game",
		name: "GameClient",
		requestSchema: RequestApiSchemaExample,
		responseSchema: ResponseApiSchemaExample,
	});

	const peer2 = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8080/game",
		name: "GameService",
		requestSchema: RequestApiSchemaExample,
		responseSchema: ResponseApiSchemaExample,
	});

	peer2.match((data) => {
		switch (data.type) {
			case "score":
				return {
					type: "score",
					score: 9001,
				};
			case "greet":
				return {
					type: "greet",
					greeting: `Hello ${data.name}, from peer2!`,
				};
			case "game":
				return {
					type: "game",
					name: "McDoodles Adventures",
				};
			default:
				return {
					type: "unknown",
				};
		}
	});

	await peer1.waitForWelcome();
	await peer2.waitForWelcome();
	console.log("Welcome Recieved");
	console.log("Score Request...");
	const score = await peer1.call(
		{
			type: "score",
		},
		peer2.clientId,
	);

	if (score.data.type === "score") {
		console.log("Score Result:", score.data.score);
	} else {
		throw new Error("Unexpected response type");
	}

	const game = await peer1.call({
		type: "game",
	});

	if (game.data.type === "game") {
		console.log("Game Result", game.data.type);
	} else {
		throw new Error("Unexpected response type");
	}

	const greeting = await peer1.call({
		type: "greet",
		name: "Testy McTestFace",
	});

	console.log("Greeting:", greeting.data);

	await Promise.all([peer1.dispose(), peer2.dispose()]);
	console.log("Stopping server...");

	// using true to force close works.
	// await server.stop(true);
	// This hangs for some reason, likely due to the way the RetrySocket is implemented and how it handles close. Needs investigation.
	await server.stop(true);
	console.log("Server stopped.");
}

if (import.meta.main) {
	await example();
}
