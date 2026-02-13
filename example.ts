import { serve } from "./serve.ts";
import { RpcPeer } from "./shared/RpcPeer.ts";
import {
	RequestApiSchemaExample,
	ResponseApiSchemaExample,
} from "./shared/SchemaExample";

export async function example() {
	const server = serve({
		hostname: "127.0.0.1",
		port: 8080,
	});

	const peer1 = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8080/game-client-1",
		requestSchema: RequestApiSchemaExample,
		responseSchema: ResponseApiSchemaExample,
	});

	const peer2 = RpcPeer.FromOptions({
		url: "ws://127.0.0.1:8080/sound-client-1",
		requestSchema: RequestApiSchemaExample,
		responseSchema: ResponseApiSchemaExample,
	});

	peer2.match((data) => {
		console.log("Peer2 received", data);
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
			default:
				return {
					type: "unknown",
				};
		}
	});

	await peer1.waitForWelcome();
	await peer2.waitForWelcome();
	console.log(
		"Received welcome message with clientId:",
		peer1.clientId,
		peer2.clientId,
	);

	console.log("Sending Score request...");
	const score = await peer1.call({
		type: "score",
	});

	console.log("Score:", score.data);

	const game = await peer1.call({
		type: "game",
	});

	console.log("game", game);

	const greeting = await peer1.call({
		type: "greet",
		name: "Testy McTestFace",
	});

	console.log("Greeting:", greeting.data);

	server.stop();
}

if (import.meta.main) {
	await example();
}
