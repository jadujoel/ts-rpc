/** biome-ignore-all lint/style/noNonNullAssertion: safe usage */
/** biome-ignore-all lint/suspicious/noExplicitAny: Explicit */

/** Supported message types that can be queued for sending. */
export type MessageQueueItem = string | ArrayBuffer | Blob | ArrayBufferView;
/** Queue of messages waiting to be sent when connection is established. */
export type MessageQueue = MessageQueueItem[];
/** WebSocket open event handler function type. */
export type OnOpenHandler = ((this: WebSocket, ev: Event) => any) | null;
/** WebSocket message event handler function type. */
export type OnMessageHandler =
	| ((this: WebSocket, ev: MessageEvent) => any)
	| null;
/** WebSocket close event handler function type. */
export type OnCloseHandler = ((this: WebSocket, ev: CloseEvent) => any) | null;
/** WebSocket error event handler function type. */
export type OnErrorHandler = ((this: WebSocket, ev: Event) => any) | null;
/** Map of event names to their registered listeners. */
export type EventListenerMap<
	TEventNames extends string = string,
	TSet extends
		Set<EventListenerOrEventListenerObject> = Set<EventListenerOrEventListenerObject>,
> = Map<TEventNames, TSet>;

/**
 * Configuration options for creating a RetrySocket instance.
 * @template TUrl - The WebSocket URL string type
 */
export interface RetrySocketFromOptions<TUrl extends string = string> {
	/** Binary data type for WebSocket messages. Default: "arraybuffer" */
	readonly binaryType?: BinaryType;
	/** Map of event listeners to register. Default: new Map() */
	readonly eventListeners?: EventListenerMap;
	/** Maximum delay between reconnection attempts in milliseconds. Default: 30000 (30 seconds) */
	readonly maxReconnectInterval?: number;
	/** Queue of messages to send when connection is established. Default: [] */
	readonly messageQueue?: MessageQueue;
	/** Whether the socket was closed intentionally by the user (prevents auto-reconnect). Default: false */
	readonly isClosedByUser?: boolean;
	/** Handler for close events. Default: null */
	readonly onclose?: OnCloseHandler;
	/** Handler for error events. Default: null */
	readonly onerror?: OnErrorHandler;
	/** Handler for message events. Default: null */
	readonly onmessage?: OnMessageHandler;
	/** Handler for open events. Default: null */
	readonly onopen?: OnOpenHandler;
	/** Existing WebSocket instance to wrap. If not provided, a new one will be created. Default: null */
	readonly socket?: WebSocket | null;
	/** Current count of reconnection attempts. Used for exponential backoff. Default: 0 */
	readonly reconnectAttempts?: number;
	/** Initial delay between reconnection attempts in milliseconds. Grows exponentially with each attempt. Default: 1000 (1 second) */
	readonly reconnectInterval?: number;
	/** WebSocket URL to connect to. Must be ws:// or wss:// protocol. */
	readonly url: TUrl;
}

/** Event names that RetrySocket can emit. */
export type RetrySocketEventName = "message" | "open" | "close" | "error";
/**
 * WebSocket readyState values.
 * Uses 0, 1, 2, 3 to match WebSocket constants for easier integration and debugging.
 */
export type WebSocketReadyStateValue =
	| typeof WebSocket.CONNECTING
	| typeof WebSocket.OPEN
	| typeof WebSocket.CLOSING
	| typeof WebSocket.CLOSED;

/**
 * WebSocket wrapper with automatic reconnection and message queueing.
 *
 * Automatically reconnects on connection loss using exponential backoff.
 * Queues messages sent while disconnected and flushes them upon reconnection.
 * Implements the WebSocket interface for drop-in compatibility.
 *
 * Key features:
 * - Exponential backoff: Starts at `reconnectInterval`, doubles each attempt up to `maxReconnectInterval`
 * - Message queueing: Messages sent while disconnected are queued and flushed on reconnect
 * - Event re-entrancy prevention: Prevents duplicate event dispatches during reconnection
 * - Session persistence: Maintains state across reconnections
 *
 * @template TUrl - The WebSocket URL string type
 *
 * @example
 * ```typescript
 * // Simple usage
 * const socket = RetrySocket.FromUrl('ws://localhost:8080');
 * socket.addEventListener('open', () => console.log('Connected'));
 * socket.addEventListener('message', (ev) => console.log('Received:', ev.data));
 * socket.send('Hello');
 *
 * // Advanced usage with custom options
 * const socket = RetrySocket.FromOptions({
 *   url: 'ws://localhost:8080',
 *   reconnectInterval: 2000,  // Start with 2 second delay
 *   maxReconnectInterval: 60000,  // Cap at 60 seconds
 *   onopen: () => console.log('Connected'),
 *   onerror: (err) => console.error('Error:', err)
 * });
 * ```
 */
export class RetrySocket<TUrl extends string = string> implements WebSocket {
	public static readonly CONNECTING: 0 = 0;
	public static readonly OPEN: 1 = 1;
	public static readonly CLOSING: 2 = 2;
	public static readonly CLOSED: 3 = 3;
	/** Default configuration options for RetrySocket instances. */
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

	/** Tracks which event types are currently being dispatched to prevent re-entrancy. */
	private dispatchingEvents = new Set<string>();

	/** Result codes for send operations. */
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

	/** Standard error instances used throughout RetrySocket. */
	public static readonly Errors = {
		CloseTimeout: new Error("WebSocket close timed out"),
	} as const;

	/** Default timeout values for various operations in milliseconds. */
	public static readonly Timeouts = {
		Close: 1_000,
	} as const;

	/**
	 * Creates a RetrySocket instance from configuration options.
	 * Immediately begins connection attempt.
	 *
	 * @template TUrl - The WebSocket URL string type
	 * @param options - Configuration options
	 * @returns A connected RetrySocket instance
	 *
	 * @example
	 * ```typescript
	 * const socket = RetrySocket.FromOptions({
	 *   url: 'ws://localhost:8080',
	 *   reconnectInterval: 2000,
	 *   maxReconnectInterval: 60000
	 * });
	 * ```
	 */
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

	/**
	 * Creates a RetrySocket instance from a URL with default options.
	 * Immediately begins connection attempt.
	 *
	 * @template TUrl - The WebSocket URL string type
	 * @param url - WebSocket URL to connect to
	 * @returns A connected RetrySocket instance
	 *
	 * @example
	 * ```typescript
	 * const socket = RetrySocket.FromUrl('ws://localhost:8080');
	 * ```
	 */
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

	/**
	 * Schedules a reconnection attempt using exponential backoff.
	 * Delay formula: min(reconnectInterval * 2^reconnectAttempts, maxReconnectInterval)
	 * @private
	 */
	private scheduleReconnect(): void {
		if (this.isClosedByUser) {
			return;
		}
		// Exponential backoff: delay = initialInterval * 2^attempts, capped at maxInterval
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

	/**
	 * Flushes all queued messages to the WebSocket.
	 * Only sends if connection is open.
	 * @private
	 */
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

	/**
	 * Sends data over the WebSocket connection.
	 * If connection is not open, queues the message for later delivery.
	 *
	 * @param data - The data to send
	 * @returns Result code indicating if message was sent, queued, or failed
	 *
	 * @example
	 * ```typescript
	 * const result = socket.send('Hello');
	 * if (result === RetrySocket.SendResult.Sent) {
	 *   console.log('Sent immediately');
	 * } else if (result === RetrySocket.SendResult.Queued) {
	 *   console.log('Queued for later');
	 * }
	 * ```
	 */
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

	/**
	 * Disposes of the socket, closing the connection and clearing all resources.
	 * Clears message queue, event listeners, and all handlers.
	 *
	 * @returns Promise that resolves when disposal is complete
	 *
	 * @example
	 * ```typescript
	 * await socket.dispose();
	 * // Socket is now fully cleaned up
	 * ```
	 */
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

	/**
	 * Closes the WebSocket connection gracefully.
	 * Sets `isClosedByUser` flag to prevent automatic reconnection.
	 *
	 * @param code - WebSocket close code
	 * @param reason - Human-readable close reason
	 * @param timeout - Maximum time to wait for close event in milliseconds. Default: 1000 (1 second)
	 * @returns Promise that resolves when connection is closed
	 * @throws {RetrySocket.Errors.CloseTimeout} If close doesn't complete within timeout
	 *
	 * @example
	 * ```typescript
	 * await socket.close(1000, 'Normal closure');
	 * ```
	 */
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

	/**
	 * Registers an event listener for the specified event type.
	 * Listeners are preserved across reconnections.
	 *
	 * @param type - Event type to listen for
	 * @param listener - Event listener function or object
	 * @param options - Listener options (capture, once, passive)
	 *
	 * @example
	 * ```typescript
	 * socket.addEventListener('message', (ev) => {
	 *   console.log('Received:', ev.data);
	 * });
	 * ```
	 */
	public addEventListener(
		type: RetrySocketEventName | (string & {}),
		listener: EventListener | EventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (this.isClosedByUser && type !== "close") {
			console.debug(`[RS] Failed to add listener (closed by user)`);
			return;
		}
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, new Map());
		}
		this.eventListeners.get(type)!.set(listener, options);
	}

	/**
	 * Removes a previously registered event listener.
	 *
	 * @param type - Event type
	 * @param listener - Event listener to remove
	 * @param _options - Unused, kept for interface compatibility
	 */
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

	/**
	 * Dispatches an event to all registered listeners.
	 * Prevents re-entrant dispatches of the same event type.
	 *
	 * @param event - Event to dispatch
	 * @returns True if event was dispatched successfully
	 * @internal
	 */
	public dispatchEvent(event: CloseEvent | Event): boolean {
		// Prevent re-entrant dispatch: Don't dispatch same event type while already dispatching it
		// This prevents infinite loops during reconnection when events trigger actions that cause more events
		if (this.dispatchingEvents.has(event.type)) {
			console.debug(
				`[RS] Event "${event.type}" is already being dispatched, skipping`,
			);
			return false;
		}

		const listenerMap = this.eventListeners.get(event.type);
		if (!listenerMap) {
			// No listeners registered for this event type
			return true;
		}

		// Mark this event type as currently dispatching
		this.dispatchingEvents.add(event.type);

		try {
			let result = true;
			// Iterate over a copy to safely handle listener modifications during iteration
			for (const [listener, options] of Array.from(listenerMap.entries())) {
				if (typeof listener === "function") {
					listener.call(this, event);
				} else {
					listener.handleEvent(event);
				}
				if (event.defaultPrevented) {
					result = false;
				}
				// Remove listener if 'once' option was set
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

	/**
	 * Gets the current connection state.
	 * @returns WebSocket readyState value (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)
	 */
	public get readyState(): WebSocketReadyStateValue {
		return this.socket
			? (this.socket.readyState as WebSocketReadyStateValue)
			: WebSocket.CLOSED;
	}

	/** Gets the binary data type for WebSocket messages. */
	public get binaryType(): BinaryType {
		return this.socket ? this.socket.binaryType : this._binaryType;
	}

	/** Sets the binary data type for WebSocket messages. */
	public set binaryType(value: BinaryType) {
		if (this.isClosedByUser) {
			return;
		}
		this._binaryType = value;
		if (this.socket) {
			this.socket.binaryType = value;
		}
	}

	/** Gets the number of bytes queued but not yet sent. */
	public get bufferedAmount(): number {
		return this.socket ? this.socket.bufferedAmount : 0;
	}

	/** Gets the extensions selected by the server. */
	public get extensions(): string {
		return this.socket ? this.socket.extensions : "";
	}

	/** Gets the subprotocol selected by the server. */
	public get protocol(): string {
		return this.socket ? this.socket.protocol : "";
	}
}
