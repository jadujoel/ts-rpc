import { z } from "zod";

/**
 * Authentication token schema
 */
export const AuthTokenSchema = z.object({
	token: z.string().min(1),
	userId: z.string().optional(),
	sessionId: z.string().optional(),
});

export type AuthToken = z.infer<typeof AuthTokenSchema>;

/**
 * Authentication context attached to WebSocket connections
 */
export interface AuthContext<
	TUserIds extends string = string,
	TSessionIds extends string = string,
	TPermissions extends string = string,
> {
	readonly userId?: TUserIds;
	readonly sessionId?: TSessionIds;
	readonly permissions: Set<TPermissions>;
	readonly connectedAt: Date;
	readonly lastActivityAt: Date;
}

/**
 * Authorization rules for topics and peer-to-peer messaging
 */
export interface AuthorizationRules<
	TUserId extends string = string,
	TTopic extends string = string,
	TToClientId extends string = string,
> {
	/**
	 * Check if user can subscribe to a topic
	 */
	canSubscribeToTopic(userId: TUserId | undefined, topic: TTopic): boolean;

	/**
	 * Check if user can send messages to a topic
	 */
	canPublishToTopic(userId: TUserId | undefined, topic: TTopic): boolean;

	/**
	 * Check if user can send direct messages to another peer
	 */
	canMessagePeer(
		fromUserId: TUserId | undefined,
		toClientId: TToClientId,
	): boolean;

	/**
	 * Get rate limit for user (messages per second)
	 */
	getRateLimit(userId: TUserId | undefined): number;
}

/**
 * Default authorization rules - permissive for development
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

export interface StrictAuthorizationRulesOptions<
	TUserId extends string = string,
	TTopic extends string = string,
> {
	readonly adminUsers?: readonly TUserId[] | Set<TUserId>;
	readonly topicPermissions?: Map<TTopic, Set<TUserId>>;
}

/**
 * Example strict authorization rules
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
		options: StrictAuthorizationRulesOptions<TUserId, TTopic>,
	): StrictAuthorizationRules<TUserId, TTopic, TToClientId> {
		const admins =
			options.adminUsers instanceof Set
				? options.adminUsers
				: new Set(options.adminUsers);
		const topicPermissions = options.topicPermissions || new Map();
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
			adminUsers: new Set(adminUsers),
		});
	}

	canSubscribeToTopic(
		userId: TUserId | undefined | (string & {}),
		topic: TTopic,
	): boolean {
		if (!userId) {
			return false;
		}
		if (this.admins.has(userId as TUserId)) {
			return true;
		}

		const allowedUsers = this.topicPermissions.get(topic);
		return allowedUsers ? allowedUsers.has(userId as TUserId) : false;
	}

	canPublishToTopic(userId: TUserId | undefined, topic: TTopic): boolean {
		return this.canSubscribeToTopic(userId, topic);
	}

	canMessagePeer(
		fromUserId: TUserId | undefined,
		_toClientId: TToClientId,
	): boolean {
		// Must be authenticated to send direct messages
		return fromUserId !== undefined;
	}

	getRateLimit(userId: TUserId | undefined): number {
		// Unauthenticated: 10 msg/s
		if (!userId) {
			return StrictAuthorizationRules.RateLimits.Unauthenticated;
		}
		// Admins: 1000 msg/s
		if (this.admins.has(userId)) {
			return StrictAuthorizationRules.RateLimits.Admin;
		}
		return StrictAuthorizationRules.RateLimits.User;
	}
}

export interface Bucket {
	tokens: number;
	lastRefill: number;
}

export type BucketMap<TNames extends string = string> = Map<TNames, Bucket>;

export interface RateLimiterOptions<TBucketMap extends BucketMap> {
	readonly capacity?: number;
	readonly refillRate?: number;
	readonly buckets?: TBucketMap;
}

/**
 * Rate limiter using token bucket algorithm
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
	 * Check if action is allowed and consume a token
	 */
	tryConsume(key: TBucketNames): boolean {
		const now = Date.now();
		let bucket = this.buckets.get(key);

		if (!bucket) {
			bucket = { tokens: this.capacity - 1, lastRefill: now };
			this.buckets.set(key, bucket);
			return true;
		}

		// Refill tokens based on time passed
		const timePassed = (now - bucket.lastRefill) / 1000;
		const tokensToAdd = timePassed * this.refillRate;
		bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
		bucket.lastRefill = now;

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return true;
		}

		return false;
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
 * Authentication validator interface
 */
export interface AuthValidator<
	TAuthContext extends AuthContext = AuthContext,
	TTokenNames extends string = string,
> {
	/**
	 * Validate authentication token from request headers
	 * @returns AuthContext if valid, null if invalid
	 */
	validate(
		token: TTokenNames | null,
		request: Request,
	): Promise<TAuthContext | null> | TAuthContext | null;
}

export interface TokenItem<TUserId extends string = string> {
	readonly userId: TUserId;
}

export type ValidTokensMap<
	TTokenNames extends string = string,
	TUserId extends string = string,
> = Map<TTokenNames, TokenItem<TUserId>>;

/**
 * Simple token-based authentication validator
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

	validate(token: TTokenName | null): TAuthContext | null {
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
	 * Add a valid token
	 */
	addToken(token: TTokenName, userId: TUserId): void {
		this.validTokens.set(token, { userId });
	}

	/**
	 * Remove a token
	 */
	removeToken(token: TTokenName): void {
		this.validTokens.delete(token);
	}
}

/**
 * No-op authentication validator (allows all connections)
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
