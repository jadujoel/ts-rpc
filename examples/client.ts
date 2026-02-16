import { RpcPeer } from "../shared/RpcPeer.ts";
import {
	RequestApiSchemaExample,
	ResponseApiSchemaExample,
} from "./SchemaExample.ts";

const rpc = RpcPeer.FromOptions({
	url: "ws://127.0.0.1:8080",
	requestSchema: RequestApiSchemaExample,
	responseSchema: ResponseApiSchemaExample,
});

const score = await rpc.call({
	type: "score",
});

console.log("Score:", score.data);

const game = await rpc.call({
	type: "game",
});

console.log("game", game);

// const greeting = await rpc.call({
//   type: "greet",
//   name: "Testy McTestFace"
// })

// console.log("Greeting:", greeting.data)
