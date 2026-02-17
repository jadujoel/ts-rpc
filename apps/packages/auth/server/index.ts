import {
	type AuthContext,
	SimpleAuthValidator,
	StrictAuthorizationRules,
} from "../../../../shared/Authorization.ts";

import App from "../client/index.html";

interface WebSocketData {
	readonly url: string;
	readonly topic: string;
	readonly id: string;
	readonly auth: AuthContext | null;
}

const clients = new Map<string, Bun.ServerWebSocket<WebSocketData>>();

// Define valid tokens for demo
const authValidator = SimpleAuthValidator.FromTokens({
	"admin-token": "admin-user",
	"user-token": "regular-user",
	"demo-token": "demo-user",
});

// Define authorization rules
const authRules = StrictAuthorizationRules.FromOptions({
	adminUsers: ["admin-user"],
	topicPermissions: {
		"auth-demo": ["admin-user", "regular-user", "demo-user"],
	},
});

/**
 * Auth demo server with authentication and authorization
 */
export function createAuthServer(port = 8081): Bun.Server {
	const server = Bun.serve({
		port,
		routes: {
			"/": App,
		},
		async fetch(request, server): Promise<Response> {
			if (request.headers.get("upgrade")) {
				// Extract token from Authorization header or query parameter
				const token =
					request.headers.get("authorization")?.replace("Bearer ", "") ||
					new URL(request.url).searchParams.get("token");

				const auth = await authValidator.validate(token);

				if (!auth) {
					return new Response("Unauthorized", { status: 401 });
				}

				const url = new URL(request.url);
				const topic = url.pathname.slice(1) || "auth-demo";

				// Check if user can subscribe to topic
				if (!authRules.canSubscribeToTopic(auth.userId, topic)) {
					return new Response("Forbidden: Cannot subscribe to this topic", {
						status: 403,
					});
				}

				const clientId = crypto.randomUUID();
				const data: WebSocketData = {
					url: request.url,
					topic,
					id: clientId,
					auth,
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

				// Send welcome message with auth info
				const welcomeMessage = JSON.stringify({
					category: "welcome",
					clientId: ws.data.id,
				});
				ws.send(welcomeMessage);

				console.log(
					`[Auth Server] Client ${ws.data.id} (${ws.data.auth?.userId}) connected`,
				);
			},

			async message(ws, message): Promise<void> {
				try {
					const data = JSON.parse(message.toString());

					if (data.category === "request") {
						const requestData = data.data;
						const userId = ws.data.auth?.userId;
						const isAdmin = userId === "admin-user";

						switch (requestData.type) {
							case "ping":
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "pong",
											timestamp: Date.now(),
										},
									}),
								);
								break;

							case "get-profile":
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "profile",
											userId: userId || "anonymous",
											role: isAdmin ? "admin" : "user",
											rateLimit: authRules.getRateLimit(userId),
											permissions: Array.from(ws.data.auth?.permissions || []),
										},
									}),
								);
								break;

							case "protected-action":
								if (!userId) {
									ws.send(
										JSON.stringify({
											category: "response",
											requestId: data.requestId,
											data: {
												type: "error",
												message: "Authentication required",
												code: "AUTH_REQUIRED",
											},
										}),
									);
								} else {
									ws.send(
										JSON.stringify({
											category: "response",
											requestId: data.requestId,
											data: {
												type: "action-result",
												success: true,
												message: `Protected action "${requestData.action}" executed by ${userId}`,
											},
										}),
									);
								}
								break;

							case "admin-action":
								if (!isAdmin) {
									ws.send(
										JSON.stringify({
											category: "response",
											requestId: data.requestId,
											data: {
												type: "error",
												message: "Admin privileges required",
												code: "FORBIDDEN",
											},
										}),
									);
								} else {
									ws.send(
										JSON.stringify({
											category: "response",
											requestId: data.requestId,
											data: {
												type: "action-result",
												success: true,
												message: `Admin action "${requestData.action}" executed by ${userId}`,
											},
										}),
									);
								}
								break;

							default:
								ws.send(
									JSON.stringify({
										category: "response",
										requestId: data.requestId,
										data: {
											type: "error",
											message: "Unknown request type",
											code: "UNKNOWN_REQUEST",
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
					console.error("[Auth Server] Error processing message:", error);
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
					`[Auth Server] Client ${ws.data.id} (${ws.data.auth?.userId}) disconnected`,
				);
			},
		},
	});

	console.log(`[Auth Server] Running on http://localhost:${port}`);
	console.log(
		`[Auth Server] Valid tokens: admin-token, user-token, demo-token`,
	);
	return server;
}

if (import.meta.main) {
	createAuthServer(8081);
}
