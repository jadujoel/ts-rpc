/** biome-ignore-all lint/style/noNonNullAssertion: safe usage */
/** biome-ignore-all lint/suspicious/noExplicitAny: Explicit */

export type MessageQueueItem = string | ArrayBuffer | Blob | ArrayBufferView;
export type MessageQueue = MessageQueueItem[];
export type OnOpenHandler = ((this: WebSocket, ev: Event) => any) | null;
export type OnMessageHandler =
	| ((this: WebSocket, ev: MessageEvent) => any)
	| null;
export type OnCloseHandler = ((this: WebSocket, ev: CloseEvent) => any) | null;
export type OnErrorHandler = ((this: WebSocket, ev: Event) => any) | null;
export type EventListenerMap = Map<
	string,
	Set<EventListenerOrEventListenerObject>
>;

export interface RetrySocketFromOptions<TUrl extends string = string> {
	/** @default "arraybuffer" */
	readonly binaryType?: BinaryType;
	/** @default new Map() */
	readonly eventListeners?: EventListenerMap;
	/** @default 30_000 */
	readonly maxReconnectInterval?: number;
	/** @default [] */
	readonly messageQueue?: MessageQueue;
	/** @default false */
	readonly isClosedByUser?: boolean;
	/** @default null */
	readonly onclose?: OnCloseHandler;
	/** @default null */
	readonly onerror?: OnErrorHandler;
	/** @default null */
	readonly onmessage?: OnMessageHandler;
	/** @default null */
	readonly onopen?: OnOpenHandler;
	/** @default new WebSocket(url) */
	readonly socket?: WebSocket | null;
	/** * @default 0 */
	readonly reconnectAttempts?: number;
	/** @default 1000 */
	readonly reconnectInterval?: number;
	readonly url: TUrl;
}

export type RetrySocketEventName = "message" | "open" | "close" | "error";

export class RetrySocket<TUrl extends string = string> implements WebSocket {
	public static readonly CONNECTING: 0 = 0;
	public static readonly OPEN: 1 = 1;
	public static readonly CLOSING: 2 = 2;
	public static readonly CLOSED: 3 = 3;
	public static DefaultOptions: Required<RetrySocketFromOptions> = {
		url: "",
		binaryType: "arraybuffer",
		eventListeners: new Map(),
		isClosedByUser: false,
		maxReconnectInterval: 30_000,
		messageQueue: [],
		onclose: null,
		onerror: null,
		onmessage: null,
		onopen: null,
		reconnectAttempts: 0,
		reconnectInterval: 1_000,
		socket: null,
	};

	// Track which events are currently being dispatched to prevent re-entrancy
	private dispatchingEvents = new Set<string>();

	public static SendResult = {
		Sent: 0,
		Queued: 1,
		Failed: 2,
		toString(result: number): "sent" | "queued" | "failed" | "unknown" {
			switch (result) {
				case RetrySocket.SendResult.Sent:
					return "sent";
				case RetrySocket.SendResult.Queued:
					return "queued";
				case RetrySocket.SendResult.Failed:
					return "failed";
				default:
					return "unknown";
			}
		},
	} as const;

	public static readonly Errors = {
		CloseTimeout: new Error("WebSocket close timed out"),
	} as const;

	public static readonly Timeouts = {
		Close: 1_000,
	} as const;

	static FromOptions<TUrl extends string = string>(
		options: RetrySocketFromOptions<TUrl>,
	): RetrySocket<TUrl> {
		const socket = new RetrySocket(
			options.url,
			options.socket ?? null,
			options.reconnectAttempts ?? RetrySocket.DefaultOptions.reconnectAttempts,
			options.reconnectInterval ?? RetrySocket.DefaultOptions.reconnectInterval,
			options.maxReconnectInterval ??
				RetrySocket.DefaultOptions.maxReconnectInterval,
			options.messageQueue ?? [],
			options.eventListeners ?? new Map(),
			options.isClosedByUser ?? RetrySocket.DefaultOptions.isClosedByUser,
			options.binaryType ?? RetrySocket.DefaultOptions.binaryType,
			options.onopen ?? null,
			options.onmessage ?? null,
			options.onclose ?? null,
			options.onerror ?? null,
		);
		socket.connect();
		return socket;
	}

	static FromUrl<TUrl extends string = string>(url: TUrl): RetrySocket<TUrl> {
		const socket = new RetrySocket(url);
		socket.connect();
		return socket;
	}

	public constructor(
		public readonly url: TUrl,
		private socket: WebSocket | null = null,
		private reconnectAttempts = 0,
		private reconnectInterval = 1_000,
		private maxReconnectInterval = 30_000,
		private messageQueue: MessageQueue = [],
		private eventListeners: Map<
			string,
			Map<
				EventListenerOrEventListenerObject,
				boolean | AddEventListenerOptions | undefined
			>
		> = new Map(),
		private isClosedByUser = false,
		private _binaryType: BinaryType = "arraybuffer",
		public onopen: OnOpenHandler = null,
		public onmessage: OnMessageHandler = null,
		public onclose: OnCloseHandler = null,
		public onerror: OnErrorHandler = null,
		public readonly CONNECTING: 0 = RetrySocket.CONNECTING,
		public readonly OPEN: 1 = RetrySocket.OPEN,
		public readonly CLOSING: 2 = RetrySocket.CLOSING,
		public readonly CLOSED: 3 = RetrySocket.CLOSED,
	) {}

	private connect(): void {
		if (this.isClosedByUser) {
			return;
		}

		this.socket = new WebSocket(this.url);
		this.socket.binaryType = this._binaryType;

		this.socket.onopen = (event) => {
			if (this.isClosedByUser) {
				return;
			}
			this.reconnectAttempts = 0;
			this.flushMessageQueue();
			if (this.onopen) {
				this.onopen.call(this.socket!, event);
			}
			this.dispatchEvent(new Event("open"));
		};

		this.socket.onmessage = (event) => {
			if (this.isClosedByUser) {
				return;
			}
			if (this.onmessage) {
				this.onmessage.call(this.socket!, event);
			}
			this.dispatchEvent(event);
		};

		this.socket.onclose = (event) => {
			if (this.isClosedByUser) {
				return;
			}
			if (this.onclose) {
				this.onclose.call(this.socket!, event);
			}
			this.scheduleReconnect();
			this.dispatchEvent(
				new CloseEvent("close", {
					code: event.code,
					reason: event.reason,
					wasClean: event.wasClean,
				}),
			);
		};

		this.socket.onerror = (event) => {
			if (this.isClosedByUser) {
				return;
			}
			if (this.onerror) {
				this.onerror.call(this.socket!, event);
			}
			this.dispatchEvent(new Event("error", event));
		};
	}

	private scheduleReconnect(): void {
		if (this.isClosedByUser) {
			return;
		}
		const delay = Math.min(
			this.reconnectInterval * 2 ** this.reconnectAttempts,
			this.maxReconnectInterval,
		);
		this.reconnectAttempts++;
		console.debug(
			`Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`,
		);
		global.setTimeout(() => this.connect(), delay);
	}

	private flushMessageQueue(): void {
		if (this.isClosedByUser) {
			return;
		}
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			return;
		}
		while (this.messageQueue.length > 0) {
			const data = this.messageQueue.shift();
			if (data !== undefined) {
				this.socket.send(data);
			}
		}
	}

	public send(
		data: string | ArrayBuffer | Blob | ArrayBufferView,
	):
		| typeof RetrySocket.SendResult.Failed
		| typeof RetrySocket.SendResult.Queued
		| typeof RetrySocket.SendResult.Sent {
		if (this.isClosedByUser) {
			return RetrySocket.SendResult.Failed;
		}
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(data);
			return RetrySocket.SendResult.Sent;
		}
		this.messageQueue.push(data);
		return RetrySocket.SendResult.Queued;
	}

	public async dispose(): Promise<void> {
		console.time("RetrySocket Dispose");
		try {
			await this.close();
			this.socket = null;
			this.messageQueue = [];
			this.eventListeners.clear();
			this.onclose = null;
			this.onerror = null;
			this.onmessage = null;
			this.onopen = null;
		} catch (error) {
			console.debug("Error disposing RetrySocket:", error);
		}
		console.timeEnd("RetrySocket Dispose");
	}

	public close(
		code?: number,
		reason?: string,
		timeout = RetrySocket.Timeouts.Close,
	): Promise<void> {
		if (this.isClosedByUser) {
			console.debug("[RS] Socket already closed by user");
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			this.isClosedByUser = true;
			if (!this.socket || this.socket.readyState === this.socket.CLOSED) {
				console.debug("[RS] Socket already closed or not initialized");
				resolve();
				return;
			}

			console.time("CloseHandler");

			const closeHandler = (event: CloseEvent): void => {
				console.timeEnd("CloseHandler");

				console.debug("[RS] Close Handler");
				global.clearTimeout(timeoutId);
				this.socket?.removeEventListener("close", closeHandler);
				this.dispatchEvent(event);
				resolve();
			};

			const timeoutHandler = (): void => {
				console.debug("[RS] Close Timeout Handler");
				this.socket?.removeEventListener("close", closeHandler);
				reject(RetrySocket.Errors.CloseTimeout);
			};

			const timeoutId = global.setTimeout(timeoutHandler, timeout);
			this.socket.addEventListener("close", closeHandler, { once: true });
			console.debug(`[RS] Close socket with state ${this.socket.readyState}`);
			this.socket.close(code, reason);
		});
	}

	public addEventListener(
		type: RetrySocketEventName,
		listener: EventListener,
		options?: boolean | AddEventListenerOptions,
	): void {
		console.debug(`[RS] Add event listener ${type}`);
		if (this.isClosedByUser && type !== "close") {
			console.debug(`[RS] Failed to add listener (closed by user)`);
			return;
		}
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, new Map());
		}
		this.eventListeners.get(type)!.set(listener, options);
	}

	public removeEventListener(
		type: RetrySocketEventName | (string & {}),
		listener: EventListenerOrEventListenerObject,
		_options?: boolean | EventListenerOptions,
	): void {
		console.debug(`[RS] Remove event listener ${type}`);
		const listeners = this.eventListeners.get(type);
		if (listeners) {
			listeners.delete(listener);
		}
	}

	public dispatchEvent(event: CloseEvent | Event): boolean {
		console.debug(`[RS] Dispatch Event ${event.type}`);

		// Prevent re-entrant dispatch of the same event type
		if (this.dispatchingEvents.has(event.type)) {
			console.warn(
				`[RS] Event "${event.type}" is already being dispatched, skipping`,
			);
			return false;
		}

		const listenerMap = this.eventListeners.get(event.type);
		if (!listenerMap) {
			// Per EventTarget spec, return true if no listeners canceled it (assuming no cancelable logic implemented here properly yet)
			return true;
		}

		// Mark this event type as currently dispatching
		this.dispatchingEvents.add(event.type);

		try {
			let result = true;
			// Iterate over a copy to safely handle modifications during iteration
			for (const [listener, options] of Array.from(listenerMap.entries())) {
				if (typeof listener === "function") {
					listener.call(this, event);
				} else {
					listener.handleEvent(event);
				}
				if (event.defaultPrevented) {
					result = false;
				}
				if (typeof options === "object" && options.once) {
					this.removeEventListener(event.type, listener);
				}
			}
			return result;
		} finally {
			// Always remove the dispatching flag, even if an error occurs
			this.dispatchingEvents.delete(event.type);
		}
	}

	// Getters for proxying properties if needed
	public get readyState() {
		return this.socket ? this.socket.readyState : WebSocket.CLOSED;
	}

	public get binaryType(): BinaryType {
		return this.socket ? this.socket.binaryType : this._binaryType;
	}

	public set binaryType(value: BinaryType) {
		if (this.isClosedByUser) {
			return;
		}
		this._binaryType = value;
		if (this.socket) {
			this.socket.binaryType = value;
		}
	}

	public get bufferedAmount(): number {
		return this.socket ? this.socket.bufferedAmount : 0;
	}

	public get extensions(): string {
		return this.socket ? this.socket.extensions : "";
	}

	public get protocol(): string {
		return this.socket ? this.socket.protocol : "";
	}
}
