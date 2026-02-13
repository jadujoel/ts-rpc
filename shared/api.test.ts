import { describe, expect, test } from "bun:test";
import {
	type RequestApiExample,
	RequestApiSchemaExample,
	type ResponseApiExample,
	ResponseApiSchemaExample,
} from "./api";

describe("API Schemas", () => {
	describe("RequestApiSchemaExample", () => {
		test("validates unknown request", () => {
			const data = { type: "unknown" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("validates score request", () => {
			const data = { type: "score" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("validates greet request with name", () => {
			const data = { type: "greet", name: "Alice" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("greet");
				if (result.data.type === "greet") {
					expect(result.data.name).toBe("Alice");
				}
			}
		});

		test("validates game request", () => {
			const data = { type: "game" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("rejects greet request without name", () => {
			const data = { type: "greet" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});

		test("rejects greet request with non-string name", () => {
			const data = { type: "greet", name: 123 };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});

		test("rejects invalid request type", () => {
			const data = { type: "invalid" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});

		test("rejects missing type field", () => {
			const data = { name: "Alice" };
			const result = RequestApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});
	});

	describe("ResponseApiSchemaExample", () => {
		test("validates unknown response", () => {
			const data = { type: "unknown" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("validates score response with number", () => {
			const data = { type: "score", score: 42 };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
			if (result.success && result.data.type === "score") {
				expect(result.data.score).toBe(42);
			}
		});

		test("validates greet response with greeting", () => {
			const data = { type: "greet", greeting: "Hello, Alice!" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("validates game response with name", () => {
			const data = { type: "game", name: "Chess" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
		});

		test("validates error response with message", () => {
			const data = { type: "error", message: "Something went wrong" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(true);
			if (result.success && result.data.type === "error") {
				expect(result.data.message).toBe("Something went wrong");
			}
		});

		test("rejects score response without score field", () => {
			const data = { type: "score" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});

		test("rejects score response with non-number score", () => {
			const data = { type: "score", score: "42" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});

		test("rejects error response without message", () => {
			const data = { type: "error" };
			const result = ResponseApiSchemaExample.safeParse(data);
			expect(result.success).toBe(false);
		});
	});

	describe("Type inference", () => {
		test("RequestApiExample has correct type", () => {
			const validRequests: RequestApiExample[] = [
				{ type: "unknown" },
				{ type: "score" },
				{ type: "greet", name: "Bob" },
				{ type: "game" },
			];

			validRequests.forEach((req) => {
				const result = RequestApiSchemaExample.safeParse(req);
				expect(result.success).toBe(true);
			});
		});

		test("ResponseApiExample has correct type", () => {
			const validResponses: ResponseApiExample[] = [
				{ type: "unknown" },
				{ type: "score", score: 100 },
				{ type: "greet", greeting: "Hi!" },
				{ type: "game", name: "Poker" },
				{ type: "error", message: "Error occurred" },
			];

			validResponses.forEach((res) => {
				const result = ResponseApiSchemaExample.safeParse(res);
				expect(result.success).toBe(true);
			});
		});
	});
});
