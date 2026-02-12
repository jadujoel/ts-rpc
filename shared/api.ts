export type Unknown = {
  readonly type: "unknown"
}

export type RequestApi = Unknown | {
  readonly type: "score"
} | {
  readonly type: "greet"
  readonly name: string
} | {
  readonly type: "game"
}

export type ResponseApi = Unknown | {
  readonly type: "score",
  readonly score: number
} | {
  readonly type: "greet",
  readonly greeting: string
}| {
  readonly type: "game",
  readonly name: string
}
