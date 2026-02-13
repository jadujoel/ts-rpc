import { z } from "zod";
import { RetrySocket } from "./RetrySocket.ts";

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
		to: z.string().optional(),
		data: z.unknown(),
	}),
	z.object({
		category: z.literal("response"),
		requestId: z.string(),
		from: z.string().optional(),
		to: z.string().optional(),
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
	readonly to?: TTo;
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
	readonly to?: TTo;
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
	TUrl extends string = string,
> {
	readonly url: TUrl;
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

export class RpcPeer<
	TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
	TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
	TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
	TClientId extends string = string,
	TUrl extends string = string,
> extends EventTarget {
	private constructor(
		public readonly url: TUrl,
		public clientId: TClientId | undefined,
		public readonly pendingPromises: PendingPromiseMap = new Map(),
		public readonly retrySocket: RetrySocket,
		public readonly requestSchema: TRequestSchema | undefined,
		public readonly responseSchema: TResponseSchema | undefined,
	) {
		super();
	}

	public static FromOptions<
		TRequestSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
		TResponseSchema extends z.Schema<ExplicitAny> = z.Schema<ExplicitAny>,
		TRequestApi extends ExplicitAny = z.infer<TRequestSchema>,
		TResponseApi extends ExplicitAny = z.infer<TResponseSchema>,
		TClientId extends string = string,
		TUrl extends string = string,
	>(
		options: RpcPeerFromOptions<
			TRequestSchema,
			TResponseSchema,
			TRequestApi,
			TResponseApi,
			TClientId,
			TUrl
		>,
	): RpcPeer<
		TRequestSchema,
		TResponseSchema,
		TRequestApi,
		TResponseApi,
		TClientId,
		TUrl
	> {
		const peer = new RpcPeer<
			TRequestSchema,
			TResponseSchema,
			TRequestApi,
			TResponseApi,
			TClientId,
			TUrl
		>(
			options.url,
			options.clientId ?? undefined,
			options.pendingPromises ?? new Map(),
			options.retrySocket ?? RetrySocket.FromUrl(options.url),
			options.requestSchema ?? undefined,
			options.responseSchema ?? undefined,
		);

		peer.retrySocket.addEventListener("message", (ev) =>
			peer.handleMessage(ev as MessageEvent),
		);
		peer.retrySocket.addEventListener("open", (ev) => peer.dispatchEvent(ev));
		peer.retrySocket.addEventListener("close", (ev) => peer.dispatchEvent(ev));
		peer.retrySocket.addEventListener("error", (ev) => peer.dispatchEvent(ev));
		return peer;
	}

	get state(): "closed" | "connecting" | "open" | "closing" {
		const states = ["connecting", "open", "closing", "closed"] as const;
		return states[this.retrySocket.readyState] ?? "closed";
	}

	welcomed(): boolean {
		return this.clientId !== undefined;
	}

	waitForWelcome(timeout = 10_000): Promise<TClientId> {
		if (this.clientId !== undefined) {
			return Promise.resolve(this.clientId);
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.removeEventListener("welcome", welcomeHandler);
				reject(new Error("Welcome Timed Out"));
			}, timeout);

			const welcomeHandler = (ev: Event) => {
				const customEv = ev as CustomEvent<{ clientId: TClientId }>;
				this.removeEventListener("welcome", welcomeHandler);
				clearTimeout(timer);
				resolve(customEv.detail.clientId);
			};
			this.addEventListener("welcome", welcomeHandler);
		});
	}

	close(code?: number, reason?: string): void {
		this.retrySocket.close(code, reason);
	}

	handleMessage(ev: MessageEvent): Success {
		try {
			const json = JSON.parse(ev.data);
			const parsed = RpcMessageSchema.safeParse(json);

			if (!parsed.success) {
				console.warn("[Socket] Invalid message format:", parsed.error);
				return false;
			}

			const message = parsed.data;

			if (message.category === "welcome") {
				this.clientId = message.clientId as TClientId;
				console.debug(`[Socket] Assigned ID: ${this.clientId}`);
				this.dispatchEvent(new CustomEvent("welcome", { detail: message }));
				return true;
			}

			if (message.category === "request") {
				// Validation of data payload if schema provided
				if (this.requestSchema !== undefined) {
					const valid = this.requestSchema.safeParse(message.data);
					if (!valid.success) {
						console.debug("[Socket] Invalid request data:", valid.error);
						return false;
					}
				}
				this.dispatchEvent(new CustomEvent("request", { detail: message }));
			} else if (message.category === "response") {
				const pending = this.pendingPromises.get(message.requestId);
				if (pending) {
					if (this.responseSchema !== undefined) {
						const valid = this.responseSchema.safeParse(message.data);
						if (!valid.success) {
							pending.reject(
								new Error(`Invalid response schema: ${valid.error.message}`),
							);
							clearTimeout(pending.timer);
							this.pendingPromises.delete(message.requestId);
							return false;
						}
					}

					pending.resolve(message);
					clearTimeout(pending.timer);
					this.pendingPromises.delete(message.requestId);
				}
			}
		} catch (err) {
			console.debug("[Socket] message error", err);
			return false;
		}
		return true;
	}

	send(data: TRequestApi): void {
		const message: RpcRequest<TRequestApi> = {
			category: "request",
			requestId: crypto.randomUUID(),
			from: this.clientId,
			data: data,
		};
		this.retrySocket.send(JSON.stringify(message));
	}

	request<TResponse = TResponseApi>(
		data: TRequestApi,
		timeout = 10_000,
	): Promise<RpcResponse<TResponse>> {
		const requestId = crypto.randomUUID();

		const message: RpcRequest<TRequestApi> = {
			category: "request",
			requestId,
			from: this.clientId,
			data: data,
		};

		const { promise, resolve, reject } =
			Promise.withResolvers<RpcResponse<TResponse>>();

		const timer = setTimeout(() => {
			if (this.pendingPromises.has(requestId)) {
				this.pendingPromises.delete(requestId);
				reject(new Error("Request Timed Out"));
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
			to: originalRequest.from,
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
				console.error("[Socket] Match handler error", err);
			}
		});
	}
}
