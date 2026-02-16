/**
 * Example Zod schemas for RPC request/response validation.
 *
 * This file demonstrates how to define type-safe schemas for RpcPeer communication.
 * Use these as templates for creating your own application-specific schemas.
 *
 * @example
 * ```typescript
 * import { RpcPeer } from './shared/RpcPeer';
 * import { RequestApiSchemaExample, ResponseApiSchemaExample } from './shared/SchemaExample';
 *
 * const peer = RpcPeer.FromOptions({
 *   url: 'ws://localhost:8080',
 *   requestSchema: RequestApiSchemaExample,
 *   responseSchema: ResponseApiSchemaExample
 * });
 *
 * // Type-safe request (TypeScript knows the shape)
 * const response = await peer.request({ type: 'greet', name: 'Alice' });
 * if (response.data.type === 'greet') {
 *   console.log(response.data.greeting);
 * }
 * ```
 */
import { z } from "zod";

/**
 * Example request schema demonstrating discriminated union pattern.
 * Each request type has a unique 'type' field for runtime validation.
 *
 * Supported request types:
 * - unknown: Default/fallback request type
 * - score: Request for score data
 * - greet: Greeting request with name parameter
 * - game: Request for game information
 */
export const RequestApiSchemaExample = z.discriminatedUnion("type", [
	z.object({ type: z.literal("unknown") }),
	z.object({ type: z.literal("score") }),
	z.object({ type: z.literal("greet"), name: z.string() }),
	z.object({ type: z.literal("game") }),
]);

/**
 * Example response schema demonstrating discriminated union pattern.
 * Each response type has a unique 'type' field for runtime validation.
 *
 * Supported response types:
 * - unknown: Default/fallback response
 * - score: Score data response with numeric score
 * - greet: Greeting response with formatted message
 * - game: Game information response with name
 * - error: Error response with error message
 */
export const ResponseApiSchemaExample = z.discriminatedUnion("type", [
	z.object({ type: z.literal("unknown") }),
	z.object({ type: z.literal("score"), score: z.number() }),
	z.object({ type: z.literal("greet"), greeting: z.string() }),
	z.object({ type: z.literal("game"), name: z.string() }),
	z.object({ type: z.literal("error"), message: z.string() }),
]);

/** TypeScript type inferred from RequestApiSchemaExample. */
export type RequestApiExample = z.infer<typeof RequestApiSchemaExample>;

/** TypeScript type inferred from ResponseApiSchemaExample. */
export type ResponseApiExample = z.infer<typeof ResponseApiSchemaExample>;
