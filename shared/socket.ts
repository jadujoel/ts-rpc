import { useSignal } from './signal'

export type RpcRequest<TData = unknown> = {
  readonly category: "request",
  readonly requestId: number,
  readonly data: TData
}

export type RpcResponse<TData = unknown> = {
  readonly category: "response",
  readonly requestId: number,
  readonly responseId: number,
  readonly data: TData
}

export type RpcApi<TRequestData = unknown, TResponseData = unknown> = RpcRequest<TRequestData> | RpcResponse<TResponseData>

export class Socket<TRequestApi, TResponseApi> extends EventTarget {
  private _ws: WebSocket | undefined
  constructor(
    public readonly url: string,
  ) {
    super()
  }

  public requests = useSignal<RpcRequest<TRequestApi>>(undefined as any)
  public responses = useSignal<RpcResponse<TResponseApi>>(undefined as any)
  public state = useSignal<"closed" | "open">("closed")

  async open(): Promise<WebSocket> {
    const ws = this._ws
    const needsNewSocket = ws === undefined || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING
    if (!needsNewSocket) {
      if (ws.readyState === WebSocket.OPEN) {
        return ws
      }
      // we must be in: ws.readyState === WebSocket.CONNECTING
      return new Promise((resolve) => {
        ws.addEventListener("open", () => {
          resolve(ws)
        }, { once: true })
      })
    }
    const promise = new Promise<WebSocket>((resolve) => {
      try {
        const ws = new WebSocket(this.url)
        this._ws = ws
        ws.addEventListener("open", (ev) => {
          this.state.set("open")
          this.dispatchEvent(new MessageEvent(ev.type, ev))
          resolve(ws)
        })
        ws.addEventListener("close", (ev) => {
          this.state.set("closed")
          this.dispatchEvent(new MessageEvent(ev.type, ev))
          this.open()
        })
        ws.addEventListener("message", (ev) => {
          const parsed = <RpcRequest<TRequestApi> | RpcResponse<TResponseApi>>JSON.parse(ev.data)
          if (parsed.category === "request") {
            this.requests.set(parsed)
          } else if (parsed.category === "response") {
            this.responses.set(parsed)
            const promise = this.promises.get(parsed.requestId)
            if (promise !== undefined) {
              promise.resolve(parsed)
              this.promises.delete(parsed.requestId)
            }
          }
          this.dispatchEvent(new MessageEvent(ev.type, ev))
        })
        ws.addEventListener("error", (ev) => {
          this.state.set("closed")
          this.dispatchEvent(new MessageEvent(ev.type, ev))
          this.open()
        })
      } catch {
        setTimeout(() => {
          this.open().then(ws => resolve(ws))
        }, 500)
      }
    })
    return promise
  }

  async send(json: TRequestApi): Promise<void> {
    const ws = await this.open()
    ws.send(JSON.stringify(json))
  }

  private promises = new Map<number, PromiseWithResolvers<any>>()

  async request<TResponse = RpcResponse<TResponseApi>>(data: TRequestApi, requestId = Date.now()): Promise<TResponse> {
    const message = <RpcRequest<TRequestApi>>{
      category: "request",
      requestId,
      data: data
    }
    const str = JSON.stringify(message)
    const ws = await this.open()

    const promise = Promise.withResolvers<TResponse>()
    this.promises.set(message.requestId, promise)
    ws.send(str)

    return promise.promise
  }

  call = this.request

  async respondTo(request: RpcRequest<TRequestApi>, data: TResponseApi) {
    const message = <RpcResponse<TResponseApi>>{
      category: "response",
      requestId: request.requestId,
      responseId: Date.now(),
      data: data
    }
    const str = JSON.stringify(message)
    const ws = await this.open()
    ws.send(str)
  }

  async match(meth: (data: TRequestApi) => TResponseApi | Promise<TResponseApi>) {
    this.addEventListener("message", async (ev) => {
      const msg: RpcApi<TRequestApi> = JSON.parse((ev as MessageEvent).data)
      if (msg.category === "request") {
        const result = await meth(msg.data)
        this.respondTo(msg, result)
      }
    })
  }

  static fromUrl<TRequestApi, TResponseApi>(url: string): Socket<TRequestApi, TResponseApi> {
    const socket = new Socket<TRequestApi, TResponseApi>(url)
    socket.open()
    return socket
  }

  static singleton: undefined | Socket<any, any>
  static fromUrlSingleton<TRequestApi, TResponseApi>(url: string): Socket<TRequestApi, TResponseApi> {
    if (Socket.singleton !== undefined) {
      return Socket.singleton
    }
    const socket = new Socket<TRequestApi, TResponseApi>(url)
    socket.open()
    return socket
  }
}
