import App from "../client/index.html";

interface WebSocketData {
	readonly url: string;
	readonly topic: string;
	readonly id: string;
	readonly name: string;
	readonly connectedAt: number;
}

const clients = new Map<string, Bun.ServerWebSocket<WebSocketData>>();

/**
 * P2P relay server
 * Handles both direct peer-to-peer and broadcast messaging
 */
export function createP2PServer(port = 8082): Bun.Server {
	const server = Bun.serve({
		port,
		routes: {
			"/": App,
		},
		async fetch(request, server): Promise<Response> {
			if (request.headers.get("upgrade")) {
				const url = new URL(request.url);
				const topic = url.pathname.slice(1) || "p2p";
				const name = url.searchParams.get("name") || "Anonymous";
				const clientId = crypto.randomUUID();

				const data: WebSocketData = {
					url: request.url,
					topic,
					id: clientId,
					name,
					connectedAt: Date.now(),
				};

				if (!server.upgrade(request, { data })) {
					return new Response("Upgrade failed", { status: 400 });
				}
				return new Response();
			}

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
				const welcomeMessage = JSON.stringify({
					category: "welcome",
					clientId: ws.data.id,
				});
				ws.send(welcomeMessage);

				console.log(
					`[P2P Server] Client ${ws.data.id} (${ws.data.name}) connected to topic: ${topic}`,
				);
			},

			async message(ws, message): Promise<void> {
				try {
					const data = JSON.parse(message.toString());

					if (data.category === "request") {
						const requestData = data.data;

						switch (requestData.type) {
							case "direct-message":
								// Send to specific peer using 'to' field
								if (data.to) {
									const targetClient = clients.get(data.to);
									if (targetClient) {
										targetClient.send(
											JSON.stringify({
												category: "request",
												requestId: crypto.randomUUID(),
												from: ws.data.id,
												fromName: ws.data.name,
												to: data.to,
												data: {
													type: "direct-message",
													from: ws.data.id,
													fromName: ws.data.name,
													content: requestData.content,
													timestamp: Date.now(),
												},
											}),
										);

										// Send confirmation to sender
										ws.send(
											JSON.stringify({
												category: "response",
												requestId: data.requestId,
												data: {
													type: "direct-message",
													from: "system",
													fromName: "System",
													content: `Message delivered to ${targetClient.data.name}`,
													timestamp: Date.now(),
												},
											}),
										);
									} else {
										ws.send(
											JSON.stringify({
												category: "response",
												requestId: data.requestId,
												data: {
													type: "error",
													message: `Peer ${data.to} not found`,
												},
											}),
										);
									}
								} else {
									ws.send(
										JSON.stringify({
											category: "response",
											requestId: data.requestId,
											data: {
												type: "error",
												message: "Target peer ID required for direct messages",
											},
										}),
									);
								}
								break;

							case "broadcast-message":
								// Broadcast to all clients on the topic
								server.publish(
									ws.data.topic,
									JSON.stringify({
										category: "request",
										requestId: crypto.randomUUID(),
										from: ws.data.id,
										fromName: ws.data.name,
										data: {
											type: "broadcast-message",
											from: ws.data.id,
											fromName: ws.data.name,
											content: requestData.content,
											timestamp: Date.now(),
										},
									}),
								);
								break;

							case "list-peers": {
								// Send list of all connected peers on this topic
								const peers = Array.from(clients.entries())
									.filter(([_, client]) => client.data.topic === ws.data.topic)
									.map(([id, client]) => ({
										id,
										name: client.data.name,
										connectedAt: client.data.connectedAt,
									}));

								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "peer-list",
											peers,
										},
									}),
								);
								break;
							}

							case "peer-info": {
								// Get info about a specific peer
								const peer = clients.get(requestData.peerId);
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "peer-info",
											peerId: requestData.peerId,
											peerName: peer?.data.name || "Unknown",
											online: peer !== undefined,
										},
									}),
								);
								break;
							}

							default:
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "error",
											message: "Unknown request type",
										},
									}),
								);
						}
					} else if (data.category === "ping") {
						ws.send(
							JSON.stringify({
								category: "pong",
								timestamp: Date.now(),
							}),
						);
					}
				} catch (error) {
					console.error("[P2P Server] Error processing message:", error);
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
				clients.delete(ws.data.id);
				console.log(
					`[P2P Server] Client ${ws.data.id} (${ws.data.name}) disconnected`,
				);
			},
		},
	});

	console.log(`[P2P Server] Running on http://localhost:${port}`);
	return server;
}

if (import.meta.main) {
	createP2PServer(8082);
}
