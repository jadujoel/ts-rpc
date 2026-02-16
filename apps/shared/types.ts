/**
 * Common TypeScript types shared across demo applications
 */

/**
 * User information
 */
export interface User {
	id: string;
	name: string;
	role?: "admin" | "user";
}

/**
 * Message with metadata
 */
export interface Message {
	id: string;
	from: string;
	fromName?: string;
	content: string;
	timestamp: number;
	to?: string;
}
