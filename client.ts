import { type RequestApi, type ResponseApi, RequestApiSchema, ResponseApiSchema } from './shared/api'
import { Socket } from "./shared/socket"

const rpc = Socket.fromUrl<RequestApi, ResponseApi>("ws://127.0.0.1:8080", {
  requestSchema: RequestApiSchema,
  responseSchema: ResponseApiSchema
})

const score = await rpc.call({
  type: "score"
})

console.log("Score:", score.data)

const game = await rpc.call({
  type: "game",
})

console.log("game", game)

// const greeting = await rpc.call({
//   type: "greet",
//   name: "Testy McTestFace"
// })

// console.log("Greeting:", greeting.data)
