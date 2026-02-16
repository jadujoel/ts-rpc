import { z } from "zod";

/**
 * Zod schema for validating authentication tokens.
 * Ensures token is a non-empty string with optional userId and sessionId.
 */
export const AuthTokenSchema = z.object({
	token: z.string().min(1),
	userId: z.string().optional(),
	sessionId: z.string().optional(),
});

/** Inferred type from AuthTokenSchema. */
export type AuthToken = z.infer<typeof AuthTokenSchema>;

/**
 * Authentication context attached to WebSocket connections.
 * Contains user identity, session information, permissions, and activity tracking.
 * @template TUserIds - The user ID type
 * @template TSessionIds - The session ID type
 * @template TPermissions - The permission string type
 */
export interface AuthContext<
	TUserIds extends string = string,
	TSessionIds extends string = string,
	TPermissions extends string = string,
> {
	readonly userId?: TUserIds;
	/** Unique session identifier for reconnection support. */
	readonly sessionId?: TSessionIds;
	/** Set of permission strings granted to this user. */
	readonly permissions: Set<TPermissions>;
	/** Timestamp when the connection was established. */
	readonly connectedAt: Date;
	/** Timestamp of the last activity from this connection. */
	readonly lastActivityAt: Date;
}

/**
 * Authorization rules for controlling access to topics and peer-to-peer messaging.
 * Implement this interface to define custom authorization logic for your application.
 * @template TUserId - The user ID type
 * @template TTopic - The topic name type
 * @template TToClientId - The target client ID type
 */
export interface AuthorizationRules<
	TUserId extends string = string,
	TTopic extends string = string,
	TToClientId extends string = string,
> {
	/**
	 * Checks if a user can subscribe to a specific topic.
	 * @param userId - The user ID, undefined for unauthenticated users
	 * @param topic - The topic name to check
	 * @returns True if the user is allowed to subscribe
	 */
	canSubscribeToTopic(userId: TUserId | undefined, topic: TTopic): boolean;

	/**
	 * Checks if a user can publish messages to a specific topic.
	 * @param userId - The user ID, undefined for unauthenticated users
	 * @param topic - The topic name to check
	 * @returns True if the user is allowed to publish
	 */
	canPublishToTopic(userId: TUserId | undefined, topic: TTopic): boolean;

	/**
	 * Checks if a user can send direct messages to another peer.
	 * @param fromUserId - The sender's user ID, undefined for unauthenticated senders
	 * @param toClientId - The recipient's client ID
	 * @returns True if the user is allowed to message this peer
	 */
	canMessagePeer(
		fromUserId: TUserId | undefined,
		toClientId: TToClientId,
	): boolean;

	/**
	 * Gets the rate limit for a user in messages per second.
	 * @param userId - The user ID, undefined for unauthenticated users
	 * @returns Maximum messages per second allowed for this user
	 */
	getRateLimit(userId: TUserId | undefined): number;
}

/**
 * Default authorization rules - permissive for development.
 * Allows all operations and sets a default rate limit of 100 messages/second.
 *
 * @example
 * ```typescript
 * const server = serve({
 *   authRules: new DefaultAuthorizationRules(),
 *   port: 8080
 * });
 * ```
 */
export class DefaultAuthorizationRules<
	TUserId extends string = string,
	TTopic extends string = string,
	TToClientId extends string = string,
> implements AuthorizationRules<TUserId, TTopic, TToClientId>
{
	canSubscribeToTopic(_userId: TUserId | undefined, _topic: TTopic): boolean {
		return true;
	}

	canPublishToTopic(_userId: TUserId | undefined, _topic: TTopic): boolean {
		return true;
	}

	canMessagePeer(
		_fromUserId: TUserId | undefined,
		_toClientId: TToClientId,
	): boolean {
		return true;
	}

	getRateLimit(_userId: TUserId | undefined): number {
		return 100; // 100 messages per second default
	}
}

/**
 * Configuration options for strict authorization rules.
 * @template TUserId - The user ID type
 * @template TTopic - The topic name type
 */
export interface StrictAuthorizationRulesOptions<
	TUserId extends string = string,
	TTopic extends string = string,
> {
	readonly adminUsers?: readonly TUserId[];
	readonly topicPermissions?: TopicPermissionsRecord<TUserId, TTopic>;
}

export type TopicPermissionsMap<
	TUserId extends string,
	TTopic extends string,
> = Map<TTopic, Set<TUserId>>;

export type TopicPermissionsRecord<
	TUserId extends string,
	TTopic extends string,
> = Record<TTopic, readonly TUserId[]>;

export function convertTopicPermissionsRecordToMap<
	TUserId extends string,
	TTopic extends string,
>(
	record: TopicPermissionsRecord<TUserId, TTopic>,
): TopicPermissionsMap<TUserId, TTopic> {
	const map: TopicPermissionsMap<TUserId, TTopic> = new Map();
	for (const [topic, users] of Object.entries<readonly TUserId[]>(record)) {
		map.set(topic as TTopic, new Set(users));
	}
	return map;
}

/**
 * Strict authorization rules with role-based access control.
 * Supports admin users, topic-specific permissions, and tiered rate limits.
 *
 * @example
 * ```typescript
 * const rules = new StrictAuthorizationRules(
 *   new Set(['admin-user-1', 'admin-user-2']),  // Admin users
 *   new Map([
 *     ['public-chat', new Set(['user-1', 'user-2', 'user-3'])],
 *     ['private-room', new Set(['user-1'])]
 *   ])
 * );
 *
 * const server = serve({
 *   authRules: rules,
 *   port: 8080
 * });
 * ```
 */
export class StrictAuthorizationRules<
	TUserId extends string = string,
	TTopic extends string = string,
	TToClientId extends string = string,
> implements AuthorizationRules<TUserId, TTopic, TToClientId>
{
	constructor(
		private readonly admins: Set<TUserId> = new Set(),
		private readonly topicPermissions: Map<TTopic, Set<TUserId>> = new Map(),
	) {}

	/**
	 * Admin users: 1000 msg/s
	 * Regular users: 50 msg/s
	 * Unauthenticated: 10 msg/s
	 */
	static RateLimits = {
		Unauthenticated: 10,
		User: 50,
		Admin: 1000,
	} as const;

	static FromOptions<
		const TUserId extends string = string,
		const TTopic extends string = string,
		const TToClientId extends string = string,
	>(
		options?: StrictAuthorizationRulesOptions<TUserId, TTopic>,
	): StrictAuthorizationRules<TUserId, TTopic, TToClientId> {
		const admins = new Set(options?.adminUsers);
		const topicPermissions = convertTopicPermissionsRecordToMap(
			options?.topicPermissions ??
				({} as TopicPermissionsRecord<TUserId, TTopic>),
		);
		return new StrictAuthorizationRules(admins, topicPermissions);
	}

	static FromAdmins<
		const TUserId extends string = string,
		const TTopic extends string = string,
		const TToClientId extends string = string,
	>(
		adminUsers: readonly TUserId[],
	): StrictAuthorizationRules<TUserId, TTopic, TToClientId> {
		return StrictAuthorizationRules.FromOptions({
			adminUsers: adminUsers,
			topicPermissions: {},
		});
	}

	static Default() {
		return new StrictAuthorizationRules();
	}

	canSubscribeToTopic(
		userId: TUserId | undefined | (string & {}),
		topic: TTopic | (string & {}),
	): boolean {
		if (!userId) {
			return false;
		}
		if (this.admins.has(userId as TUserId)) {
			return true;
		}

		const allowedUsers = this.topicPermissions.get(topic as TTopic);
		if (allowedUsers === undefined) {
			return false;
		}
		return allowedUsers.has(userId as TUserId);
	}

	canPublishToTopic(
		userId: TUserId | undefined | (string & {}),
		topic: TTopic | (string & {}),
	): boolean {
		return this.canSubscribeToTopic(userId, topic);
	}

	canMessagePeer(
		fromUserId: TUserId | undefined,
		_toClientId: TToClientId,
	): boolean {
		// Must be authenticated to send direct messages
		return fromUserId !== undefined;
	}

	getRateLimit(userId: TUserId | (string & {}) | undefined): number {
		// Unauthenticated: 10 msg/s
		if (userId === undefined) {
			return StrictAuthorizationRules.RateLimits.Unauthenticated;
		}
		// Admins: 1000 msg/s
		if (this.admins.has(userId as TUserId)) {
			return StrictAuthorizationRules.RateLimits.Admin;
		}
		return StrictAuthorizationRules.RateLimits.User;
	}
}

export interface Bucket {
	/** Current number of available tokens (fractional values allowed for smooth rate limiting). */
	tokens: number;
	/** Timestamp in milliseconds of the last token refill. */
	lastRefill: number;
}

/** Map of bucket names to their state for tracking multiple rate limits. */
export type BucketMap<TNames extends string = string> = Map<TNames, Bucket>;

/**
 * Configuration options for creating a RateLimiter.
 * @template TBucketMap - The bucket map type
 */
export interface RateLimiterOptions<TBucketMap extends BucketMap> {
	readonly capacity?: number;
	readonly refillRate?: number;
	readonly buckets?: TBucketMap;
}

/**
 * Rate limiter using the token bucket algorithm.
 *
 * Token bucket algorithm provides smooth rate limiting with burst support:
 * - Each bucket has a maximum capacity (burst size)
 * - Tokens refill continuously at a fixed rate
 * - Each action consumes one token
 * - Actions are allowed only if tokens are available
 *
 * @template TBucketNames - The bucket name type for tracking multiple keys
 *
 * @example
 * ```typescript
 * // 10 requests per second with burst of 20
 * const limiter = RateLimiter.FromOptions({
 *   capacity: 20,
 *   refillRate: 10
 * });
 *
 * if (limiter.tryConsume('user-123')) {
 *   // Allow request
 * } else {
 *   // Rate limit exceeded
 * }
 * ```
 */
export class RateLimiter<TBucketNames extends string = string> {
	constructor(
		/**
		 * Maximum tokens in bucket (burst capacity)
		 */
		public readonly capacity: number = RateLimiter.DefaultCapacity,
		/**
		 * Tokens per second
		 */
		public readonly refillRate: number = RateLimiter.DefaultRefillRate,
		private readonly buckets: BucketMap<TBucketNames> = new Map(),
	) {}

	static Default<
		TBucketNames extends string = string,
	>(): RateLimiter<TBucketNames> {
		return new RateLimiter();
	}

	static DefaultCapacity = 100 as const;
	static DefaultRefillRate = 100 as const;

	static FromOptions<const TBucketNames extends string = string>(
		options: RateLimiterOptions<BucketMap<TBucketNames>>,
	): RateLimiter<TBucketNames> {
		return new RateLimiter(
			options.capacity ?? RateLimiter.DefaultCapacity,
			options.refillRate ?? RateLimiter.DefaultRefillRate,
			options.buckets ?? new Map(),
		);
	}

	/**
	 * Attempts to consume a token for the given key.
	 * Automatically refills tokens based on elapsed time.
	 *
	 * Token bucket algorithm:
	 * 1. Calculate elapsed time since last refill
	 * 2. Add tokens: (elapsed_seconds * refillRate)
	 * 3. Cap tokens at capacity (max burst size)
	 * 4. If tokens >= 1, consume one token and allow action
	 * 5. Otherwise, reject action
	 *
	 * @param key - Unique identifier for this rate limit bucket (e.g., user ID)
	 * @returns True if action is allowed, false if rate limit exceeded
	 */
	tryConsume(key: TBucketNames): boolean {
		const now = Date.now();
		let bucket = this.buckets.get(key);

		// First request from this key - create new bucket with capacity-1 tokens
		if (!bucket) {
			bucket = { tokens: this.capacity - 1, lastRefill: now };
			this.buckets.set(key, bucket);
			return true;
		}

		// TOKEN BUCKET ALGORITHM:
		// Calculate tokens to add based on time elapsed
		const timePassed = (now - bucket.lastRefill) / 1000; // Convert to seconds
		const tokensToAdd = timePassed * this.refillRate;
		// Refill bucket, capped at maximum capacity
		bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
		bucket.lastRefill = now;

		// Try to consume one token
		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return true; // Action allowed
		}

		return false; // Rate limit exceeded
	}

	/**
	 * Clear rate limit tracking for a key
	 */
	clear(key: TBucketNames): void {
		this.buckets.delete(key);
	}

	/**
	 * Clear all rate limit tracking
	 */
	clearAll(): void {
		this.buckets.clear();
	}
}

/**
 * Authentication validator interface for verifying user credentials.
 * Implement this interface to provide custom authentication logic.
 * @template TAuthContext - The authentication context type
 * @template TTokenNames - The token string type
 */
export interface AuthValidator<
	TAuthContext extends AuthContext = AuthContext,
	TTokenNames extends string = string,
> {
	/**
	 * Validates an authentication token from request headers or query parameters.
	 * @param token - The authentication token to validate, or null if not provided
	 * @param request - The HTTP upgrade request
	 * @returns AuthContext if token is valid, null if invalid or unauthenticated
	 */
	validate(
		token: TTokenNames | null,
		request: Request,
	): Promise<TAuthContext | null> | TAuthContext | null;
}

/**
 * Token-user mapping for simple authentication.
 * @template TUserId - The user ID type
 */
export interface TokenItem<TUserId extends string = string> {
	/** The user ID associated with this token. */
	readonly userId: TUserId;
}

/** Map of authentication tokens to their associated user information. */
export type ValidTokensMap<
	TTokenNames extends string = string,
	TUserId extends string = string,
> = Map<TTokenNames, TokenItem<TUserId>>;

/**
 * Simple token-based authentication validator.
 * Uses a static map of valid tokens for authentication.
 * Suitable for development and simple applications.
 *
 * @example
 * ```typescript
 * // Using FromTokens helper
 * const validator = SimpleAuthValidator.FromTokens({
 *   'token-abc-123': 'user-1',
 *   'token-xyz-789': 'user-2'
 * });
 *
 * const server = serve({
 *   authValidator: validator,
 *   port: 8080
 * });
 *
 * // Adding tokens dynamically
 * validator.addToken('new-token-456', 'user-3');
 * validator.removeToken('token-abc-123');
 * ```
 */
export class SimpleAuthValidator<
	TTokenName extends string = string,
	TUserId extends string = string,
	TAuthContext extends AuthContext = AuthContext,
> implements AuthValidator<TAuthContext, TTokenName>
{
	constructor(
		private readonly validTokens: ValidTokensMap<
			TTokenName,
			TUserId
		> = new Map(),
	) {}

	static FromTokens<
		const TTokenName extends string = string,
		const TUserId extends string = string,
		const TAuthContext extends AuthContext = AuthContext,
	>(
		tokens: Record<TTokenName, TUserId>,
	): SimpleAuthValidator<TTokenName, TUserId, TAuthContext> {
		const validTokens: ValidTokensMap<TTokenName, TUserId> = new Map(
			Object.entries(tokens).map(([token, userId]) => [
				token as TTokenName,
				{ userId: userId as TUserId },
			]),
		);
		return new SimpleAuthValidator(validTokens);
	}
	/**
	 * Validates a token by checking if it exists in the valid tokens map.
	 * @param token - The authentication token to validate
	 * @returns AuthContext if valid, null otherwise
	 */ validate(token: TTokenName | null): TAuthContext | null {
		if (!token) return null;

		const user = this.validTokens.get(token);
		if (!user) return null;

		const result: TAuthContext = {
			userId: user.userId,
			permissions: new Set(["*"]),
			connectedAt: new Date(),
			lastActivityAt: new Date(),
		} as unknown as TAuthContext;
		return result;
	}

	/**
	 * Adds a valid token to the authentication system.
	 * @param token - The token string
	 * @param userId - The user ID to associate with this token
	 */
	addToken(token: TTokenName, userId: TUserId): void {
		this.validTokens.set(token, { userId });
	}

	/**
	 * Removes a token from the authentication system.
	 * Subsequent requests with this token will be rejected.
	 * @param token - The token to remove
	 */
	removeToken(token: TTokenName): void {
		this.validTokens.delete(token);
	}
}

/**
 * No-op authentication validator that allows all connections.
 * Useful for development, testing, or public servers.
 * All connections are granted full permissions.
 *
 * @example
 * ```typescript
 * const server = serve({
 *   authValidator: NoAuthValidator.Default(),
 *   port: 8080
 * });
 * ```
 */
export class NoAuthValidator<TAuthContext extends AuthContext = AuthContext>
	implements AuthValidator<TAuthContext>
{
	static Default<
		TAuthContext extends AuthContext = AuthContext,
	>(): NoAuthValidator<TAuthContext> {
		return new NoAuthValidator();
	}
	validate(_token: string | null): TAuthContext {
		return {
			permissions: new Set(["*"]),
			connectedAt: new Date(),
			lastActivityAt: new Date(),
		} as unknown as TAuthContext;
	}
}
