import { Database } from "bun:sqlite";
import type { RpcWelcome } from "../../../../lib.ts";
import App from "../client/index.html";

interface WebSocketData {
	readonly url: string;
	readonly topic: string;
	readonly id: string;
	username?: string;
}

const clients = new Map<string, Bun.ServerWebSocket<WebSocketData>>();
const usernames = new Map<string, string>(); // clientId -> username

interface StoredMessage {
	from: string;
	fromName: string;
	content: string;
	timestamp: number;
}

const MAX_HISTORY = 100;

const db = new Database("chat.sqlite");
db.run(`CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	"from" TEXT NOT NULL,
	fromName TEXT NOT NULL,
	content TEXT NOT NULL,
	timestamp INTEGER NOT NULL
)`);

const insertMsg = db.prepare<void, [string, string, string, number]>(
	`INSERT INTO messages ("from", fromName, content, timestamp) VALUES (?, ?, ?, ?)`,
);
const getHistory = db.prepare<StoredMessage, []>(
	`SELECT "from", fromName, content, timestamp FROM messages ORDER BY id DESC LIMIT ${MAX_HISTORY}`,
);
const trimOld = db.prepare<void, [number]>(
	`DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)`,
);

function getMessageHistory(): StoredMessage[] {
	return getHistory.all().reverse();
}

function pushMessage(msg: StoredMessage): void {
	insertMsg.run(msg.from, msg.fromName, msg.content, msg.timestamp);
	trimOld.run(MAX_HISTORY);
}

/**
 * Simple chat relay server
 * Handles message routing and user management
 */
export function createChatServer(port = 8080): Bun.Server {
	const server = Bun.serve({
		port,
		routes: {
			"/": App,
		},
		async fetch(request, server): Promise<Response> {
			if (request.headers.get("upgrade")) {
				const url = new URL(request.url);
				const topic = url.pathname.slice(1) || "chat";
				const clientId = crypto.randomUUID();

				const data: WebSocketData = {
					url: request.url,
					topic,
					id: clientId,
				};

				if (!server.upgrade(request, { data })) {
					return new Response("Upgrade failed", { status: 400 });
				}
				return new Response();
			}

			// Serve a simple status page
			return new Response(
				JSON.stringify({
					status: "running",
					clients: clients.size,
					port,
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		},
		websocket: <Bun.WebSocketHandler<WebSocketData>>{
			async open(ws): Promise<void> {
				const topic = ws.data.topic;
				ws.subscribe(topic);
				clients.set(ws.data.id, ws);

				// Send welcome message
				const welcomeMessage: RpcWelcome = {
					category: "welcome",
					clientId: ws.data.id,
				};
				ws.send(JSON.stringify(welcomeMessage));

				console.log(
					`[Chat Server] Client ${ws.data.id} connected to topic: ${topic}`,
				);
			},

			async message(ws, message): Promise<void> {
				try {
					const data = JSON.parse(message.toString());

					// Handle different message categories
					if (data.category === "request") {
						const requestData = data.data;

						switch (requestData.type) {
							case "join": {
								usernames.set(ws.data.id, requestData.username);

								// Send message history to the joining user
								const history = getMessageHistory();
								if (history.length > 0) {
									ws.send(
										JSON.stringify({
											category: "request",
											requestId: crypto.randomUUID(),
											from: "server",
											fromName: "Server",
											data: {
												type: "message-history",
												messages: history,
											},
										}),
									);
								}

								// Broadcast user joined
								server.publish(
									ws.data.topic,
									JSON.stringify({
										category: "request",
										requestId: crypto.randomUUID(),
										from: ws.data.id,
										fromName: requestData.username,
										data: {
											type: "user-joined",
											username: requestData.username,
											userId: ws.data.id,
											timestamp: Date.now(),
										},
									}),
								);
								break;
							}

							case "leave":
								usernames.delete(ws.data.id);
								server.publish(
									ws.data.topic,
									JSON.stringify({
										category: "request",
										requestId: crypto.randomUUID(),
										from: ws.data.id,
										fromName: requestData.username,
										data: {
											type: "user-left",
											username: requestData.username,
											userId: ws.data.id,
											timestamp: Date.now(),
										},
									}),
								);
								break;

							case "message": {
								const timestamp = Date.now();
								const msg: StoredMessage = {
									from: ws.data.id,
									fromName: requestData.username,
									content: requestData.content,
									timestamp,
								};
								pushMessage(msg);
								// Broadcast message to all clients on the topic
								server.publish(
									ws.data.topic,
									JSON.stringify({
										category: "request",
										requestId: crypto.randomUUID(),
										from: ws.data.id,
										fromName: requestData.username,
										data: {
											type: "message",
											...msg,
										},
									}),
								);
								break;
							}

							case "list-users": {
								// Send user list back to requester
								const users = Array.from(clients.entries())
									.filter(([_, client]) => client.data.topic === ws.data.topic)
									.map(([id, _]) => ({
										id,
										name: usernames.get(id) || "Anonymous",
									}));

								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										from: ws.data.id,
										data: {
											type: "user-list",
											users,
										},
									}),
								);
								break;
							}
						}
					} else if (data.category === "ping") {
						// Respond to ping with pong
						ws.send(
							JSON.stringify({
								category: "pong",
								timestamp: Date.now(),
							}),
						);
					}
				} catch (error) {
					console.error("[Chat Server] Error processing message:", error);
					ws.send(
						JSON.stringify({
							category: "error",
							error: "Failed to process message",
							details: error instanceof Error ? error.message : String(error),
						}),
					);
				}
			},

			async close(ws): Promise<void> {
				const username = usernames.get(ws.data.id);
				clients.delete(ws.data.id);
				usernames.delete(ws.data.id);

				if (username) {
					// Broadcast user left
					server.publish(
						ws.data.topic,
						JSON.stringify({
							category: "request",
							requestId: crypto.randomUUID(),
							from: ws.data.id,
							fromName: username,
							data: {
								type: "user-left",
								username,
								userId: ws.data.id,
								timestamp: Date.now(),
							},
						}),
					);
				}

				console.log(`[Chat Server] Client ${ws.data.id} disconnected`);
			},
		},
	});

	console.log(`[Chat Server] Running on http://localhost:${port}`);
	return server;
}

if (import.meta.main) {
	createChatServer(8080);
}
