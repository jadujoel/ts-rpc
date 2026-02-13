import { z } from "zod";

export const RequestApiSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unknown") }),
  z.object({ type: z.literal("score") }),
  z.object({ type: z.literal("greet"), name: z.string() }),
  z.object({ type: z.literal("game") }),
]);

export const ResponseApiSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unknown") }),
  z.object({ type: z.literal("score"), score: z.number() }),
  z.object({ type: z.literal("greet"), greeting: z.string() }),
  z.object({ type: z.literal("game"), name: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type RequestApi = z.infer<typeof RequestApiSchema>;
export type ResponseApi = z.infer<typeof ResponseApiSchema>;
