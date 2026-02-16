import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { RpcWelcome } from "../../../lib";
import App from "../client/index.html";

interface WebSocketData {
	readonly url: string;
	readonly topic: string;
	readonly id: string;
	username?: string;
}

const clients = new Map<string, ServerWebSocket<WebSocketData>>();
const usernames = new Map<string, string>(); // clientId -> username

interface StoredMessage {
	from: string;
	fromName: string;
	content: string;
	timestamp: number;
}
const messageHistory: StoredMessage[] = [];
const MAX_HISTORY = 100;

/**
 * Simple chat relay server
 * Handles message routing and user management
 */
export function createChatServer(port = 8080): Server<WebSocketData> {
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
		websocket: <WebSocketHandler<WebSocketData>>{
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
								if (messageHistory.length > 0) {
									ws.send(
										JSON.stringify({
											category: "request",
											requestId: crypto.randomUUID(),
											from: "server",
											fromName: "Server",
											data: {
												type: "message-history",
												messages: messageHistory,
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
								messageHistory.push(msg);
								if (messageHistory.length > MAX_HISTORY) {
									messageHistory.shift();
								}
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
