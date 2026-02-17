import { z } from "zod";

/**
 * Chat message request schema
 */
export const ChatRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message"),
		content: z.string().min(1).max(1000),
		username: z.string().min(1).max(50),
	}),
	z.object({
		type: z.literal("join"),
		username: z.string().min(1).max(50),
	}),
	z.object({
		type: z.literal("leave"),
		username: z.string().min(1).max(50),
	}),
	z.object({
		type: z.literal("list-users"),
	}),
] as const);

/**
 * Chat message response schema
 */
export const ChatResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message"),
		from: z.string(),
		fromName: z.string(),
		content: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("user-joined"),
		username: z.string(),
		userId: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("user-left"),
		username: z.string(),
		userId: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("user-list"),
		users: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
			}),
		),
	}),
	z.object({
		type: z.literal("message-history"),
		messages: z.array(
			z.object({
				from: z.string(),
				fromName: z.string(),
				content: z.string(),
				timestamp: z.number(),
			}),
		),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
] as const);

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
