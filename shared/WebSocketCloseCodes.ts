/**
 * Standard WebSocket close codes as defined in RFC 6455.
 * @see https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
 */

/**
 * Normal closure; the connection successfully completed its purpose.
 *
 * @example
 * ```typescript
 * socket.close(WS_CLOSE_NORMAL, "Task completed successfully");
 * ```
 */
export const WS_CLOSE_NORMAL = 1000 as const;

/**
 * Going away; an endpoint is going away (e.g., server shutdown or browser navigating away).
 *
 * @example
 * ```typescript
 * // Server shutting down gracefully
 * ws.close(WS_CLOSE_GOING_AWAY, "Server maintenance");
 * ```
 */
export const WS_CLOSE_GOING_AWAY = 1001 as const;

/**
 * Protocol error; the endpoint is terminating due to a protocol error.
 *
 * @example
 * ```typescript
 * // Invalid message format received
 * ws.close(WS_CLOSE_PROTOCOL_ERROR, "Invalid frame format");
 * ```
 */
export const WS_CLOSE_PROTOCOL_ERROR = 1002 as const;

/**
 * Unsupported data; the endpoint received data it cannot accept
 * (e.g., text-only endpoint receiving binary data).
 *
 * @example
 * ```typescript
 * // Server only accepts JSON messages
 * ws.close(WS_CLOSE_UNSUPPORTED, "Only JSON messages supported");
 * ```
 */
export const WS_CLOSE_UNSUPPORTED = 1003 as const;

/**
 * Reserved; no status code was present. Cannot be set by application.
 *
 * @remarks
 * This code is reserved and cannot be used by applications.
 * It indicates that no status code was received when expected.
 */
export const WS_CLOSE_NO_STATUS = 1005 as const;

/**
 * Abnormal closure; indicates the connection was closed abnormally
 * (e.g., without sending/receiving a close frame). Cannot be set by application.
 *
 * @remarks
 * This code is reserved and cannot be used by applications.
 * It's used internally when the connection closes abnormally.
 */
export const WS_CLOSE_ABNORMAL = 1006 as const;

/**
 * Invalid frame payload data; the endpoint received inconsistent message data
 * (e.g., non-UTF-8 data in a text message).
 *
 * @example
 * ```typescript
 * // Received malformed UTF-8 in text frame
 * ws.close(WS_CLOSE_INVALID_DATA, "Invalid UTF-8 encoding");
 * ```
 */
export const WS_CLOSE_INVALID_DATA = 1007 as const;

/**
 * Policy violation; the endpoint is terminating because it received a message
 * that violates its policy.
 *
 * @example
 * ```typescript
 * // User violated rate limits
 * ws.close(WS_CLOSE_POLICY_VIOLATION, "Rate limit exceeded");
 * ```
 */
export const WS_CLOSE_POLICY_VIOLATION = 1008 as const;

/**
 * Message too big; the endpoint received a message that is too large to process.
 *
 * @example
 * ```typescript
 * // Message exceeds 1MB limit
 * ws.close(WS_CLOSE_MESSAGE_TOO_BIG, "Message size exceeds 1MB limit");
 * ```
 */
export const WS_CLOSE_MESSAGE_TOO_BIG = 1009 as const;

/**
 * Mandatory extension; the client expected the server to negotiate one or more
 * extensions, but the server didn't.
 *
 * @example
 * ```typescript
 * // Client requires compression extension
 * ws.close(WS_CLOSE_MANDATORY_EXTENSION, "permessage-deflate required");
 * ```
 */
export const WS_CLOSE_MANDATORY_EXTENSION = 1010 as const;

/**
 * Internal server error; the server encountered an unexpected condition that
 * prevented it from fulfilling the request.
 *
 * @example
 * ```typescript
 * // Database connection failed
 * ws.close(WS_CLOSE_INTERNAL_ERROR, "Internal server error");
 * ```
 */
export const WS_CLOSE_INTERNAL_ERROR = 1011 as const;

/**
 * Service restart; the service is restarting. The client may reconnect.
 *
 * @example
 * ```typescript
 * // Graceful restart
 * ws.close(WS_CLOSE_SERVICE_RESTART, "Service restarting, please reconnect");
 * ```
 */
export const WS_CLOSE_SERVICE_RESTART = 1012 as const;

/**
 * Try again later; the service is experiencing overload. The client should
 * try again later.
 *
 * @example
 * ```typescript
 * // Server at capacity
 * ws.close(WS_CLOSE_TRY_AGAIN_LATER, "Server overloaded, retry in 30s");
 * ```
 */
export const WS_CLOSE_TRY_AGAIN_LATER = 1013 as const;

/**
 * Bad gateway; the server was acting as a gateway or proxy and received an
 * invalid response from the upstream server.
 *
 * @example
 * ```typescript
 * // Upstream service unavailable
 * ws.close(WS_CLOSE_BAD_GATEWAY, "Upstream service unavailable");
 * ```
 */
export const WS_CLOSE_BAD_GATEWAY = 1014 as const;

/**
 * TLS handshake failure; the connection was closed due to a failure to
 * perform a TLS handshake. Cannot be set by application.
 *
 * @remarks
 * This code is reserved and cannot be used by applications.
 * It indicates a TLS-related connection failure.
 */
export const WS_CLOSE_TLS_HANDSHAKE = 1015 as const;

/**
 * Map of close codes to human-readable descriptions.
 *
 * @example
 * ```typescript
 * const description = WS_CLOSE_CODE_DESCRIPTIONS[1000];
 * console.log(description); // "Normal Closure"
 * ```
 */
export const WS_CLOSE_CODE_DESCRIPTIONS = {
	[WS_CLOSE_NORMAL]: "Normal Closure",
	[WS_CLOSE_GOING_AWAY]: "Going Away",
	[WS_CLOSE_PROTOCOL_ERROR]: "Protocol Error",
	[WS_CLOSE_UNSUPPORTED]: "Unsupported Data",
	[WS_CLOSE_NO_STATUS]: "No Status Received",
	[WS_CLOSE_ABNORMAL]: "Abnormal Closure",
	[WS_CLOSE_INVALID_DATA]: "Invalid Frame Payload Data",
	[WS_CLOSE_POLICY_VIOLATION]: "Policy Violation",
	[WS_CLOSE_MESSAGE_TOO_BIG]: "Message Too Big",
	[WS_CLOSE_MANDATORY_EXTENSION]: "Mandatory Extension",
	[WS_CLOSE_INTERNAL_ERROR]: "Internal Server Error",
	[WS_CLOSE_SERVICE_RESTART]: "Service Restart",
	[WS_CLOSE_TRY_AGAIN_LATER]: "Try Again Later",
	[WS_CLOSE_BAD_GATEWAY]: "Bad Gateway",
	[WS_CLOSE_TLS_HANDSHAKE]: "TLS Handshake Failure",
} as const;

WS_CLOSE_CODE_DESCRIPTIONS satisfies Readonly<Record<number, string>>;

export type WebSocketCloseCodeDescriptions = typeof WS_CLOSE_CODE_DESCRIPTIONS;
export type WebSocketCloseCode = keyof WebSocketCloseCodeDescriptions;
export type WebSocketCloseCodeDescription<
	TCode extends WebSocketCloseCode = WebSocketCloseCode,
> = WebSocketCloseCodeDescriptions[TCode];

/**
 * Check if a close code is reserved and cannot be set by application code.
 *
 * @param code - The WebSocket close code to check
 * @returns True if the code is reserved and cannot be used by applications
 *
 * @example
 * ```typescript
 * if (isReservedCloseCode(1006)) {
 *   console.log("Cannot use this code"); // This will log
 * }
 * ```
 */
export function isReservedCloseCode(
	code: WebSocketCloseCode | number,
): boolean {
	return (
		code === WS_CLOSE_NO_STATUS ||
		code === WS_CLOSE_ABNORMAL ||
		code === WS_CLOSE_TLS_HANDSHAKE
	);
}

/**
 * Check if a close code indicates the client can reconnect.
 *
 * @param code - The WebSocket close code to check
 * @returns True if the client should consider reconnecting
 *
 * @example
 * ```typescript
 * socket.addEventListener("close", (event) => {
 *   if (canReconnect(event.code)) {
 *     // Attempt to reconnect
 *     setTimeout(() => connect(), 1000);
 *   }
 * });
 * ```
 */
export function canReconnect(code: WebSocketCloseCode | number): boolean {
	return (
		code === WS_CLOSE_GOING_AWAY ||
		code === WS_CLOSE_ABNORMAL ||
		code === WS_CLOSE_INTERNAL_ERROR ||
		code === WS_CLOSE_SERVICE_RESTART ||
		code === WS_CLOSE_TRY_AGAIN_LATER ||
		code === WS_CLOSE_BAD_GATEWAY
	);
}

/**
 * Get a human-readable description for a close code.
 *
 * @param code - The WebSocket close code
 * @returns A description of the close code, or "Unknown" if not recognized
 *
 * @example
 * ```typescript
 * socket.addEventListener("close", (event) => {
 *   console.log(`Connection closed: ${getCloseCodeDescription(event.code)}`);
 *   // Output: "Connection closed: Normal Closure"
 * });
 * ```
 */
export function getCloseCodeDescription<
	const TCode extends WebSocketCloseCode = WebSocketCloseCode,
>(code: TCode | number): WebSocketCloseCodeDescription<TCode> | "Unknown" {
	return WS_CLOSE_CODE_DESCRIPTIONS[code as TCode] ?? "Unknown";
}
