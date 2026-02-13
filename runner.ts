import { RpcPeer } from "./shared/RpcPeer";
import {
	RequestApiSchemaExample,
	ResponseApiSchemaExample,
} from "./shared/SchemaExample";

const url = "ws://127.0.0.1:8080" as const;
const rpc = RpcPeer.FromOptions({
	url,
	requestSchema: RequestApiSchemaExample,
	responseSchema: ResponseApiSchemaExample,
});

let score = 0;
rpc.match((data) => {
	console.log("Recieved", data);

	if (data.type === "score") {
		return {
			type: "score",
			score: score++,
		};
	} else if (data.type === "greet") {
		return {
			type: "greet",
			greeting: `Hello ${data.name}!`,
		};
	} else if (data.type === "game") {
		return {
			type: "game",
			name: "ne-rage",
		};
	}
	return {
		type: "unknown",
	};
});
