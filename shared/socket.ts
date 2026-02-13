import { z } from "zod";

// Polyfill for Promise.withResolvers
if (typeof Promise.withResolvers === 'undefined') {
  // @ts-ignore
  Promise.withResolvers = function () {
    let resolve, reject;
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

export type RpcRequest<TData = unknown> = {
  readonly category: "request";
  readonly requestId: string;
  readonly from?: string;
  readonly to?: string;
  readonly data: TData;
};

export type RpcResponse<TData = unknown> = {
  readonly category: "response";
  readonly requestId: string;
  readonly from?: string;
  readonly to?: string;
  readonly data: TData;
};

export type RpcWelcome = {
  readonly category: "welcome";
  readonly clientId: string;
};

export type RpcApi<TReq, TRes> = RpcRequest<TReq> | RpcResponse<TRes> | RpcWelcome;

export class Socket<TRequestApi, TResponseApi> extends EventTarget {
  private _ws: WebSocket | undefined;
  private _clientId: string | undefined;
  private _pendingPromises = new Map<
    string,
    { resolve: (data: any) => void; reject: (err: any) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private _reconnectAttempts = 0;
  private _forcedClose = false;

  public state: "closed" | "connecting" | "open" = "closed";

  constructor(
    public readonly url: string,
    public readonly options: {
      requestSchema?: z.Schema<TRequestApi>,
      responseSchema?: z.Schema<TResponseApi>
    } = {}) {
    super();
  }

  async open(): Promise<WebSocket> {
    if (this._ws?.readyState === WebSocket.OPEN) return this._ws;
    if (this._ws?.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve, reject) => {
            const tempListener = () => {
                if (this._ws?.readyState === WebSocket.OPEN) {
                     this._ws?.removeEventListener("close", closeListener);
                     resolve(this._ws!);
                }
            };
            const closeListener = () => {
                this._ws?.removeEventListener("open", tempListener);
                reject(new Error("Socket closed before open"));
            }
            this._ws?.addEventListener("open", tempListener, { once: true });
            this._ws?.addEventListener("close", closeListener, { once: true });
        });
    }

    this.state = "connecting";
    this.dispatchEvent(new Event("statechange"));

    return new Promise<WebSocket>((resolve) => {
      const connect = () => {
        try {
          const ws = new WebSocket(this.url);
          this._ws = ws;

          ws.addEventListener("open", () => {
            this.state = "open";
            this._reconnectAttempts = 0;
            this.dispatchEvent(new Event("statechange"));
            this.dispatchEvent(new Event("open"));
            resolve(ws);
          });

          ws.addEventListener("message", (ev) => this._handleMessage(ev));

          ws.addEventListener("close", (ev) => {
            this.state = "closed";
            this._ws = undefined;
            this.dispatchEvent(new Event("statechange"));
            this.dispatchEvent(new Event("close"));

            if (!this._forcedClose) {
              const timeout = Math.min(1000 * 2 ** this._reconnectAttempts, 30000);
              console.log(`[Socket] Reconnecting in ${timeout}ms...`);
              this._reconnectAttempts++;
              setTimeout(connect, timeout);
            }
          });

          ws.addEventListener("error", (ev) => {
            // console.error("[Socket] Error:", ev);
            // Close handler will trigger reconnect
          });
        } catch (err) {
             console.error("[Socket] Connection failed instantly", err);
             const timeout = Math.min(1000 * 2 ** this._reconnectAttempts, 30000);
             this._reconnectAttempts++;
             setTimeout(connect, timeout);
        }
      };
      connect();
    });
  }

  close() {
    this._forcedClose = true;
    this._ws?.close();
  }

  private _handleMessage(ev: MessageEvent) {
    try {
      const json = JSON.parse(ev.data);
      const parsed = RpcMessageSchema.safeParse(json);

      if (!parsed.success) {
        // console.warn("[Socket] Invalid message format:", parsed.error);
        return;
      }

      const message = parsed.data;

      if (message.category === "welcome") {
        this._clientId = message.clientId;
        // console.log(`[Socket] Assigned ID: ${this._clientId}`);
        this.dispatchEvent(new CustomEvent("welcome", { detail: message }));
        return;
      }

      if (message.category === "request") {
        // Validation of data payload if schema provided
        if (this.options.requestSchema) {
            const valid = this.options.requestSchema.safeParse(message.data);
            if (!valid.success) {
                console.error("[Socket] Invalid request data:", valid.error);
                return;
            }
        }
        this.dispatchEvent(new CustomEvent("request", { detail: message }));
      } else if (message.category === "response") {
        const pending = this._pendingPromises.get(message.requestId);
        if (pending) {
            if (this.options.responseSchema) {
                const valid = this.options.responseSchema.safeParse(message.data);
                if (!valid.success) {
                    pending.reject(new Error(`Invalid response schema: ${valid.error.message}`));
                    clearTimeout(pending.timer);
                    this._pendingPromises.delete(message.requestId);
                    return;
                }
            }

            pending.resolve(message);
            clearTimeout(pending.timer);
            this._pendingPromises.delete(message.requestId);
        }
      }
    } catch (err) {
      console.error("[Socket] message error", err);
    }
  }

  async send(data: TRequestApi): Promise<void> {
    const ws = await this.open();
    const message: RpcRequest<TRequestApi> = {
      category: "request",
      requestId: crypto.randomUUID(),
      from: this._clientId,
      data: data,
    };
    ws.send(JSON.stringify(message));
  }

  async request<TResponse = TResponseApi>(data: TRequestApi, timeout = 10000): Promise<RpcResponse<TResponse>> {
    const ws = await this.open();
    const requestId = crypto.randomUUID();

    const message: RpcRequest<TRequestApi> = {
      category: "request",
      requestId,
      from: this._clientId,
      data: data,
    };

    const { promise, resolve, reject } = Promise.withResolvers<RpcResponse<TResponse>>();

    const timer = setTimeout(() => {
        if (this._pendingPromises.has(requestId)) {
            this._pendingPromises.delete(requestId);
            reject(new Error("Request Timed Out"));
        }
    }, timeout);

    this._pendingPromises.set(requestId, { resolve, reject, timer });

    ws.send(JSON.stringify(message));
    return promise;
  }

  call = this.request;

  async respondTo(originalRequest: RpcRequest<TRequestApi>, data: TResponseApi) {
     const ws = await this.open();
     const message: RpcResponse<TResponseApi> = {
         category: "response",
         requestId: originalRequest.requestId,
         from: this._clientId,
         to: originalRequest.from,
         data
     };
     ws.send(JSON.stringify(message));
  }

  match(handler: (data: TRequestApi, from?: string) => Promise<TResponseApi | void> | TResponseApi | void) {
      this.addEventListener("request", async (ev: Event) => {
          const customEv = ev as CustomEvent<RpcRequest<TRequestApi>>;
          const req = customEv.detail;
          try {
            const result = await handler(req.data, req.from);
            if (result !== undefined) {
                // @ts-ignore
                this.respondTo(req, result);
            }
          } catch (err) {
              console.error("[Socket] Match handler error", err);
          }
      });
  }

  static fromUrl<TReq, TRes>(url: string, options?: { requestSchema?: z.Schema<TReq>, responseSchema?: z.Schema<TRes> }): Socket<TReq, TRes> {
    const socket = new Socket<TReq, TRes>(url, options);
    socket.open();
    return socket;
  }
}
