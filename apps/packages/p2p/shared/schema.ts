import { z } from "zod";

/**
 * P2P request schema
 */
export const P2PRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("direct-message"),
		content: z.string().min(1).max(1000),
		from: z.string(),
		fromName: z.string(),
	}),
	z.object({
		type: z.literal("broadcast-message"),
		content: z.string().min(1).max(1000),
		from: z.string(),
		fromName: z.string(),
	}),
	z.object({
		type: z.literal("list-peers"),
	}),
	z.object({
		type: z.literal("peer-info"),
		peerId: z.string(),
	}),
]);

/**
 * P2P response schema
 */
export const P2PResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("direct-message"),
		from: z.string(),
		fromName: z.string(),
		content: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("broadcast-message"),
		from: z.string(),
		fromName: z.string(),
		content: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("peer-list"),
		peers: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				connectedAt: z.number(),
			}),
		),
	}),
	z.object({
		type: z.literal("peer-info"),
		peerId: z.string(),
		peerName: z.string(),
		online: z.boolean(),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

export type P2PRequest = z.infer<typeof P2PRequestSchema>;
export type P2PResponse = z.infer<typeof P2PResponseSchema>;
