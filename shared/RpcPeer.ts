import { z } from "zod";
import { RetrySocket } from "./RetrySocket.ts";
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
	}),
]);

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

export type RpcResponse<
	TData = unknown,
	TRequestId extends string = string,
	TFrom extends string = string,
	TTo extends string = string,
> = {
	readonly category: "response";
	readonly requestId: TRequestId;
	readonly from?: TFrom;
	readonly fromName?: string;
	readonly to?: TTo;
	readonly toName?: string;
	readonly data: TData;
};

export type RpcWelcome<TClientId extends string = string> = {
	readonly category: "welcome";
	readonly clientId: TClientId;
};

export type RpcApi<
	TRequest extends ExplicitAny = ExplicitAny,
	TResponse extends ExplicitAny = ExplicitAny,
	TRequestId extends string = string,
	TFrom extends string = string,
	TTo extends string = string,
	TClientId extends string = string,
> =
	| RpcRequest<TRequest, TRequestId, TFrom, TTo>
	| RpcResponse<TResponse, TRequestId, TFrom, TTo>
	| RpcWelcome<TClientId>;

export type Success = boolean;

// biome-ignore lint/suspicious/noExplicitAny: we want to use any for generic types
export type ExplicitAny = any;

export interface PendingPromiseItem {
	readonly resolve: (data: ExplicitAny) => void;
	readonly reject: (err: ExplicitAny) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export type PendingPromiseMap<TPromiseType extends string = string> = Map<
	TPromiseType,
	PendingPromiseItem
>;

export interface RpcPeerFromOptions<
	TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	_TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
	_TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
	TClientId extends string = string,
	TName extends string = string,
	TUrl extends string = string,
> {
	readonly url: TUrl;
	readonly name?: TName;
	readonly clientId?: TClientId;
	readonly pendingPromises?: PendingPromiseMap;
	readonly retrySocket?: RetrySocket;
	readonly requestSchema: TRequestSchema;
	readonly responseSchema: TResponseSchema;
}

export type MatchHandler<
	TRequestApi extends ExplicitAny = ExplicitAny,
	TResponseApi extends ExplicitAny = ExplicitAny,
	TFrom extends string = string,
> = (
	data: TRequestApi,
	from?: TFrom,
) => Promise<TResponseApi | undefined> | TResponseApi | undefined;

export type RpcPeerEventMap = {
	readonly open: Event;
	readonly close: CloseEvent;
	readonly error: Event;
	readonly welcome: CustomEvent<RpcWelcome>;
	readonly request: CustomEvent<RpcRequest>;
	readonly response: CustomEvent<RpcResponse>;
};
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
	) {
		super();
	}

	public static readonly MessageSchema = RpcMessageSchema;
	public static readonly Errors = {
		InvalidMessageFormat: new Error("Invalid message format"),
		InvalidRequestData: new Error("Invalid request data"),
		InvalidResponseData: new Error("Invalid response data"),
		RequestTimedOut: new Error("Request timed out"),
		ConnectionClosed: new Error("Connection closed"),
		CloseTimedOut: new Error("Close timed out"),
	} as const;

	public static ResponseEvent<const TRpcResponse extends RpcResponse>(
		detail: TRpcResponse,
	): CustomEvent<TRpcResponse> {
		return new CustomEvent("response", { detail });
	}

	public static RequestEvent<const TRpcRequest extends RpcRequest>(
		detail: TRpcRequest,
	): CustomEvent<TRpcRequest> {
		return new CustomEvent("request", { detail });
	}

	public static WelcomeEvent<const TRpcWelcome extends RpcWelcome>(
		detail: TRpcWelcome,
	): CustomEvent<TRpcWelcome> {
		return new CustomEvent("welcome", { detail });
	}

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
		const peer = new RpcPeer<
			TRequestSchema,
			TResponseSchema,
			TRequestApi,
			TResponseApi,
			TClientId,
			TName,
			TUrl
		>(
			options.url,
			options.name ?? ("RpcPeer" as TName),
			options.clientId ?? undefined,
			options.pendingPromises ?? new Map(),
			options.retrySocket ?? RetrySocket.FromUrl(options.url),
			options.requestSchema ?? undefined,
			options.responseSchema ?? undefined,
		);

		peer.retrySocket.addEventListener("message", (ev) =>
			peer.handleMessage(ev as MessageEvent),
		);
		// Forward events from RetrySocket to RpcPeer's EventTarget
		// Note: We create new Event objects instead of reusing the same ones
		// because events cannot be re-dispatched once they're being dispatched
		peer.retrySocket.addEventListener("open", (ev) => {
			peer.dispatchEvent(new Event(ev.type));
		});
		peer.retrySocket.addEventListener("close", (ev: Event): void => {
			const actual = ev as CloseEvent;
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

	public static Timeouts = {
		Request: 4_000,
		Close: 4_000,
		Welcome: 4_000,
	} as const;

	async dispose(): Promise<void> {
		console.time("[Peer] Dispose");
		console.debug("[Peer] Dispose");
		await this.close();

		await this.retrySocket.dispose();

		// Reject all pending promises before closing
		for (const item of this.pendingPromises.values()) {
			global.clearTimeout(item.timer);
			item.reject(RpcPeer.Errors.ConnectionClosed);
		}
		this.pendingPromises.clear();

		console.time("[Peer] Dispose");
	}

	get state(): "closed" | "connecting" | "open" | "closing" {
		const states = ["connecting", "open", "closing", "closed"] as const;
		return states[this.retrySocket.readyState] ?? "closed";
	}

	welcomed(): boolean {
		return this.clientId !== undefined;
	}

	waitForWelcome(timeout = RpcPeer.Timeouts.Welcome): Promise<TClientId> {
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
				global.clearTimeout(timer);
				resolve(ev.detail.clientId);
			};

			const timer = global.setTimeout(() => {
				this.removeEventListener("welcome", welcomeHandler as EventListener);
				reject(RpcPeer.Errors.RequestTimedOut);
			}, timeout);

			this.addEventListener("welcome", welcomeHandler as EventListener, {
				once: true,
			});
		});
	}

	close(
		code: WebSocketCloseCode = WS_CLOSE_NORMAL,
		reason = getCloseCodeDescription(code),
		timeout = RpcPeer.Timeouts.Close,
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
				global.clearTimeout(closeTimeout);
				this.removeEventListener("close", closeHandler);
				console.timeEnd(timeId);
				resolve();
			};

			this.addEventListener("close", closeHandler);

			// Set up timeout to prevent waiting forever
			const closeTimeout = global.setTimeout(() => {
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

	handleMessage(ev: MessageEvent): Success {
		try {
			const json = JSON.parse(ev.data);
			const parsed = RpcMessageSchema.safeParse(json);

			if (!parsed.success) {
				console.warn("[Peer] Invalid message format:", parsed.error);
				return false;
			}

			const message = parsed.data;

			if (message.category === "welcome") {
				this.clientId = message.clientId as TClientId;
				console.debug(`[Peer] Assigned ID: ${this.clientId}`);
				this.dispatchEvent(RpcPeer.WelcomeEvent(message));
				return true;
			}

			if (message.category === "request") {
				// Validation of data payload if schema provided
				if (this.requestSchema !== undefined) {
					const valid = this.requestSchema.safeParse(message.data);
					if (!valid.success) {
						console.debug("[Peer] Invalid request data:", valid.error);
						return false;
					}
				}
				this.dispatchEvent(RpcPeer.RequestEvent(message));
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
							global.clearTimeout(pending.timer);
							this.pendingPromises.delete(message.requestId);
							return false;
						}
					}

					pending.resolve(message);
					global.clearTimeout(pending.timer);
					this.pendingPromises.delete(message.requestId);
				}
			}
		} catch (err) {
			console.debug("[Peer] message error", err);
			return false;
		}
		return true;
	}

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

	request<TResponse = TResponseApi>(
		data: TRequestApi,
		timeout: number = RpcPeer.Timeouts.Request,
	): Promise<RpcResponse<TResponse>> {
		const requestId = crypto.randomUUID();

		const message: RpcRequest<TRequestApi> = {
			category: "request",
			requestId,
			from: this.clientId,
			fromName: this.name,
			data: data,
		};

		const { promise, resolve, reject } =
			Promise.withResolvers<RpcResponse<TResponse>>();

		const timer = global.setTimeout(() => {
			if (this.pendingPromises.has(requestId)) {
				this.pendingPromises.delete(requestId);
				reject(RpcPeer.Errors.RequestTimedOut);
			}
		}, timeout);

		this.pendingPromises.set(requestId, { resolve, reject, timer });

		this.retrySocket.send(JSON.stringify(message));
		return promise;
	}

	call = this.request;

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

	match<
		const THandler extends MatchHandler<
			TRequestApi,
			TResponseApi,
			string
		> = MatchHandler<TRequestApi, TResponseApi, string>,
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
}
