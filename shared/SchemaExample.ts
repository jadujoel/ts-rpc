import { z } from "zod";

export const RequestApiSchemaExample = z.discriminatedUnion("type", [
	z.object({ type: z.literal("unknown") }),
	z.object({ type: z.literal("score") }),
	z.object({ type: z.literal("greet"), name: z.string() }),
	z.object({ type: z.literal("game") }),
]);

export const ResponseApiSchemaExample = z.discriminatedUnion("type", [
	z.object({ type: z.literal("unknown") }),
	z.object({ type: z.literal("score"), score: z.number() }),
	z.object({ type: z.literal("greet"), greeting: z.string() }),
	z.object({ type: z.literal("game"), name: z.string() }),
	z.object({ type: z.literal("error"), message: z.string() }),
]);

export type RequestApiExample = z.infer<typeof RequestApiSchemaExample>;
export type ResponseApiExample = z.infer<typeof ResponseApiSchemaExample>;
