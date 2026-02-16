/** biome-ignore-all lint/suspicious/noExplicitAny: test file */
/** biome-ignore-all lint/style/noNonNullAssertion: test file */
import { describe, expect, test } from "bun:test";
import {
	type AuthToken,
	AuthTokenSchema,
	DefaultAuthorizationRules,
	NoAuthValidator,
	RateLimiter,
	SimpleAuthValidator,
	StrictAuthorizationRules,
} from "./Authorization.ts";

describe("AuthTokenSchema", () => {
	test("validates valid token with all fields", () => {
		const token: AuthToken = {
			token: "abc123",
			userId: "user-1",
			sessionId: "session-1",
		};
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(token);
		}
	});

	test("validates token with only required field", () => {
		const token = { token: "abc123" };
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.token).toBe("abc123");
		}
	});

	test("validates token with userId but no sessionId", () => {
		const token = { token: "abc123", userId: "user-1" };
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(true);
	});

	test("rejects empty token string", () => {
		const token = { token: "" };
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(false);
	});

	test("rejects missing token field", () => {
		const token = { userId: "user-1" };
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(false);
	});

	test("rejects invalid token type", () => {
		const token = { token: 123 };
		const result = AuthTokenSchema.safeParse(token);
		expect(result.success).toBe(false);
	});
});

describe("DefaultAuthorizationRules", () => {
	const rules = new DefaultAuthorizationRules();

	test("allows subscription to any topic", () => {
		expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(true);
		expect(rules.canSubscribeToTopic(undefined, "topic-1")).toBe(true);
		expect(rules.canSubscribeToTopic("user-2", "admin-topic")).toBe(true);
	});

	test("allows publishing to any topic", () => {
		expect(rules.canPublishToTopic("user-1", "topic-1")).toBe(true);
		expect(rules.canPublishToTopic(undefined, "topic-1")).toBe(true);
		expect(rules.canPublishToTopic("user-2", "admin-topic")).toBe(true);
	});

	test("allows messaging any peer", () => {
		expect(rules.canMessagePeer("user-1", "client-1")).toBe(true);
		expect(rules.canMessagePeer(undefined, "client-1")).toBe(true);
		expect(rules.canMessagePeer("user-2", "client-2")).toBe(true);
	});

	test("returns default rate limit of 100", () => {
		expect(rules.getRateLimit("user-1")).toBe(100);
		expect(rules.getRateLimit(undefined)).toBe(100);
		expect(rules.getRateLimit("admin")).toBe(100);
	});
});

describe("StrictAuthorizationRules", () => {
	describe("constructor and basic operations", () => {
		test("creates with empty admins and permissions", () => {
			const rules = new StrictAuthorizationRules();
			expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(false);
			expect(rules.getRateLimit("user-1")).toBe(50);
		});

		test("creates with admins set", () => {
			const admins = new Set(["admin-1", "admin-2"]);
			const rules = new StrictAuthorizationRules(admins);
			expect(rules.canSubscribeToTopic("admin-1", "topic-1")).toBe(true);
			expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(false);
		});

		test("creates with topic permissions", () => {
			const topicPermissions = new Map([
				["topic-1", new Set(["user-1", "user-2"])],
				["topic-2", new Set(["user-3"])],
			]);
			const rules = StrictAuthorizationRules.FromOptions({
				topicPermissions: topicPermissions,
			});
			expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(true);
			expect(rules.canSubscribeToTopic("user-3", "topic-2")).toBe(true);
			expect(rules.canSubscribeToTopic("user-1", "topic-2")).toBe(false);
		});
	});

	describe("FromOptions", () => {
		test("creates from options with array of admins", () => {
			const rules = StrictAuthorizationRules.FromOptions({
				adminUsers: ["admin-1", "admin-2"],
			});
			expect(rules.canSubscribeToTopic("admin-1", "any-topic")).toBe(true);
			expect(rules.getRateLimit("admin-1")).toBe(1000);
		});

		test("creates from options with Set of admins", () => {
			const rules = StrictAuthorizationRules.FromOptions({
				adminUsers: new Set(["admin-1", "admin-2"]),
			});
			expect(rules.canSubscribeToTopic("admin-2", "any-topic")).toBe(true);
			expect(rules.getRateLimit("admin-2")).toBe(1000);
		});

		test("creates from options with topic permissions", () => {
			const rules = StrictAuthorizationRules.FromOptions({
				adminUsers: ["admin-1"],
				topicPermissions: new Map([["private-topic", new Set(["user-1"])]]),
			});
			expect(rules.canSubscribeToTopic("admin-1", "private-topic")).toBe(true);
			expect(rules.canSubscribeToTopic("user-1", "private-topic")).toBe(true);
			expect(rules.canSubscribeToTopic("user-2", "private-topic")).toBe(false);
		});

		test("creates from empty options", () => {
			const rules = StrictAuthorizationRules.FromOptions({});
			expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(false);
		});
	});

	describe("FromAdmins", () => {
		test("creates with admin users", () => {
			const rules = StrictAuthorizationRules.FromAdmins(["admin-1", "admin-2"]);
			expect(rules.canSubscribeToTopic("admin-1", "any-topic")).toBe(true);
			expect(rules.canSubscribeToTopic("admin-2", "any-topic")).toBe(true);
			expect(rules.canSubscribeToTopic("user-1", "any-topic")).toBe(false);
		});

		test("creates with empty admin list", () => {
			const rules = StrictAuthorizationRules.FromAdmins([]);
			expect(rules.canSubscribeToTopic("user-1", "topic-1")).toBe(false);
		});
	});

	describe("canSubscribeToTopic", () => {
		const rules = new StrictAuthorizationRules(
			new Set(["admin-1"]),
			new Map([
				["public", new Set(["user-1", "user-2"])],
				["private", new Set(["user-1"])],
			]),
		);

		test("denies unauthenticated users", () => {
			expect(rules.canSubscribeToTopic(undefined, "public")).toBe(false);
		});

		test("allows admins to subscribe to any topic", () => {
			expect(rules.canSubscribeToTopic("admin-1", "public")).toBe(true);
			expect(rules.canSubscribeToTopic("admin-1", "private")).toBe(true);
			expect(rules.canSubscribeToTopic("admin-1", "nonexistent")).toBe(true);
		});

		test("allows users with permissions", () => {
			expect(rules.canSubscribeToTopic("user-1", "public")).toBe(true);
			expect(rules.canSubscribeToTopic("user-2", "public")).toBe(true);
			expect(rules.canSubscribeToTopic("user-1", "private")).toBe(true);
		});

		test("denies users without permissions", () => {
			expect(rules.canSubscribeToTopic("user-2", "private")).toBe(false);
			expect(rules.canSubscribeToTopic("user-3", "public")).toBe(false);
		});

		test("denies users for nonexistent topics", () => {
			expect(rules.canSubscribeToTopic("user-1", "nonexistent")).toBe(false);
		});
	});

	describe("canPublishToTopic", () => {
		const rules = new StrictAuthorizationRules(
			new Set(["admin-1"]),
			new Map([["topic-1", new Set(["user-1"])]]),
		);

		test("uses same logic as canSubscribeToTopic", () => {
			expect(rules.canPublishToTopic("admin-1", "topic-1")).toBe(true);
			expect(rules.canPublishToTopic("user-1", "topic-1")).toBe(true);
			expect(rules.canPublishToTopic("user-2", "topic-1")).toBe(false);
			expect(rules.canPublishToTopic(undefined, "topic-1")).toBe(false);
		});
	});

	describe("canMessagePeer", () => {
		const rules = new StrictAuthorizationRules();

		test("allows authenticated users to message peers", () => {
			expect(rules.canMessagePeer("user-1", "client-1")).toBe(true);
			expect(rules.canMessagePeer("admin-1", "client-2")).toBe(true);
		});

		test("denies unauthenticated users", () => {
			expect(rules.canMessagePeer(undefined, "client-1")).toBe(false);
		});
	});

	describe("getRateLimit", () => {
		const rules = new StrictAuthorizationRules(
			new Set(["admin-1"]),
			new Map([["topic-1", new Set(["user-1"])]]),
		);

		test("returns 10 for unauthenticated users", () => {
			expect(rules.getRateLimit(undefined)).toBe(10);
			expect(rules.getRateLimit(undefined)).toBe(
				StrictAuthorizationRules.RateLimits.Unauthenticated,
			);
		});

		test("returns 1000 for admin users", () => {
			expect(rules.getRateLimit("admin-1")).toBe(1000);
			expect(rules.getRateLimit("admin-1")).toBe(
				StrictAuthorizationRules.RateLimits.Admin,
			);
		});

		test("returns 50 for regular users", () => {
			expect(rules.getRateLimit("user-1")).toBe(50);
			expect(rules.getRateLimit("user-2")).toBe(50);
			expect(rules.getRateLimit("user-1")).toBe(
				StrictAuthorizationRules.RateLimits.User,
			);
		});
	});
});

describe("RateLimiter", () => {
	describe("constructor", () => {
		test("creates with default values", () => {
			const limiter = new RateLimiter();
			expect(limiter.capacity).toBe(100);
			expect(limiter.refillRate).toBe(100);
		});

		test("creates with custom capacity and refill rate", () => {
			const limiter = new RateLimiter(50, 25);
			expect(limiter.capacity).toBe(50);
			expect(limiter.refillRate).toBe(25);
		});
	});

	describe("tryConsume", () => {
		test("allows first request for new bucket", () => {
			const limiter = new RateLimiter(100, 100);
			expect(limiter.tryConsume("user-1")).toBe(true);
		});

		test("allows requests up to capacity", () => {
			const limiter = new RateLimiter(5, 10);
			for (let i = 0; i < 5; i++) {
				expect(limiter.tryConsume("user-1")).toBe(true);
			}
		});

		test("denies requests exceeding capacity", () => {
			const limiter = new RateLimiter(5, 10);
			// Consume all tokens
			for (let i = 0; i < 5; i++) {
				limiter.tryConsume("user-1");
			}
			// Next request should be denied
			expect(limiter.tryConsume("user-1")).toBe(false);
		});

		test("tracks different buckets independently", () => {
			const limiter = new RateLimiter(2, 10);
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-2")).toBe(true);
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-2")).toBe(true);

			// Both should be at capacity now
			expect(limiter.tryConsume("user-1")).toBe(false);
			expect(limiter.tryConsume("user-2")).toBe(false);
		});

		test("refills tokens over time", async () => {
			const limiter = new RateLimiter(5, 10); // 10 tokens per second
			// Consume all tokens
			for (let i = 0; i < 5; i++) {
				limiter.tryConsume("user-1");
			}
			expect(limiter.tryConsume("user-1")).toBe(false);

			// Wait 200ms - should refill ~2 tokens
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-1")).toBe(true);

			// Should not have more than 2 tokens
			expect(limiter.tryConsume("user-1")).toBe(false);
		});

		test("respects capacity cap during refill", async () => {
			const limiter = new RateLimiter(3, 100); // 100 tokens per second, max 3

			// Don't consume any tokens initially
			// Wait long enough for refill to happen
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should only have capacity of 3, not more
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-1")).toBe(false);
		});
	});

	describe("clear", () => {
		test("clears specific bucket", () => {
			const limiter = new RateLimiter(2, 10);
			// Consume all tokens
			limiter.tryConsume("user-1");
			limiter.tryConsume("user-1");
			expect(limiter.tryConsume("user-1")).toBe(false);

			// Clear and should reset
			limiter.clear("user-1");
			expect(limiter.tryConsume("user-1")).toBe(true);
		});

		test("does not affect other buckets", () => {
			const limiter = new RateLimiter(2, 10);
			limiter.tryConsume("user-1");
			limiter.tryConsume("user-1");
			limiter.tryConsume("user-2");
			limiter.tryConsume("user-2");

			limiter.clear("user-1");

			expect(limiter.tryConsume("user-1")).toBe(true); // Reset
			expect(limiter.tryConsume("user-2")).toBe(false); // Still at limit
		});
	});

	describe("clearAll", () => {
		test("clears all buckets", () => {
			const limiter = new RateLimiter(2, 10);
			limiter.tryConsume("user-1");
			limiter.tryConsume("user-1");
			limiter.tryConsume("user-2");
			limiter.tryConsume("user-2");

			expect(limiter.tryConsume("user-1")).toBe(false);
			expect(limiter.tryConsume("user-2")).toBe(false);

			limiter.clearAll();

			expect(limiter.tryConsume("user-1")).toBe(true);
			expect(limiter.tryConsume("user-2")).toBe(true);
		});
	});
});

describe("SimpleAuthValidator", () => {
	describe("constructor", () => {
		test("creates with empty token map", () => {
			const validator = new SimpleAuthValidator();
			expect(validator.validate("any-token")).toBe(null);
		});

		test("creates with initial tokens", () => {
			const tokens = new Map([["token-1", { userId: "user-1" }]]);
			const validator = new SimpleAuthValidator(tokens);
			const result = validator.validate("token-1");
			expect(result).not.toBe(null);
			expect(result?.userId).toBe("user-1");
		});
	});

	describe("validate", () => {
		test("returns null for null token", () => {
			const validator = new SimpleAuthValidator();
			expect(validator.validate(null)).toBe(null);
		});

		test("returns null for invalid token", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("valid-token", "user-1");
			expect(validator.validate("invalid-token")).toBe(null);
		});

		test("returns AuthContext for valid token", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("valid-token", "user-1");

			const result = validator.validate("valid-token");
			expect(result).not.toBe(null);
			expect(result?.userId).toBe("user-1");
			expect(result?.permissions).toEqual(new Set(["*"]));
			expect(result?.connectedAt).toBeInstanceOf(Date);
			expect(result?.lastActivityAt).toBeInstanceOf(Date);
		});

		test("handles multiple tokens", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("token-1", "user-1");
			validator.addToken("token-2", "user-2");

			const result1 = validator.validate("token-1");
			const result2 = validator.validate("token-2");

			expect(result1?.userId).toBe("user-1");
			expect(result2?.userId).toBe("user-2");
		});
	});

	describe("addToken", () => {
		test("adds valid token", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("new-token", "user-1");

			const result = validator.validate("new-token");
			expect(result?.userId).toBe("user-1");
		});

		test("overwrites existing token", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("token", "user-1");
			validator.addToken("token", "user-2");

			const result = validator.validate("token");
			expect(result?.userId).toBe("user-2");
		});
	});

	describe("removeToken", () => {
		test("removes existing token", () => {
			const validator = new SimpleAuthValidator();
			validator.addToken("token", "user-1");
			expect(validator.validate("token")).not.toBe(null);

			validator.removeToken("token");
			expect(validator.validate("token")).toBe(null);
		});

		test("handles removing nonexistent token", () => {
			const validator = new SimpleAuthValidator();
			validator.removeToken("nonexistent");
			expect(validator.validate("nonexistent")).toBe(null);
		});
	});
});

describe("NoAuthValidator", () => {
	test("validates any token", () => {
		const validator = new NoAuthValidator();

		const result1 = validator.validate("any-token");
		const result2 = validator.validate(null);
		const result3 = validator.validate("another-token");

		expect(result1).not.toBe(null);
		expect(result2).not.toBe(null);
		expect(result3).not.toBe(null);
	});

	test("returns AuthContext with wildcard permissions", () => {
		const validator = new NoAuthValidator();
		const result = validator.validate("token");

		expect(result.permissions).toEqual(new Set(["*"]));
		expect(result.connectedAt).toBeInstanceOf(Date);
		expect(result.lastActivityAt).toBeInstanceOf(Date);
	});

	test("returns context without userId", () => {
		const validator = new NoAuthValidator();
		const result = validator.validate("token");

		expect(result.userId).toBeUndefined();
	});

	test("always returns new context object", () => {
		const validator = new NoAuthValidator();
		const result1 = validator.validate("token");
		const result2 = validator.validate("token");

		// Should be different objects with different timestamps
		expect(result1).not.toBe(result2);
		expect(result1.connectedAt).not.toBe(result2.connectedAt);
	});
});
