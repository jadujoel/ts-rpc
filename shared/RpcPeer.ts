import { z } from "zod";
import { RetrySocket } from "./RetrySocket.ts";
import { StreamManager, type StreamManagerOptions } from "./RpcStream.ts";
import {
	getCloseCodeDescription,
	type WebSocketCloseCode,
	WS_CLOSE_NORMAL,
} from "./WebSocketCloseCodes.ts";

// Polyfill for Promise.withResolvers
if (Promise.withResolvers === undefined) {
	Promise.withResolvers = () => {
		let resolve: ExplicitAny;
		let reject: ExplicitAny;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

/**
 * Zod schema for validating all RPC message types.
 * Supports request, response, welcome, ping, pong, and error messages.
 */
export const RpcMessageSchema = z.discriminatedUnion("category", [
	z.object({
		category: z.literal("request"),
		requestId: z.string(),
		from: z.string().optional(),
		fromName: z.string().optional(),
		to: z.string().optional(),
		toName: z.string().optional(),
		data: z.unknown(),
	}),
	z.object({
		category: z.literal("response"),
		requestId: z.string(),
		from: z.string().optional(),
		fromName: z.string().optional(),
		to: z.string().optional(),
		toName: z.string().optional(),
		data: z.unknown(),
	}),
	z.object({
		category: z.literal("welcome"),
		clientId: z.string(),
		sessionId: z.string().optional(),
		restoredSession: z.boolean().optional(),
	}),
	z.object({
		category: z.literal("ping"),
		timestamp: z.number(),
	}),
	z.object({
		category: z.literal("pong"),
		timestamp: z.number(),
	}),
	z.object({
		category: z.literal("error"),
		error: z.string(),
		details: z.unknown().optional(),
	}),
]);

/**
 * Represents a request message sent from one peer to another.
 * @template TData - The payload data type
 * @template TRequestId - The request ID string type
 * @template TFrom - The sender's client ID type
 * @template TTo - The recipient's client ID type
 */
export type RpcRequest<
	TData = unknown,
	TRequestId extends string = string,
	TFrom extends string = string,
	TTo extends string = string,
> = {
	readonly category: "request";
	readonly requestId: TRequestId;
	readonly from?: TFrom;
	readonly fromName?: string;
	readonly to?: TTo;
	readonly toName?: string;
	readonly data: TData;
};

/**
 * Represents a response message sent in reply to a request.
 * @template TData - The payload data type
 * @template TRequestId - The request ID string type
 * @template TFrom - The sender's client ID type
 * @template TTo - The recipient's client ID type
 * @template TFromName - The sender's display name type
 * @template TToName - The recipient's display name type
 */
export type RpcResponse<
	TData = unknown,
	TRequestId extends string = string,
	TFrom extends string = string,
	TTo extends string = string,
	TFromName extends string = string,
	TToName extends string = string,
> = {
	readonly category: "response";
	readonly requestId: TRequestId;
	readonly from?: TFrom;
	readonly fromName?: TFromName;
	readonly to?: TTo;
	readonly toName?: TToName;
	readonly data: TData;
};

/**
 * Welcome message sent by the server when a client connects.
 * Contains the assigned client ID and optional session information.
 * @template TClientId - The client ID string type
 */
export type RpcWelcome<TClientId extends string = string> = {
	readonly category: "welcome";
	readonly clientId: TClientId;
	readonly sessionId?: string;
	readonly restoredSession?: boolean;
};

/**
 * Heartbeat ping message sent to verify connection health.
 */
export type RpcPing = {
	readonly category: "ping";
	readonly timestamp: number;
};

/**
 * Heartbeat pong message sent in response to a ping.
 */
export type RpcPong = {
	readonly category: "pong";
	readonly timestamp: number;
};

/**
 * Error message sent when a server-side error occurs.
 */
export type RpcError = {
	readonly category: "error";
	readonly error: string;
	readonly details?: unknown;
};

/**
 * Union type representing all possible RPC message types.
 * @template TRequest - The request payload type
 * @template TResponse - The response payload type
 * @template TRequestId - The request ID string type
 * @template TFrom - The sender's client ID type
 * @template TTo - The recipient's client ID type
 * @template TClientId - The client ID type for welcome messages
 * @template TFromName - The sender's display name type
 * @template TToName - The recipient's display name type
 */
export type RpcApi<
	TRequest extends ExplicitAny = ExplicitAny,
	TResponse extends ExplicitAny = ExplicitAny,
	TRequestId extends string = string,
	TFrom extends string = string,
	TTo extends string = string,
	TClientId extends string = string,
	TFromName extends string = string,
	TToName extends string = string,
> =
	| RpcRequest<TRequest, TRequestId, TFrom, TTo>
	| RpcResponse<TResponse, TRequestId, TFrom, TTo, TFromName, TToName>
	| RpcWelcome<TClientId>
	| RpcPing
	| RpcPong
	| RpcError;

export type Success = boolean;

// biome-ignore lint/suspicious/noExplicitAny: we want to use any for generic types
export type ExplicitAny = any;

/**
 * Represents a pending promise waiting for a response.
 * @internal
 */
export interface PendingPromiseItem {
	readonly resolve: (data: ExplicitAny) => void;
	readonly reject: (err: ExplicitAny) => void;
	readonly timer: SetTimeoutReturn;
}

/**
 * Map of request IDs to their pending promise handlers.
 * @template TPromiseType - The request ID string type
 */
export type PendingPromiseMap<TPromiseType extends string = string> = Map<
	TPromiseType,
	PendingPromiseItem
>;

/**
 * Configuration options for creating an RpcPeer instance.
 * @template TRequestSchema - Zod schema for validating outgoing requests
 * @template TResponseSchema - Zod schema for validating incoming responses
 * @template TClientId - The client ID string type
 * @template TName - The peer name string type
 * @template TUrl - The WebSocket URL string type
 */
export interface RpcPeerFromOptions<
	TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	_TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
	_TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
	TClientId extends string = string,
	TName extends string = string,
	TUrl extends string = string,
> {
	/** WebSocket URL to connect to. Must be ws:// or wss:// protocol. */
	readonly url: TUrl;
	/** Display name for this peer. Default is "RpcPeer". */
	readonly name?: TName;
	/** Existing client ID if reconnecting with a known identity. */
	readonly clientId?: TClientId;
	/** Session ID for session restoration after reconnection. */
	readonly sessionId?: string;
	/** Map of pending promises awaiting responses. Usually left undefined for new connections. */
	readonly pendingPromises?: PendingPromiseMap;
	/** Custom RetrySocket instance. If not provided, one will be created automatically. */
	readonly retrySocket?: RetrySocket;
	/** Zod schema for validating outgoing request payloads. */
	readonly requestSchema: TRequestSchema;
	/** Zod schema for validating incoming response payloads. */
	readonly responseSchema: TResponseSchema;
	/** Enable automatic heartbeat pings to detect connection health. Default is false. */
	readonly enableHeartbeat?: boolean;
	/** Internal heartbeat timer reference. Usually left undefined. */
	readonly heartbeatTimer?: ReturnType<typeof setTimeout> | null;
	/** Interval between heartbeat pings in milliseconds. Default is 30000 (30 seconds). */
	readonly heartbeatInterval?: number;
	/** Configuration options for the stream manager. */
	readonly streamOptions?: StreamManagerOptions;
	/** Custom StreamManager instance. If not provided, one will be created automatically. */
	readonly streamManager?: StreamManager;
}

/**
 * Handler function for matching and responding to incoming requests.
 * Return undefined to not send a response, or return/resolve a value to respond.
 * @template TRequestApi - The expected request payload type
 * @template TResponseApi - The response payload type to return
 * @template TFrom - The sender's client ID type
 */
export type MatchHandler<
	TRequestApi extends ExplicitAny = ExplicitAny,
	TResponseApi extends ExplicitAny = ExplicitAny,
	TFrom extends string = string,
> = (
	data: TRequestApi,
	from?: TFrom,
) => Promise<TResponseApi | undefined> | TResponseApi | undefined;

/** Type alias for the global setTimeout function. */
export type SetTimeout = typeof globalThis.setTimeout;
/** Return type of setTimeout. */
export type SetTimeoutReturn = ReturnType<SetTimeout>;

/**
 * Event map defining all events emitted by RpcPeer.
 */
export type RpcPeerEventMap = {
	readonly open: Event;
	readonly close: CloseEvent;
	readonly error: Event;
	readonly welcome: CustomEvent<RpcWelcome>;
	readonly request: CustomEvent<RpcRequest>;
	readonly notification: CustomEvent<RpcRequest>;
	readonly response: CustomEvent<RpcResponse>;
};

/**
 * Connection state of the RpcPeer.
 * Mirrors WebSocket readyState values for consistency.
 */
export type RpcPeerState = "connecting" | "open" | "closing" | "closed";

/**
 * Type guard to check if a message is a welcome message.
 * @template TClientId - The client ID string type
 * @param message - The message to check
 * @param clientId - Optional expected client ID to validate against
 * @returns True if the message is a valid welcome message
 */
export function isWelcomeMessage<TClientId extends string = string>(
	message: unknown,
	clientId?: TClientId,
): message is RpcWelcome<TClientId> {
	if (typeof message !== "object" || message === null) {
		return false;
	}
	const tmessage = message as {
		readonly category?: unknown;
		readonly clientId?: unknown;
	};
	if (clientId !== undefined) {
		if (tmessage.clientId !== clientId) {
			return false;
		}
	}
	return tmessage.category === "welcome";
}

/**
 * RpcPeer provides bidirectional RPC communication over WebSocket with automatic reconnection.
 *
 * Supports request-response patterns, streaming, session restoration, and heartbeat monitoring.
 * Uses a relay server architecture where messages can be routed between peers by client ID.
 *
 * @template TRequestSchema - Zod schema for validating outgoing requests
 * @template TResponseSchema - Zod schema for validating incoming responses
 * @template TRequestApi - Inferred request payload type from schema
 * @template TResponseApi - Inferred response payload type from schema
 * @template TClientId - The client ID string type
 * @template TName - The peer name string type
 * @template TUrl - The WebSocket URL string type
 *
 * @example
 * ```typescript
 * const peer = RpcPeer.FromOptions({
 *   url: 'ws://localhost:8080',
 *   requestSchema: z.object({ action: z.string() }),
 *   responseSchema: z.object({ result: z.string() }),
 *   enableHeartbeat: true
 * });
 *
 * await peer.waitForWelcome();
 * const response = await peer.request({ action: 'ping' });
 * console.log(response.data);
 * ```
 */
export class RpcPeer<
	TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
	TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
	TClientId extends string = string,
	TName extends string = string,
	TUrl extends string = string,
> extends EventTarget {
	private constructor(
		public readonly url: TUrl,
		public readonly name: TName,
		public clientId: TClientId | undefined,
		public readonly pendingPromises: PendingPromiseMap = new Map(),
		public readonly retrySocket: RetrySocket,
		public readonly requestSchema: TRequestSchema | undefined,
		public readonly responseSchema: TResponseSchema | undefined,
		public sessionId: string | undefined,
		private heartbeatTimer: SetTimeoutReturn | null = null,
		private readonly heartbeatInterval: number = RpcPeer.DefaultHeartbeatInterval,
		public readonly streamManager: StreamManager = new StreamManager(),
	) {
		super();
	}

	/** Default interval for heartbeat pings in milliseconds (30 seconds). */
	public static readonly DefaultHeartbeatInterval = 30_000 as const;
	/** Zod schema for validating all RPC message types. */
	public static readonly MessageSchema = RpcMessageSchema;
	/** Standard error instances used throughout RpcPeer. */
	public static readonly Errors = {
		InvalidMessageFormat: new Error("Invalid message format"),
		InvalidRequestData: new Error("Invalid request data"),
		InvalidResponseData: new Error("Invalid response data"),
		RequestTimedOut: new Error("Request timed out"),
		ConnectionClosed: new Error("Connection closed"),
		CloseTimedOut: new Error("Close timed out"),
	} as const;

	/**
	 * Creates a response event with the given detail.
	 * @template TRpcResponse - The response type
	 * @param detail - The response data
	 * @returns Custom event containing the response
	 */
	public static ResponseEvent<const TRpcResponse extends RpcResponse>(
		detail: TRpcResponse,
	): CustomEvent<TRpcResponse> {
		return new CustomEvent("response", { detail });
	}

	/**
	 * Creates a request event with the given detail.
	 * @template TRpcRequest - The request type
	 * @param detail - The request data
	 * @returns Custom event containing the request
	 */
	public static RequestEvent<const TRpcRequest extends RpcRequest>(
		detail: TRpcRequest,
	): CustomEvent<TRpcRequest> {
		return new CustomEvent("request", { detail });
	}

	/**
	 * Creates a notification event with the given detail.
	 * Notifications are incoming request-category messages whose data
	 * matches the response schema rather than the request schema.
	 * @template TRpcRequest - The request type
	 * @param detail - The notification data
	 * @returns Custom event containing the notification
	 */
	public static NotificationEvent<const TRpcRequest extends RpcRequest>(
		detail: TRpcRequest,
	): CustomEvent<TRpcRequest> {
		return new CustomEvent("notification", { detail });
	}

	/**
	 * Creates a welcome event with the given detail.
	 * @template TRpcWelcome - The welcome message type
	 * @param detail - The welcome message data
	 * @returns Custom event containing the welcome message
	 */
	public static WelcomeEvent<const TRpcWelcome extends RpcWelcome>(
		detail: TRpcWelcome,
	): CustomEvent<TRpcWelcome> {
		return new CustomEvent("welcome", { detail });
	}

	/** All possible connection states for an RpcPeer. */
	static readonly PossibleStates = [
		"connecting",
		"open",
		"closing",
		"closed",
	] as const;

	/**
	 * Factory method to create a new RpcPeer instance.
	 * Automatically sets up the RetrySocket, event forwarding, and stream manager.
	 *
	 * @template TRequestSchema - Zod schema for validating outgoing requests
	 * @template TResponseSchema - Zod schema for validating incoming responses
	 * @template TRequestApi - Inferred request payload type from schema
	 * @template TResponseApi - Inferred response payload type from schema
	 * @template TClientId - The client ID string type
	 * @template TName - The peer name string type
	 * @template TUrl - The WebSocket URL string type
	 * @param options - Configuration options for the peer
	 * @returns A fully configured RpcPeer instance
	 *
	 * @example
	 * ```typescript
	 * const peer = RpcPeer.FromOptions({
	 *   url: 'ws://localhost:8080',
	 *   name: 'MyClient',
	 *   requestSchema: z.object({ type: z.string(), payload: z.unknown() }),
	 *   responseSchema: z.object({ success: z.boolean(), data: z.unknown() }),
	 *   sessionId: 'existing-session-123', // For session restoration
	 *   enableHeartbeat: true,
	 *   heartbeatInterval: 15000 // 15 seconds
	 * });
	 * ```
	 */
	public static FromOptions<
		TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
		TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
		TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
		TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
		TClientId extends string = string,
		TName extends string = string,
		TUrl extends string = string,
	>(
		options: RpcPeerFromOptions<
			TRequestSchema,
			TResponseSchema,
			TRequestApi,
			TResponseApi,
			TClientId,
			TName,
			TUrl
		>,
	): RpcPeer<
		TRequestSchema,
		TResponseSchema,
		TRequestApi,
		TResponseApi,
		TClientId,
		TName,
		TUrl
	> {
		// Build URL with sessionId if provided
		let url = options.url;
		if (options.sessionId) {
			const urlObj = new URL(url);
			urlObj.searchParams.set("sessionId", options.sessionId);
			url = urlObj.toString() as TUrl;
		}

		const peer = new RpcPeer<
			TRequestSchema,
			TResponseSchema,
			TRequestApi,
			TResponseApi,
			TClientId,
			TName,
			TUrl
		>(
			url,
			options.name ?? ("RpcPeer" as TName),
			options.clientId ?? undefined,
			options.pendingPromises ?? new Map(),
			options.retrySocket ?? RetrySocket.FromUrl(url),
			options.requestSchema ?? undefined,
			options.responseSchema ?? undefined,
			options.sessionId,
			options.heartbeatTimer ?? null,
			options.heartbeatInterval ?? RpcPeer.DefaultHeartbeatInterval,
			options.streamManager ?? StreamManager.FromOptions(options.streamOptions),
		);

		peer.retrySocket.addEventListener("message", (ev) =>
			peer.handleMessage(ev as MessageEvent),
		);
		// Forward events from RetrySocket to RpcPeer's EventTarget
		// Note: We create new Event objects instead of reusing the same ones
		// because events cannot be re-dispatched once they're being dispatched
		peer.retrySocket.addEventListener("open", (ev) => {
			peer.dispatchEvent(new Event(ev.type));
			// Start heartbeat when connected
			if (options.enableHeartbeat) {
				peer.startHeartbeat();
			}
		});
		peer.retrySocket.addEventListener("close", (ev: Event): void => {
			const actual = ev as CloseEvent;
			peer.stopHeartbeat();
			// Clean up all active streams when connection closes
			peer.streamManager.cleanup();
			peer.dispatchEvent(
				new CloseEvent("close", {
					code: actual.code,
					reason: actual.reason,
					wasClean: actual.wasClean,
				}),
			);
		});
		peer.retrySocket.addEventListener("error", (ev: Event) => {
			peer.dispatchEvent(new Event(ev.type));
		});
		return peer;
	}

	/** Default timeout values for various operations in milliseconds. */
	public static Timeouts = {
		Request: 4_000,
		Close: 4_000,
		Welcome: 4_000,
	} as const;

	/**
	 * Disposes of the peer, closing the connection and cleaning up all resources.
	 * Rejects all pending promises and aborts all active streams.
	 *
	 * @returns Promise that resolves when disposal is complete
	 *
	 * @example
	 * ```typescript
	 * await peer.dispose();
	 * // Peer is now fully cleaned up and cannot be reused
	 * ```
	 */
	async dispose(): Promise<void> {
		console.time("[Peer] Dispose");
		console.debug("[Peer] Dispose");
		this.stopHeartbeat();
		await this.close();

		await this.retrySocket.dispose();

		// Clean up all active streams
		this.streamManager.cleanup();

		// Reject all pending promises before closing
		for (const item of this.pendingPromises.values()) {
			globalThis.clearTimeout(item.timer);
			item.reject(RpcPeer.Errors.ConnectionClosed);
		}
		this.pendingPromises.clear();

		console.time("[Peer] Dispose");
	}

	/**
	 * Starts sending periodic heartbeat pings.
	 * @private
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = globalThis.setInterval(() => {
			if (this.retrySocket.readyState === WebSocket.OPEN) {
				this.retrySocket.send(
					JSON.stringify({
						category: "ping",
						timestamp: Date.now(),
					}),
				);
			}
		}, this.heartbeatInterval);
	}

	/**
	 * Stops sending heartbeat pings.
	 * @private
	 */
	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			globalThis.clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	/**
	 * Gets the current connection state of the peer.
	 * @returns The connection state (connecting, open, closing, or closed)
	 */
	get state(): RpcPeerState {
		return RpcPeer.PossibleStates[this.retrySocket.readyState] ?? "closed";
	}

	/**
	 * Checks if the peer has received a welcome message from the server.
	 * @returns True if a client ID has been assigned by the server
	 */
	welcomed(): boolean {
		return this.clientId !== undefined;
	}

	/**
	 * Waits for the welcome message from the server.
	 * Use this after connection to ensure the peer is fully initialized before sending requests.
	 *
	 * @param timeout - Maximum time to wait in milliseconds. Default is 4000 (4 seconds).
	 * @returns Promise that resolves with the assigned client ID
	 * @throws {RpcPeer.Errors.RequestTimedOut} If no welcome message is received within the timeout
	 *
	 * @example
	 * ```typescript
	 * const peer = RpcPeer.FromOptions({ url: 'ws://localhost:8080', ... });
	 * const clientId = await peer.waitForWelcome();
	 * console.log(`Connected with ID: ${clientId}`);
	 * ```
	 */
	waitForWelcome(
		timeout: number = RpcPeer.Timeouts.Welcome,
	): Promise<TClientId> {
		if (this.clientId !== undefined) {
			return Promise.resolve(this.clientId);
		}

		return new Promise((resolve, reject) => {
			const welcomeHandler = (ev: CustomEvent<RpcWelcome<TClientId>>): void => {
				const isWelcome = isWelcomeMessage(ev.detail, this.clientId);
				if (!isWelcome) {
					return;
				}
				this.removeEventListener("welcome", welcomeHandler as EventListener);
				globalThis.clearTimeout(timer);
				resolve(ev.detail.clientId);
			};

			const timer = globalThis.setTimeout(() => {
				this.removeEventListener("welcome", welcomeHandler as EventListener);
				reject(RpcPeer.Errors.RequestTimedOut);
			}, timeout);

			this.addEventListener("welcome", welcomeHandler as EventListener, {
				once: true,
			});
		});
	}

	/**
	 * Closes the WebSocket connection gracefully.
	 * Waits for the close event to be received before resolving.
	 *
	 * @param code - WebSocket close code. Default is 1000 (normal closure).
	 * @param reason - Human-readable close reason.
	 * @param timeout - Maximum time to wait for closure in milliseconds. Default is 4000 (4 seconds).
	 * @returns Promise that resolves when the connection is closed
	 * @throws {RpcPeer.Errors.CloseTimedOut} If the connection doesn't close within the timeout
	 *
	 * @example
	 * ```typescript
	 * await peer.close(1000, 'User initiated disconnect');
	 * ```
	 */
	close(
		code: WebSocketCloseCode = WS_CLOSE_NORMAL,
		reason = getCloseCodeDescription(code),
		timeout: number = RpcPeer.Timeouts.Close,
	): Promise<void> {
		const timeId = `Peer Close ${this.clientId}`;
		console.time(timeId);
		console.debug(`[Peer] Closing: ${reason}`);
		return new Promise((resolve, reject) => {
			if (this.state === "closed") {
				console.debug("[Peer] Already closed");
				console.timeEnd(timeId);
				resolve();
				return;
			}

			// If already closed, resolve immediately
			if (this.retrySocket.readyState === RetrySocket.CLOSED) {
				// CLOSED
				console.debug("[Peer] Socket readystate closed");
				console.timeEnd(timeId);
				resolve();
				return;
			}

			// Register close handler before calling close
			// This is important because RetrySocket.close() sets isClosedByUser = true
			// which would prevent addEventListener from working
			const closeHandler = () => {
				console.debug(`[Peer] Socket closed, code: ${code}, reason: ${reason}`);
				globalThis.clearTimeout(closeTimeout);
				this.removeEventListener("close", closeHandler);
				console.timeEnd(timeId);
				resolve();
			};

			this.addEventListener("close", closeHandler);

			// Set up timeout to prevent waiting forever
			const closeTimeout = globalThis.setTimeout(() => {
				console.warn(
					`[Peer] Close timed out after ${timeout}ms, forcing close`,
				);
				this.removeEventListener("close", closeHandler);
				console.timeEnd(timeId);
				reject(RpcPeer.Errors.CloseTimedOut);
			}, timeout);

			// Close the socket - this sets isClosedByUser = true and clears listeners
			// But we registered our listener above, so it should fire first
			this.retrySocket.close(code, reason);
		});
	}

	/**
	 * Handles incoming WebSocket messages.
	 * Routes messages to appropriate handlers based on message category.
	 * Validates payloads against schemas if provided.
	 *
	 * @param ev - The WebSocket message event
	 * @returns True if the message was successfully processed
	 * @private
	 */
	handleMessage(ev: MessageEvent): Success {
		try {
			const json = JSON.parse(ev.data);

			// Check if this is a stream message
			if (this.streamManager.isStreamMessage(json)) {
				return this.streamManager.handleStreamMessage(json);
			}

			const parsed = RpcMessageSchema.safeParse(json);

			if (!parsed.success) {
				console.warn("[Peer] Invalid message format:", parsed.error);
				return false;
			}

			const message = parsed.data;

			if (message.category === "welcome") {
				this.clientId = message.clientId as TClientId;
				if (message.sessionId) {
					this.sessionId = message.sessionId;
				}
				console.debug(
					`[Peer] Assigned ID: ${this.clientId}, Session: ${this.sessionId}, Restored: ${message.restoredSession ?? false}`,
				);
				this.dispatchEvent(RpcPeer.WelcomeEvent(message));
				return true;
			}

			if (message.category === "ping") {
				// Respond to ping with pong
				this.retrySocket.send(
					JSON.stringify({
						category: "pong",
						timestamp: message.timestamp,
					}),
				);
				return true;
			}

			if (message.category === "pong") {
				// Could track latency here if needed
				const latency = Date.now() - message.timestamp;
				console.debug(`[Peer] Heartbeat latency: ${latency}ms`);
				return true;
			}

			if (message.category === "error") {
				console.error(`[Peer] Server error: ${message.error}`, message.details);
				// Dispatch error event
				this.dispatchEvent(
					new CustomEvent("error", {
						detail: message,
					}),
				);
				return true;
			}

			if (message.category === "request") {
				// Validation of data payload if schema provided
				if (this.requestSchema !== undefined) {
					const valid = this.requestSchema.safeParse(message.data);
					if (valid.success) {
						this.dispatchEvent(RpcPeer.RequestEvent(message));
						return true;
					}
				} else {
					// No request schema — dispatch as request
					this.dispatchEvent(RpcPeer.RequestEvent(message));
					return true;
				}

				// Request schema validation failed — try response schema as notification
				if (this.responseSchema !== undefined) {
					const valid = this.responseSchema.safeParse(message.data);
					if (valid.success) {
						this.dispatchEvent(RpcPeer.NotificationEvent(message));
						return true;
					}
				}

				console.debug("[Peer] Invalid request data — no matching schema");
				return false;
			} else if (message.category === "response") {
				const pending = this.pendingPromises.get(message.requestId);
				if (pending) {
					if (this.responseSchema !== undefined) {
						const valid = this.responseSchema.safeParse(message.data);
						if (!valid.success) {
							console.debug(
								`[Peer] Invalid response data: ${valid.error.message}`,
							);
							pending.reject(RpcPeer.Errors.InvalidResponseData);
							globalThis.clearTimeout(pending.timer);
							this.pendingPromises.delete(message.requestId);
							return false;
						}
					}

					pending.resolve(message);
					globalThis.clearTimeout(pending.timer);
					this.pendingPromises.delete(message.requestId);
				}
			}
		} catch (err) {
			console.debug("[Peer] message error", err);
			return false;
		}
		return true;
	}

	/**
	 * Sends a one-way request without waiting for a response.
	 * Use this for fire-and-forget messages.
	 *
	 * @param data - The request payload to send
	 *
	 * @example
	 * ```typescript
	 * peer.send({ type: 'notify', message: 'Hello' });
	 * ```
	 */
	send(data: TRequestApi): void {
		const message: RpcRequest<TRequestApi> = {
			category: "request",
			requestId: crypto.randomUUID(),
			from: this.clientId,
			fromName: this.name,
			data: data,
		};
		this.retrySocket.send(JSON.stringify(message));
	}

	/**
	 * Sends a request and waits for a response.
	 * Automatically handles request-response correlation and timeouts.
	 *
	 * @template TResponse - The expected response type
	 * @template TRequest - The request payload type
	 * @param data - The request payload to send
	 * @param toOrTimeout - Either the recipient client ID or timeout in milliseconds
	 * @param timeoutParam - Timeout in milliseconds if recipient ID was provided
	 * @returns Promise that resolves with the response message
	 * @throws {RpcPeer.Errors.RequestTimedOut} If no response is received within the timeout
	 *
	 * @example
	 * ```typescript
	 * // Simple request with default timeout
	 * const response = await peer.request({ action: 'getUser', id: 123 });
	 * console.log(response.data);
	 *
	 * // Request with custom timeout
	 * const response = await peer.request({ action: 'slowQuery' }, 10000);
	 *
	 * // Request to a specific peer
	 * const response = await peer.request({ action: 'ping' }, 'peer-client-id-456');
	 * ```
	 */
	request<const TResponse = TResponseApi, const TRequest = TRequestApi>(
		data: TRequest,
		toOrTimeout?: string | number,
		timeoutParam?: number,
	): Promise<RpcResponse<TResponse>> {
		const to = typeof toOrTimeout === "string" ? toOrTimeout : undefined;
		const timeout =
			typeof toOrTimeout === "number"
				? toOrTimeout
				: (timeoutParam ?? RpcPeer.Timeouts.Request);

		const requestId = crypto.randomUUID();

		const message: RpcRequest<TRequest> = {
			category: "request",
			requestId,
			from: this.clientId,
			fromName: this.name,
			to,
			data: data,
		};

		const { promise, resolve, reject } =
			Promise.withResolvers<RpcResponse<TResponse>>();

		const timer = globalThis.setTimeout(() => {
			if (this.pendingPromises.has(requestId)) {
				this.pendingPromises.delete(requestId);
				reject(RpcPeer.Errors.RequestTimedOut);
			}
		}, timeout);

		this.pendingPromises.set(requestId, { resolve, reject, timer });

		try {
			this.retrySocket.send(JSON.stringify(message));
		} catch (err) {
			globalThis.clearTimeout(timer);
			this.pendingPromises.delete(requestId);
			reject(err);
		}
		return promise;
	}

	/** Alias for the request method. */
	call = this.request;

	/**
	 * Sends a response to a previously received request.
	 * Use this to reply to requests received via the 'request' event or match handler.
	 *
	 * @param originalRequest - The request message to respond to
	 * @param data - The response payload
	 *
	 * @example
	 * ```typescript
	 * peer.addEventListener('request', (ev: CustomEvent<RpcRequest>) => {
	 *   const request = ev.detail;
	 *   if (request.data.action === 'ping') {
	 *     peer.respondTo(request, { result: 'pong' });
	 *   }
	 * });
	 * ```
	 */
	respondTo(
		originalRequest: RpcRequest<TRequestApi>,
		data: TResponseApi,
	): void {
		const message: RpcResponse<TResponseApi> = {
			category: "response",
			requestId: originalRequest.requestId,
			from: this.clientId,
			fromName: this.name,
			to: originalRequest.from,
			toName: originalRequest.fromName,
			data,
		};
		this.retrySocket.send(JSON.stringify(message));
	}

	/**
	 * Registers a handler that automatically responds to matching requests.
	 * The handler is called for every incoming request event.
	 * Return undefined from the handler to not send a response.
	 *
	 * @template THandler - The handler function type
	 * @param handler - Function that processes requests and returns responses
	 *
	 * @example
	 * ```typescript
	 * // Simple echo handler
	 * peer.match(async (data) => {
	 *   return { echo: data };
	 * });
	 *
	 * // Conditional handler
	 * peer.match(async (data, from) => {
	 *   if (data.action === 'ping') {
	 *     return { result: 'pong', from };
	 *   }
	 *   // Returning undefined means no response is sent
	 * });
	 * ```
	 */
	match<
		const THandler extends MatchHandler<
			ExplicitAny,
			TResponseApi,
			string
		> = MatchHandler<ExplicitAny, TResponseApi, string>,
	>(handler: THandler): void {
		this.addEventListener("request", async (ev: Event) => {
			const customEv = ev as CustomEvent<RpcRequest<TRequestApi>>;
			const req = customEv.detail;
			try {
				const result = await handler(req.data, req.from);
				if (result !== undefined) {
					this.respondTo(req, result);
				}
			} catch (err) {
				console.error("[Peer] Match handler error", err);
			}
		});
	}

	/**
	 * Registers a handler for server-initiated notification messages.
	 * Notifications are incoming request-category messages whose data
	 * matches the response schema rather than the request schema.
	 *
	 * Unlike match(), the handler does not return a response.
	 *
	 * @param handler - Function that processes notification data
	 *
	 * @example
	 * ```typescript
	 * peer.onNotification((data, from) => {
	 *   console.log(`Notification from ${from}:`, data);
	 * });
	 * ```
	 */
	onNotification(
		handler: (data: TResponseApi, from?: string) => void | Promise<void>,
	): void {
		this.addEventListener("notification", async (ev: Event) => {
			const customEv = ev as CustomEvent<RpcRequest<TResponseApi>>;
			const req = customEv.detail;
			try {
				await handler(req.data, req.from);
			} catch (err) {
				console.error("[Peer] Notification handler error", err);
			}
		});
	}

	/**
	 * Sends an AsyncIterable as a stream over the WebSocket connection.
	 * Handles backpressure and resource cleanup automatically.
	 * @template T - The type of items in the iterable
	 * @param iterable - AsyncIterable to stream
	 * @param streamId - Optional custom stream ID
	 * @returns Promise that resolves with the stream ID when complete
	 */
	async sendStream<T>(
		iterable: AsyncIterable<T>,
		streamId?: string,
	): Promise<string> {
		return this.streamManager.sendStream(
			{
				send: (data: string) => this.retrySocket.send(data),
				bufferedAmount: this.retrySocket.bufferedAmount,
			},
			iterable,
			streamId,
		);
	}

	/**
	 * Creates a ReadableStream that will receive data from a remote stream.
	 * @template T - The type of items in the stream
	 * @param streamId - Optional stream ID (auto-generated if not provided)
	 * @returns Tuple of [streamId, ReadableStream]
	 */
	receiveStream<T = unknown>(
		streamId?: string,
	): readonly [string, ReadableStream<T>] {
		return this.streamManager.createReceivingStream<T>(streamId);
	}

	/**
	 * Aborts an active outgoing stream.
	 * @param streamId - ID of the stream to abort
	 */
	abortStream(streamId: string): void {
		this.streamManager.abort(streamId);
	}

	/**
	 * Closes a receiving stream.
	 * @param streamId - ID of the stream to close
	 */
	closeReceivingStream(streamId: string): void {
		this.streamManager.closeReceivingStream(streamId);
	}
}
