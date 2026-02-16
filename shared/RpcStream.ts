import { z } from "zod";

/**
 * Stream message types for different stream lifecycle events.
 * - StreamData: Contains payload data
 * - StreamEnd: Indicates stream completed successfully
 * - StreamError: Indicates stream encountered an error
 */
export type StreamMessageType = "StreamData" | "StreamEnd" | "StreamError";

/**
 * Error message sent when a stream encounters an error.
 * @template TStreamId - The stream identifier type
 * @template TError - The error message type
 */
export interface StreamErrorMessage<
	TStreamId extends string = string,
	TError extends string = string,
> {
	readonly type: "StreamError";
	readonly streamId: TStreamId;
	readonly error: TError;
}

/**
 * Data message containing a payload chunk from the stream.
 * @template TStreamId - The stream identifier type
 * @template TPayload - The payload data type
 */
export interface StreamDataMessage<
	TStreamId extends string = string,
	TPayload = unknown,
> {
	readonly type: "StreamData";
	readonly streamId: TStreamId;
	readonly payload: TPayload;
}

/**
 * End message indicating the stream has completed successfully.
 * @template TStreamId - The stream identifier type
 */
export interface StreamEndMessage<TStreamId extends string = string> {
	readonly type: "StreamEnd";
	readonly streamId: TStreamId;
}

/**
 * Type representing a valid UUID v4 string format.
 */
export type RandomUUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Base interface for stream messages sent over WebSocket
 * @template TPayload - Type of the payload data
 * @template TStreamId - Type of the stream identifier
 * @template TError - Type of the error message
 */
export type StreamMessage<
	TPayload = unknown,
	TStreamId extends string = string,
	TError extends string = string,
> =
	| StreamDataMessage<TStreamId, TPayload>
	| StreamEndMessage<TStreamId>
	| StreamErrorMessage<TStreamId, TError>;

/**
 * Zod schema for validating stream messages
 */
export const StreamMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("StreamData"),
		streamId: z.string(),
		payload: z.unknown(),
	}),
	z.object({
		type: z.literal("StreamEnd"),
		streamId: z.string(),
	}),
	z.object({
		type: z.literal("StreamError"),
		streamId: z.string(),
		error: z.string(),
	}),
]);

/**
 * Configuration options for stream handling
 */
export interface StreamManagerOptions<TStreamNames extends string = string> {
	/**
	 * Maximum buffered amount in bytes before applying backpressure
	 * @default 1048576 (1MB)
	 */
	readonly maxBufferedAmount?: number;

	/**
	 * Delay in milliseconds when waiting for buffer to drain
	 * @default 10
	 */
	readonly backpressureDelay?: number;
	readonly activeStreams?: Map<TStreamNames, ActiveStreamState>;
	readonly receivingStreams?: Map<TStreamNames, ReceivingStreamState<unknown>>;
}

/**
 * Internal structure for tracking active streams being sent
 */
export interface ActiveStreamState<
	TIterator extends AsyncIterator<unknown> = AsyncIterator<unknown>,
> {
	readonly iterator: TIterator;
	readonly abortController: AbortController;
}

/**
 * Internal structure for tracking streams being received
 */
export interface ReceivingStreamState<TStream = unknown> {
	readonly controller: ReadableStreamDefaultController<TStream>;
	readonly stream: ReadableStream<TStream>;
}

/**
 * Interface for WebSocket-like objects that can send data and track buffer amount.
 * Used for abstraction to allow testing and custom transport implementations.
 * @template TData - The data type that can be sent (typically string)
 */
export interface Sendable<TData = string> {
	/** Function to send data over the transport. */
	readonly send: (data: TData) => void;
	/** Number of bytes queued but not yet sent. Used for backpressure. */
	readonly bufferedAmount?: number;
}

/**
 * Manages multiple concurrent streams over a single WebSocket connection.
 * Handles multiplexing, backpressure, and resource cleanup.
 */
export class StreamManager {
	constructor(
		private readonly maxBufferedAmount: number = StreamManager.DefaultMaxBufferedAmount,
		private readonly backpressureDelay: number = StreamManager.DefaultBackpressureDelay,
		private readonly activeStreams = new Map<string, ActiveStreamState>(),
		private readonly receivingStreams = new Map<
			string,
			ReceivingStreamState<unknown>
		>(),
	) {}

	static DefaultMaxBufferedAmount = 1_048_576 as const; // 1MB
	static DefaultBackpressureDelay = 10 as const; // 10ms
	static ErrorMessages = {
		StreamAborted: "Stream aborted",
		StreamAbortedDuringBackpressure: "Stream aborted during backpressure wait",
		FailedToSendMessage: "Failed to send stream message",
	} as const;
	static MessageType = {
		StreamData: "StreamData",
		StreamEnd: "StreamEnd",
		StreamError: "StreamError",
	} as const;
	static Message = {
		StreamData<
			const TStreamId extends string = string,
			const TPayload = unknown,
		>(
			streamId: TStreamId,
			payload: TPayload,
		): StreamMessage<TPayload, TStreamId> {
			return {
				type: StreamManager.MessageType.StreamData,
				streamId,
				payload,
			};
		},
		StreamEnd<const TStreamId extends string = string>(
			streamId: TStreamId,
		): StreamMessage<undefined, TStreamId> {
			return {
				type: StreamManager.MessageType.StreamEnd,
				streamId,
			};
		},
		StreamError<
			const TStreamId extends string = string,
			const TError extends string = string,
		>(
			streamId: TStreamId,
			error: TError,
		): StreamMessage<undefined, TStreamId, TError> {
			return {
				type: StreamManager.MessageType.StreamError,
				streamId,
				error,
			};
		},
	} as const;

	/**
	 * Creates a StreamManager instance from options
	 * @param options - StreamOptions to configure the StreamManager
	 * @returns StreamManager instance configured with the provided options
	 */
	static FromOptions(options?: StreamManagerOptions): StreamManager {
		return new StreamManager(
			options?.maxBufferedAmount ?? StreamManager.DefaultMaxBufferedAmount,
			options?.backpressureDelay ?? StreamManager.DefaultBackpressureDelay,
			options?.activeStreams ?? new Map(),
			options?.receivingStreams ?? new Map(),
		);
	}

	/**
	 * Generates a unique stream ID
	 */
	private generateStreamId(): RandomUUID {
		return crypto.randomUUID();
	}

	/**
	 * Sends an AsyncIterable as a stream over the WebSocket.
	 * Handles backpressure automatically by monitoring buffer size and pausing when needed.
	 *
	 * @template TValue - The type of items in the iterable
	 * @param ws - WebSocket-like object to send data through
	 * @param iterable - AsyncIterable to stream
	 * @param streamId - Optional custom stream ID (auto-generated if not provided)
	 * @returns Promise that resolves with the stream ID when stream completes
	 * @throws {Error} If stream is aborted or message sending fails
	 *
	 * @example
	 * ```typescript
	 * async function* generateData() {
	 *   for (let i = 0; i < 100; i++) {
	 *     yield { count: i };
	 *   }
	 * }
	 *
	 * const streamId = await manager.sendStream(ws, generateData());
	 * ```
	 */
	async sendStream<
		const TValue = unknown,
		const TStreamId extends string = string,
	>(
		ws: Sendable<string>,
		iterable: AsyncIterable<TValue>,
		streamId?: TStreamId,
	): Promise<string | never> {
		const id = streamId ?? this.generateStreamId();
		const iterator = iterable[Symbol.asyncIterator]();
		const abortController = new AbortController();

		this.activeStreams.set(id, { iterator, abortController });

		const send = <const TMessage extends StreamMessage = StreamMessage>(
			message: TMessage,
		): undefined | never => {
			try {
				ws.send(JSON.stringify(message));
			} catch (err) {
				console.debug(err);
				throw new Error(StreamManager.ErrorMessages.FailedToSendMessage);
			}
		};

		try {
			while (true) {
				// Check if stream was aborted by user or error
				if (abortController.signal.aborted) {
					throw new Error(StreamManager.ErrorMessages.StreamAborted);
				}

				// BACKPRESSURE: Wait for buffer to drain if it's too full
				// This prevents memory issues when sending data faster than network can transmit
				if (ws.bufferedAmount !== undefined) {
					while (ws.bufferedAmount > this.maxBufferedAmount) {
						await new Promise((resolve) =>
							global.setTimeout(resolve, this.backpressureDelay),
						);
						// Check for abort during backpressure wait
						if (abortController.signal.aborted) {
							throw new Error(
								StreamManager.ErrorMessages.StreamAbortedDuringBackpressure,
							);
						}
					}
				}

				const result = await iterator.next();

				if (result.done) {
					send(StreamManager.Message.StreamEnd(id));
					break;
				}

				send(StreamManager.Message.StreamData(id, result.value));
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			send(StreamManager.Message.StreamError(id, errorMessage));
			throw err;
		} finally {
			this.activeStreams.delete(id);
		}

		return id;
	}

	/**
	 * Creates a ReadableStream that will receive data for the given stream ID
	 * @template T - The type of items in the stream
	 * @param streamId - Optional stream ID to use (auto-generated if not provided)
	 * @returns Tuple of [streamId, ReadableStream]
	 */
	createReceivingStream<T = unknown>(
		streamId?: string,
	): [string, ReadableStream<T>] {
		const id = streamId ?? this.generateStreamId();
		let streamInstance: ReadableStream<T>;

		const stream = new ReadableStream<T>({
			start: (controller) => {
				this.receivingStreams.set(id, {
					controller: controller as ReadableStreamDefaultController<unknown>,
					stream: streamInstance as ReadableStream<unknown>,
				});
			},
			cancel: () => {
				this.receivingStreams.delete(id);
			},
		});

		streamInstance = stream;
		return [id, stream];
	}

	/**
	 * Handles an incoming stream message
	 * @param message - Stream message to handle
	 * @returns true if message was handled successfully
	 */
	handleStreamMessage<const TMessage extends StreamMessage = StreamMessage>(
		message: TMessage,
	): boolean {
		const parsed = StreamMessageSchema.safeParse(message);
		if (!parsed.success) {
			console.warn("[StreamManager] Invalid stream message:", parsed.error);
			return false;
		}

		const streamState = this.receivingStreams.get(message.streamId);
		if (!streamState) {
			console.warn(
				`[StreamManager] Received message for unknown stream: ${message.streamId}`,
			);
			return false;
		}

		const { controller } = streamState;

		try {
			switch (message.type) {
				case StreamManager.MessageType.StreamData:
					controller.enqueue(message.payload);
					break;
				case StreamManager.MessageType.StreamEnd:
					controller.close();
					this.receivingStreams.delete(message.streamId);
					break;
				case StreamManager.MessageType.StreamError:
					controller.error(new Error(message.error));
					this.receivingStreams.delete(message.streamId);
					break;
			}
			return true;
		} catch (err) {
			console.warn("[StreamManager] Error handling stream message:", err);
			return false;
		}
	}

	/**
	 * Checks if a message is a stream message
	 */
	isStreamMessage<TStreamId extends string = string>(
		message: unknown,
	): message is StreamMessage<unknown, TStreamId> {
		const result = StreamMessageSchema.safeParse(message);
		return result.success;
	}

	/**
	 * Aborts an active outgoing stream
	 * @param streamId - ID of the stream to abort
	 */
	abort<const TStreamId extends string>(streamId: TStreamId): void {
		const stream = this.activeStreams.get(streamId);
		if (stream) {
			stream.abortController.abort();
			// Try to clean up the iterator
			if (stream.iterator.return) {
				stream.iterator.return().catch((err) => {
					console.warn(`[StreamManager] Error cleaning up iterator: ${err}`);
				});
			}
			this.activeStreams.delete(streamId);
		}
	}

	/**
	 * Closes a receiving stream
	 * @param streamId - ID of the stream to close
	 */
	closeReceivingStream(streamId: string): void {
		const stream = this.receivingStreams.get(streamId);
		if (stream) {
			try {
				stream.controller.close();
			} catch {
				// Stream might already be closed
				console.debug(`[StreamManager] Stream already closed: ${streamId}`);
			}
			this.receivingStreams.delete(streamId);
		}
	}

	/**
	 * Cleans up all active streams (both sending and receiving)
	 * Should be called when the WebSocket connection closes
	 */
	cleanup(): void {
		// Abort all active outgoing streams
		for (const [streamId, stream] of this.activeStreams.entries()) {
			stream.abortController.abort();
			if (stream.iterator.return) {
				stream.iterator.return().catch((err) => {
					console.warn(
						`[StreamManager] Error cleaning up iterator ${streamId}: ${err}`,
					);
				});
			}
		}
		this.activeStreams.clear();

		// Close all receiving streams
		for (const [streamId, stream] of this.receivingStreams.entries()) {
			try {
				stream.controller.error(new Error("Connection closed"));
			} catch (err) {
				// Stream might already be closed
				console.debug(
					`[StreamManager] Error closing receiving stream ${streamId}:`,
					err,
				);
			}
		}
		this.receivingStreams.clear();
	}

	/**
	 * Gets the count of active outgoing streams
	 */
	get activeStreamCount(): number {
		return this.activeStreams.size;
	}

	/**
	 * Gets the count of active receiving streams
	 */
	get receivingStreamCount(): number {
		return this.receivingStreams.size;
	}
}
