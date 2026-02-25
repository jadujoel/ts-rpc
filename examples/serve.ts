import * as util from "node:util";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import * as api from "../api/index.ts";
import {
	type AuthContext,
	type AuthorizationRules,
	type AuthValidator,
	DefaultAuthorizationRules,
	NoAuthValidator,
	RateLimiter,
} from "../shared/Authorization.ts";

/**
 * Configuration options for the RPC WebSocket server.
 */
export interface ServeOptions {
	/** Hostname to bind the server to. Default: "localhost" */
	readonly hostname?: string;
	/** Port to listen on. Default: 3000 */
	readonly port?: number;
	/** Enable development mode with additional logging. Default: false */
	readonly development?: boolean;
	/** Enable hot module reloading (Bun-specific). Default: false */
	readonly hot?: boolean;
	/** Custom logger instance. Default: console */
	readonly logger?: typeof console;
	/** Authentication validator for verifying user credentials. Default: NoAuthValidator (allows all) */
	readonly authValidator?: AuthValidator;
	/** Authorization rules for controlling access to topics and peers. Default: DefaultAuthorizationRules (permissive) */
	readonly authRules?: AuthorizationRules;
	/** Enable rate limiting per user. Default: true */
	readonly enableRateLimit?: boolean;
	/** Maximum message size in bytes. Messages exceeding this will be rejected. Default: 1048576 (1MB) */
	readonly maxMessageSize?: number;
	/** Enable session persistence to restore client IDs on reconnection. Default: true */
	readonly enableSessionPersistence?: boolean;
}

const BANNED_STRINGS = [".."] as const;
/**
 * Internal metadata attached to each WebSocket connection.
 * Contains connection details, authentication context, and session information.
 * @internal
 */
export interface WebSocketData {
	readonly url: string;
	readonly host: string;
	readonly origin: string;
	readonly secWebsocketVersion: string;
	readonly secWebsocketKey: string;
	readonly secWebsocketExtensions: string;
	readonly secWebsocketProtocol: string;
	readonly userAgent: string;
	readonly acceptEncoding: string;
	readonly topic: string;
	readonly date: Date;
	readonly id: string;
	readonly auth: AuthContext | null;
	readonly previousSessionId?: string;
}

// Global map to track clients across the server instance
const clients = new Map<string, ServerWebSocket<WebSocketData>>();

// Map to track sessions for reconnection (sessionId -> clientId)
const sessions = new Map<string, string>();

// Rate limiter instances per user (userId -> RateLimiter)
const rateLimiters = new Map<string, RateLimiter>();

let Logger = console;
const debug = (...args: unknown[]) => Logger.debug("[Server]", ...args);
const log = (...args: unknown[]) => Logger.log("[Server]", ...args);
const error = (...args: unknown[]) => Logger.error("[Server]", ...args);
const warn = (...args: unknown[]) => Logger.warn("[Server]", ...args);
const timeEnd = (label: string) => Logger.timeEnd(`[Server] ${label}`);

/**
 * Creates and starts an RPC WebSocket server with relay capabilities.
 *
 * The server supports:
 * - Client-to-client messaging via relay routing
 * - Topic-based pub/sub messaging
 * - Session persistence for reconnection
 * - Authentication and authorization
 * - Rate limiting per user
 * - Message size limits
 * - Automatic heartbeat monitoring
 *
 * Messages can be routed in two ways:
 * 1. Direct peer-to-peer: Include a `to` field with the recipient's client ID
 * 2. Topic broadcast: Omit the `to` field to broadcast to all subscribers on the topic
 *
 * @param options - Server configuration options
 * @returns The running Bun server instance
 *
 * @example
 * ```typescript
 * // Simple server with default settings
 * const server = serve({ port: 8080 });
 *
 * // Production server with authentication
 * import { SimpleAuthValidator, StrictAuthorizationRules } from './shared/Authorization';
 *
 * const server = serve({
 *   hostname: '0.0.0.0',
 *   port: 443,
 *   authValidator: SimpleAuthValidator.FromOptions({
 *     validTokens: ['secret-token-123']
 *   }),
 *   authRules: new StrictAuthorizationRules({
 *     allowedTopics: ['public', 'chat'],
 *     adminUsers: ['admin-user-id']
 *   }),
 *   enableRateLimit: true,
 *   maxMessageSize: 512 * 1024, // 512KB
 *   enableSessionPersistence: true
 * });
 * ```
 */
export function serve({
	hostname = "localhost",
	port = 3000,
	development = false,
	hot = false,
	logger = console,
	authValidator = NoAuthValidator.Default(),
	authRules = new DefaultAuthorizationRules(),
	enableRateLimit = true,
	maxMessageSize = 1024 * 1024, // 1MB default
	enableSessionPersistence = true,
}: ServeOptions = {}): Server {
	Logger = logger;

	debug("Server Options", {
		hostname,
		port,
		development,
		hot,
		authValidator: authValidator.constructor.name,
		authRules: authRules.constructor.name,
		enableRateLimit,
		maxMessageSize,
		enableSessionPersistence,
	});

	const server = Bun.serve({
		hostname,
		port,
		development,
		async fetch(request, server): Promise<Response> {
			if (BANNED_STRINGS.some((banned) => request.url.includes(banned))) {
				return new Response("404");
			}

			timeEnd(`Request ${request.url}`);
			if (request.headers.get("upgrade")) {
				// AUTHENTICATION FLOW:
				// 1. Extract token from Authorization header or query parameter
				// 2. Validate token using authValidator
				// 3. Check if user can subscribe to requested topic
				// 4. Upgrade to WebSocket if all checks pass
				const token =
					request.headers.get("authorization")?.replace("Bearer ", "") ||
					new URL(request.url).searchParams.get("token");

				const auth = await authValidator.validate(token, request);

				// Check if user can subscribe to the requested topic
				const topic = new URL(request.url).pathname.slice(1) || "none";
				if (!authRules.canSubscribeToTopic(auth?.userId, topic)) {
					return new Response("Forbidden: Cannot subscribe to this topic", {
						status: 403,
					});
				}

				const data = await getWebSocketData(
					request,
					auth,
					enableSessionPersistence,
				);
				if (!server.upgrade(request, { data })) {
					return new Response("Upgrade failed", { status: 400 });
				}
			}

			const response = await getResponse(request, server);
			return response;
		},
		websocket: <WebSocketHandler<WebSocketData>>{
			async open(ws): Promise<void> {
				const topic = ws.data.topic;
				// Subscribe to topic for pub/sub messaging
				ws.subscribe(topic);

				// Register client in global map for direct peer-to-peer routing
				clients.set(ws.data.id, ws);

				// Register session for reconnection support
				// Maps sessionId -> clientId so reconnecting clients can restore their identity
				if (enableSessionPersistence && ws.data.auth?.sessionId) {
					sessions.set(ws.data.auth.sessionId, ws.data.id);
				}

				debug(
					`[ws] open ${ws.remoteAddress} id: ${ws.data.id} topic: ${topic} userId: ${ws.data.auth?.userId ?? "anonymous"} subscribers: ${server.subscriberCount(topic)}`,
				);

				// Send initial handshake/welcome
				ws.send(
					JSON.stringify({
						category: "welcome",
						clientId: ws.data.id,
						sessionId: ws.data.auth?.sessionId,
						restoredSession: ws.data.previousSessionId !== undefined,
					}),
				);
			},
			message(ws, message): void {
				const topic = ws.data.topic;
				if (!topic) {
					error(
						`[ws] Failed To Receive Message For ${ws.data.url} due to no Topic`,
					);
					return;
				}

				// Check message size
				let messageSize = 0;
				if (typeof message === "string") {
					messageSize = message.length;
				} else if (ArrayBuffer.isView(message)) {
					messageSize = message.byteLength;
				}

				if (messageSize > maxMessageSize) {
					warn(
						`[ws] Message from ${ws.data.id} exceeds max size: ${messageSize} > ${maxMessageSize}`,
					);
					ws.send(
						JSON.stringify({
							category: "error",
							error: "Message too large",
							maxSize: maxMessageSize,
						}),
					);
					return;
				}

				// Rate limiting
				if (enableRateLimit) {
					const userId = ws.data.auth?.userId ?? ws.data.id;
					const limit = authRules.getRateLimit(ws.data.auth?.userId);

					// Get or create rate limiter for this user
					// Each user gets their own token bucket for rate limiting
					let rateLimiter = rateLimiters.get(userId);
					if (!rateLimiter) {
						rateLimiter = RateLimiter.FromOptions({
							capacity: limit,
							refillRate: limit,
						});
						rateLimiters.set(userId, rateLimiter);
					}

					// Check if user has tokens available (not rate limited)
					if (!rateLimiter.tryConsume(userId)) {
						warn(`[ws] Rate limit exceeded for ${userId}`);
						ws.send(
							JSON.stringify({
								category: "error",
								error: "Rate limit exceeded",
								limit,
							}),
						);
						return;
					}
				}

				try {
					const raw =
						typeof message === "string"
							? message
							: new TextDecoder().decode(message);
					const parsed = JSON.parse(raw);

					// Handle ping/pong heartbeat messages
					// Clients send ping with timestamp, server responds with pong
					if (parsed.category === "ping") {
						ws.send(
							JSON.stringify({
								category: "pong",
								timestamp: parsed.timestamp,
							}),
						);
						return;
					}

					if (parsed.category === "pong") {
						// Client is responding to our ping, connection is alive
						return;
					}

					// ROUTING LOGIC:
					// If message has a 'to' field → direct peer-to-peer relay
					// If message has no 'to' field → broadcast to topic
					if (parsed.to) {
						// Check if sender is authorized to message this specific peer
						if (!authRules.canMessagePeer(ws.data.auth?.userId, parsed.to)) {
							warn(
								`[ws] Unauthorized peer message from ${ws.data.id} to ${parsed.to}`,
							);
							ws.send(
								JSON.stringify({
									category: "error",
									error: "Not authorized to message this peer",
								}),
							);
							return;
						}

						const target = clients.get(parsed.to);
						if (target) {
							// Route message directly to the target peer
							debug(`[ws] Routing message from ${ws.data.id} to ${parsed.to}`);
							target.send(message);
						} else {
							// Target peer not found (disconnected or never existed)
							warn(`[ws] Target ${parsed.to} not found`);
							ws.send(
								JSON.stringify({
									category: "error",
									error: "Target peer not found",
									targetId: parsed.to,
								}),
							);
						}
					} else {
						// No 'to' field → broadcast to all subscribers on the topic
						// Check if sender is authorized to publish to this topic
						if (!authRules.canPublishToTopic(ws.data.auth?.userId, topic)) {
							warn(
								`[ws] Unauthorized publish to topic ${topic} from ${ws.data.id}`,
							);
							ws.send(
								JSON.stringify({
									category: "error",
									error: "Not authorized to publish to this topic",
								}),
							);
							return;
						}

						// Otherwise broadcast to topic (legacy behavior + discovery)
						ws.publish(topic, message as string | Bun.BufferSource);
					}
				} catch (err) {
					error("[ws] Failed to parse message, broadcasting raw", err);
					ws.publish(topic, message as string | Bun.BufferSource);
				}
			},
			close(ws, code, reason): void {
				clients.delete(ws.data.id);

				// Clean up session if not persistent
				if (!enableSessionPersistence && ws.data.auth?.sessionId) {
					sessions.delete(ws.data.auth.sessionId);
				}

				// Clear rate limit
				if (enableRateLimit) {
					const userId = ws.data.auth?.userId ?? ws.data.id;
					const rateLimiter = rateLimiters.get(userId);
					if (rateLimiter) {
						rateLimiter.clear(userId);
						rateLimiters.delete(userId);
					}
				}

				debug(
					`[ws] close ${ws.remoteAddress} id: ${ws.data.id} code: ${code} reason: ${reason}`,
				);
			},
		},
	});
	log(`Server running at ${server.url}`);
	return server;
}

/**
 * Extracts and constructs WebSocket metadata from the HTTP upgrade request.
 * Handles session restoration by checking for previous session IDs.
 *
 * @param request - The HTTP upgrade request
 * @param auth - Authentication context if user is authenticated, null otherwise
 * @param enableSessionPersistence - Whether to attempt session restoration
 * @returns WebSocket metadata object
 * @internal
 */
function getWebSocketData(
	request: Request,
	auth: AuthContext | null,
	enableSessionPersistence: boolean,
): WebSocketData {
	const url = new URL(request.url);

	// SESSION RESTORATION LOGIC:
	// 1. Check if client provided a sessionId in URL query parameter
	// 2. If found and session persistence enabled, try to restore previous clientId
	// 3. If session expired/invalid or persistence disabled, generate new clientId
	const previousSessionId = url.searchParams.get("sessionId") || undefined;
	let id: string;

	if (enableSessionPersistence && previousSessionId) {
		const restoredClientId = sessions.get(previousSessionId);
		if (restoredClientId) {
			// Restore previous client ID for seamless reconnection
			id = restoredClientId;
			log(`[ws] Restoring session ${previousSessionId} with clientId ${id}`);
		} else {
			// Session expired or invalid, create new
			id = crypto.randomUUID();
			log(
				`[ws] Session ${previousSessionId} not found, creating new clientId ${id}`,
			);
		}
	} else {
		// No session restoration - generate new ID
		id = crypto.randomUUID();
	}

	const data: WebSocketData = {
		url: request.url,
		topic: url.pathname.slice(1) || "none",
		host: request.headers.get("host") ?? "unknown",
		origin: request.headers.get("origin") ?? "unknown",
		secWebsocketVersion:
			request.headers.get("sec-websocket-version") ?? "unknown",
		secWebsocketKey: request.headers.get("sec-websocket-key") ?? "unknown",
		secWebsocketExtensions:
			request.headers.get("sec-websocket-extensions") ?? "unknown",
		secWebsocketProtocol:
			request.headers.get("sec-websocket-protocol") ?? "unknown",
		acceptEncoding: request.headers.get("accept-encoding") ?? "unknown",
		userAgent: request.headers.get("user-agent") ?? "unknown",
		date: new Date(),
		id,
		auth: auth
			? {
					...auth,
					sessionId: auth.sessionId ?? crypto.randomUUID(),
				}
			: null,
		previousSessionId,
	};
	return data;
}

/**
 * Routes HTTP requests to the appropriate API handler based on method.
 *
 * @param request - The HTTP request
 * @param server - The Bun server instance
 * @returns HTTP response
 * @internal
 */
async function getResponse(
	request: Request,
	server: Server,
): Promise<Response> {
	switch (request.method) {
		case "GET": {
			const response = await api.GET(request, server);
			return response;
		}
		case "POST": {
			timeEnd(`Request ${request.url}`);
			return api.POST(request, server);
		}
		case "DELETE": {
			timeEnd(`Request ${request.url}`);
			return api.DELETE(request, server);
		}
		default: {
			timeEnd(`Request ${request.url}`);
			return new Response("404");
		}
	}
}

const cli = {
	collect() {
		const parsed = util.parseArgs({
			strict: true,
			options: {
				development: {
					type: "boolean",
					default: true,
				},
				hostname: {
					type: "string",
					default: "127.0.0.1",
				},
				hot: {
					type: "boolean",
					default: false,
				},
				port: {
					type: "string",
					default: "8080",
				},
			},
		});
		return {
			...parsed.values,
			port: Number.parseInt(parsed.values.port ?? 8080, 10),
		};
	},
};

if (import.meta.main) {
	const collected = cli.collect();
	serve(collected);
}
