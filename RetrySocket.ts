export type MessageQueueItem = string | ArrayBuffer | Blob | ArrayBufferView;
export type MessageQueue = MessageQueueItem[];
export type OnOpenHandler = ((this: WebSocket, ev: Event) => any) | null;
export type OnMessageHandler = ((this: WebSocket, ev: MessageEvent) => any) | null;
export type OnCloseHandler = ((this: WebSocket, ev: CloseEvent) => any) | null;
export type OnErrorHandler = ((this: WebSocket, ev: Event) => any) | null;
export type EventListenerMap = Map<string, Set<EventListenerOrEventListenerObject>>;

export interface RetrySocketFromOptions {
  /** @default "arraybuffer" */
  readonly binaryType?: BinaryType;
  /** @default new Map() */
  readonly eventListeners?: EventListenerMap
  /** @default 30_000 */
  readonly maxReconnectInterval?: number;
  /** @default [] */
  readonly messageQueue: MessageQueue;
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
  /** @default "" */
  readonly url?: string;
}


export class RetrySocket implements WebSocket {
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

  static FromOptions(options: RetrySocketFromOptions): RetrySocket {
    const socket = new RetrySocket(
      options.url ?? RetrySocket.DefaultOptions.url,
      options.socket ?? null,
      options.reconnectAttempts ?? RetrySocket.DefaultOptions.reconnectAttempts,
      options.reconnectInterval ?? RetrySocket.DefaultOptions.reconnectInterval,
      options.maxReconnectInterval ?? RetrySocket.DefaultOptions.maxReconnectInterval,
      options.messageQueue ?? [],
      options.eventListeners ?? new Map(),
      options.isClosedByUser ?? RetrySocket.DefaultOptions.isClosedByUser,
      options.binaryType ?? RetrySocket.DefaultOptions.binaryType,
      options.onopen ?? null,
      options.onmessage ?? null,
      options.onclose ?? null,
      options.onerror ?? null
    );
    socket.connect();
    return socket;
  }

  static FromUrl(url: string): RetrySocket {
    const socket = new RetrySocket(url);
    socket.connect();
    return socket;
  }

  public constructor(
    public readonly url: string,
    private socket: WebSocket | null = null,
    private reconnectAttempts = 0,
    private reconnectInterval = 1_000,
    private maxReconnectInterval = 30_000,
    private messageQueue: MessageQueue = [],
    private eventListeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map(),
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
  ) {
  }

  private connect() {
    if (this.isClosedByUser) return;

    this.socket = new WebSocket(this.url);
    this.socket.binaryType = this._binaryType;

    this.socket.onopen = (event) => {
      this.reconnectAttempts = 0;
      this.flushMessageQueue();
      if (this.onopen) this.onopen.call(this.socket!, event);
      this.dispatchEvent(new Event('open'));
    };

    this.socket.onmessage = (event) => {
      if (this.onmessage) this.onmessage.call(this.socket!, event);
      this.dispatchEvent(event);
    };

    this.socket.onclose = (event) => {
       if (this.onclose && this.isClosedByUser) {
          this.onclose.call(this.socket!, event);
       }
       if (!this.isClosedByUser) {
         this.scheduleReconnect();
       }
       this.dispatchEvent(new CloseEvent('close', event));
    };

    this.socket.onerror = (event) => {
      if (this.onerror) this.onerror.call(this.socket!, event);
      this.dispatchEvent(new Event('error', event));
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectInterval
    );
    this.reconnectAttempts++;
    console.log(`Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  private flushMessageQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    while (this.messageQueue.length > 0) {
      const data = this.messageQueue.shift();
      if (data !== undefined) {
        this.socket.send(data);
      }
    }
  }

  public send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.messageQueue.push(data);
    }
  }

  public close(code?: number, reason?: string) {
    this.isClosedByUser = true;
    if (this.socket) {
      this.socket.close(code, reason);
    }
  }

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
     if (this.eventListeners.has(type)) {
       this.eventListeners.get(type)!.delete(listener);
     }
  }

  public dispatchEvent(event: Event): boolean {
    const listeners = this.eventListeners.get(event.type);
    if (!listeners) {
      return true; // Per EventTarget spec, return true if no listeners canceled it (assuming no cancelable logic implemented here properly yet)
    }
    let result = true;
    for (const listener of listeners) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
      if (event.defaultPrevented) {
        result = false;
      }
    }
    return result;
  }

  // Getters for proxying properties if needed
  public get readyState() {
    return this.socket ? this.socket.readyState : WebSocket.CLOSED;
  }

  public get binaryType(): BinaryType {
      return this.socket ? this.socket.binaryType : this._binaryType;
  }

  public set binaryType(value: BinaryType) {
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
