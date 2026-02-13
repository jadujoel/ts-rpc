import type { Server, WebSocketHandler, ServerWebSocket } from 'bun'
import * as util from "node:util"
import * as api from "./api"
import home from "./src/index.html"

export interface ServeOptions {
  readonly hostname?: string
  readonly port?: number
  readonly development?: boolean
  readonly hot?: boolean
}

const BANNED_STRINGS = ['..'] as const

interface WebSocketData {
  readonly url: string
  readonly host: string
  readonly origin: string
  readonly secWebsocketVersion: string
  readonly secWebsocketKey: string
  readonly secWebsocketExtensions: string
  readonly secWebsocketProtocol: string
  readonly userAgent: string
  readonly acceptEncoding: string
  readonly topic: string
  readonly date: Date
  readonly id: string
}

// Global map to track clients across the server instance
const clients = new Map<string, ServerWebSocket<WebSocketData>>()

export function serve({
  hostname = 'localhost',
  port = 3000,
  development = false,
  hot = false
}: ServeOptions = {}): Server {
  console.log('Server Options', { hostname, port, development, hot })
  const server = Bun.serve({
    hostname,
    port,
    development,
    routes: {
      "/": home
    },
    async fetch(request, server): Promise<Response> {
      console.time(`Request ${request.url}`)
      if (BANNED_STRINGS.some((banned) => request.url.includes(banned))) {
        return new Response("404")
      }

      if (request.headers.get('upgrade')) {
        const data = getWebSocketData(request)
        if (
          !server.upgrade(request, { data })
        ) {
          return new Response('Upgrade failed', { status: 400 })
        }
      }

      const response = await getResponse(request, server)
      console.timeEnd(`Request ${request.url}`)
      return response
    },
    websocket: <WebSocketHandler<WebSocketData>>{
      async open(ws): Promise<void> {
        const topic = ws.data.topic
        ws.subscribe(topic)

        // Register client
        clients.set(ws.data.id, ws)

        console.log(`[ws] open ${ws.remoteAddress} id: ${ws.data.id} topic: ${topic} subscribers: ${server.subscriberCount(topic)}`)

        // Send initial handshake/welcome
        ws.send(JSON.stringify({
           category: 'welcome',
           clientId: ws.data.id
        }))
      },
      message(ws, message): void {
        const topic = ws.data.topic
        if (!topic) {
          console.error(`[ws] Failed To Recieve Message For ${ws.data.url} due to no Topic`)
          return
        }

        try {
            const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
            const parsed = JSON.parse(raw);

            // If message has a specific destination, route it directly
            if (parsed.to) {
                const target = clients.get(parsed.to);
                if (target) {
                    // console.log(`[ws] Routing message from ${ws.data.id} to ${parsed.to}`);
                    target.send(message);
                } else {
                    console.warn(`[ws] Target ${parsed.to} not found`);
                }
            } else {
                // Otherwise broadcast to topic (legacy behavior + discovery)
                ws.publish(topic, message as string | Bun.BufferSource)
            }
        } catch (err) {
            console.error("[ws] Failed to parse message, broadcasting raw", err);
            ws.publish(topic, message as string | Bun.BufferSource)
        }
      },
      close(ws, code, reason): void {
        clients.delete(ws.data.id);
        console.log(`[ws] close ${ws.remoteAddress} id: ${ws.data.id} code: ${code} reason: ${reason}`)
      }
    }
  })
  console.log(`Server running at ${server.url}`)
  console.log(`Websocket running at ws://${server.hostname}:${server.port}`)
  return server
}

function getWebSocketData(request: Request): WebSocketData {
  const data: WebSocketData = {
    url: request.url,
    topic: new URL(request.url).pathname.slice(1) || "none",
    host: request.headers.get("host") ?? "unknown",
    origin: request.headers.get("origin") ?? "unknown",
    secWebsocketVersion: request.headers.get("sec-websocket-version") ?? "unknown",
    secWebsocketKey: request.headers.get("sec-websocket-key") ?? "unknown",
    secWebsocketExtensions: request.headers.get("sec-websocket-extensions") ?? "unknown",
    secWebsocketProtocol: request.headers.get("sec-websocket-protocol") ?? "unknown",
    acceptEncoding: request.headers.get("accept-encoding") ?? "unknown",
    userAgent: request.headers.get("user-agent") ?? "unknown",
    date: new Date(),
    id: crypto.randomUUID()
  }
  return data
}

async function getResponse(request: Request, server: Server): Promise<Response> {
  switch (request.method) {
    case 'GET': {
      const response = await api.GET(request, server)
      return response
    }
    case 'POST': {
      console.timeEnd(`Request ${request.url}`)
      return api.POST(request, server)
    }
    case 'DELETE': {
      console.timeEnd(`Request ${request.url}`)
      return api.DELETE(request, server)
    }
    default: {
      console.timeEnd(`Request ${request.url}`)
      return new Response("404")
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
          default: true
        },
        hostname: {
          type: "string",
          default: "127.0.0.1"
        },
        hot: {
          type: "boolean",
          default: false
        },
        port: {
          type: "string",
          default: "8080"
        }
      }
    })
    return {
      ...parsed.values,
      port: Number.parseInt(parsed.values.port ?? 8080, 10)
    }
  }
}

if (import.meta.main) {
  const collected = cli.collect()
  serve(collected)
}
