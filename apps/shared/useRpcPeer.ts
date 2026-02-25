/** biome-ignore-all lint/suspicious/noExplicitAny: why */
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { RpcPeer } from "../../shared/RpcPeer.ts";

/**
 * Connection state for the RPC peer
 */
export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

/**
 * Options for useRpcPeer hook
 */
export interface UseRpcPeerOptions<
	TRequestSchema extends z.Schema<any>,
	TResponseSchema extends z.Schema<any>,
	TTopic extends string = string,
	TName extends string = string,
	TUrl extends string = string,
> {
	readonly url: TUrl;
	readonly name?: TName;
	readonly requestSchema: TRequestSchema;
	readonly responseSchema: TResponseSchema;
	readonly topic?: TTopic;
	readonly autoConnect?: boolean;
}

export type UseRpcPeerReturn<
	TRequestSchema extends z.Schema<any>,
	TResponseSchema extends z.Schema<any>,
> = {
	readonly peer: RpcPeer<TRequestSchema, TResponseSchema> | null;
	readonly connectionState: ConnectionState;
	readonly clientId: string | null;
	readonly error: Error | null;
	readonly connect: () => Promise<RpcPeer<TRequestSchema, TResponseSchema>>;
	readonly disconnect: () => Promise<void>;
};

/**
 * React hook for managing an RpcPeer connection
 *
 * @example
 * ```tsx
 * const { peer, connectionState, clientId, connect, disconnect } = useRpcPeer({
 *   url: "ws://localhost:8080",
 *   requestSchema: RequestSchema,
 *   responseSchema: ResponseSchema,
 *   autoConnect: true
 * });
 * ```
 */
export function useRpcPeer<
	const TRequestSchema extends z.Schema<any> = z.Schema<any>,
	const TResponseSchema extends z.Schema<any> = z.Schema<any>,
>(
	options: UseRpcPeerOptions<TRequestSchema, TResponseSchema>,
): UseRpcPeerReturn<TRequestSchema, TResponseSchema> {
	const [connectionState, setConnectionState] =
		useState<ConnectionState>("disconnected");
	const [clientId, setClientId] = useState<string | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const peerRef = useRef<RpcPeer<TRequestSchema, TResponseSchema> | null>(null);
	const {
		url,
		name,
		requestSchema,
		responseSchema,
		autoConnect = false,
	} = options;

	const mountedRef = useRef(true);

	const connect = async () => {
		if (peerRef.current && !peerRef.current.disposed) {
			return peerRef.current;
		}

		setConnectionState("connecting");
		setError(null);

		try {
			const peer = RpcPeer.FromOptions({
				url,
				name,
				requestSchema,
				responseSchema,
			});

			await peer.waitForWelcome();

			// Guard against state updates after unmount (React StrictMode / fast remounts)
			if (!mountedRef.current) {
				await peer.dispose();
				throw new Error("Component unmounted during connect");
			}

			peerRef.current = peer;
			if (peer.clientId === undefined) {
				throw new Error("Peer did not receive clientId from server");
			}
			setClientId(peer.clientId);
			setConnectionState("connected");

			return peer;
		} catch (err) {
			if (mountedRef.current) {
				setConnectionState("error");
				setError(err instanceof Error ? err : new Error(String(err)));
			}
			throw err;
		}
	};

	const disconnect = async () => {
		if (peerRef.current) {
			await peerRef.current.dispose();
			peerRef.current = null;
			setClientId(null);
			setConnectionState("disconnected");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: including it causes error
	useEffect(() => {
		mountedRef.current = true;

		if (autoConnect) {
			connect();
		}

		return () => {
			mountedRef.current = false;
			if (peerRef.current) {
				peerRef.current.dispose();
				peerRef.current = null;
			}
		};
	}, [autoConnect]);

	return {
		peer: peerRef.current,
		connectionState,
		clientId,
		error,
		connect,
		disconnect,
	};
}
