import { z } from "zod";

/**
 * Auth request schema
 */
export const AuthRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("ping"),
	}),
	z.object({
		type: z.literal("protected-action"),
		action: z.string(),
	}),
	z.object({
		type: z.literal("admin-action"),
		action: z.string(),
	}),
	z.object({
		type: z.literal("get-profile"),
	}),
]);

/**
 * Auth response schema
 */
export const AuthResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("pong"),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal("action-result"),
		success: z.boolean(),
		message: z.string(),
	}),
	z.object({
		type: z.literal("profile"),
		userId: z.string(),
		role: z.enum(["admin", "user"]),
		rateLimit: z.number(),
		permissions: z.array(z.string()),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
		code: z.string(),
	}),
]);

export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
