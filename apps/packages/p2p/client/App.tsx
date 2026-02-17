import { useEffect, useRef, useState } from "react";
import type { MatchHandler } from "../../../../shared/RpcPeer.ts";
import { useRpcPeer } from "../../../shared/useRpcPeer.ts";
import {
	P2PRequestSchema,
	type P2PResponse,
	P2PResponseSchema,
} from "../shared/schema.ts";

interface Peer {
	id: string;
	name: string;
	connectedAt: number;
}

interface Message {
	id: string;
	from: string;
	fromName: string;
	content: string;
	timestamp: number;
	type: "direct" | "broadcast";
	to?: string;
}

export function P2PApp() {
	const [name, setName] = useState("");
	const [isConnected, setIsConnected] = useState(false);
	const [peers, setPeers] = useState<Peer[]>([]);
	const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const [messageMode, setMessageMode] = useState<"direct" | "broadcast">(
		"direct",
	);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const { peer, connectionState, clientId, connect } = useRpcPeer({
		url: "ws://localhost:8082/p2p",
		name: "P2PClient",
		requestSchema: P2PRequestSchema,
		responseSchema: P2PResponseSchema,
		autoConnect: false,
	});

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	useEffect(() => {
		if (!peer) return;

		peer.match<MatchHandler<P2PResponse>>((data: P2PResponse) => {
			switch (data.type) {
				case "direct-message":
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: data.from,
							fromName: data.fromName,
							content: data.content,
							timestamp: data.timestamp,
							type: "direct",
							to: clientId || undefined,
						},
					]);
					break;

				case "broadcast-message":
					if (data.from !== clientId) {
						setMessages((prev) => [
							...prev,
							{
								id: crypto.randomUUID(),
								from: data.from,
								fromName: data.fromName,
								content: data.content,
								timestamp: data.timestamp,
								type: "broadcast",
							},
						]);
					}
					break;
			}

			return null;
		});

		// Set up polling for peer list
		const pollPeers = async () => {
			try {
				const response = await peer.call({ type: "list-peers" });
				if (response.data.type === "peer-list") {
					setPeers(response.data.peers);
				}
			} catch (error) {
				console.error("Failed to fetch peers:", error);
			}
		};

		pollPeers();
		const interval = setInterval(pollPeers, 3000);

		return () => clearInterval(interval);
	}, [peer, clientId]);

	const handleConnect = async () => {
		if (!name.trim()) return;

		try {
			const _url = `ws://localhost:8082/p2p?name=${encodeURIComponent(name.trim())}`;
			const _newPeer = await connect();
			setIsConnected(true);
		} catch (error) {
			console.error("Failed to connect:", error);
		}
	};

	const handleSendMessage = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!inputMessage.trim() || !peer || !isConnected) return;

		try {
			if (messageMode === "broadcast") {
				await peer.send({
					type: "broadcast-message",
					content: inputMessage.trim(),
					from: clientId || "",
					fromName: name,
				});

				// Add to local messages
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						from: clientId || "",
						fromName: name,
						content: inputMessage.trim(),
						timestamp: Date.now(),
						type: "broadcast",
					},
				]);
			} else {
				if (!selectedPeer) {
					alert("Please select a peer to send a direct message");
					return;
				}

				const response = await peer.request(
					{
						type: "direct-message",
						content: inputMessage.trim(),
						from: clientId || "",
						fromName: name,
					},
					selectedPeer,
				);

				// Add to local messages
				if (response.data.type !== "error") {
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: clientId || "",
							fromName: name,
							content: inputMessage.trim(),
							timestamp: Date.now(),
							type: "direct",
							to: selectedPeer,
						},
					]);
				}
			}

			setInputMessage("");
		} catch (error) {
			console.error("Failed to send message:", error);
		}
	};

	const getConnectionIndicator = () => {
		switch (connectionState) {
			case "connected":
				return <span style={{ color: "#10b981" }}>● Connected</span>;
			case "connecting":
				return <span style={{ color: "#f59e0b" }}>● Connecting...</span>;
			case "error":
				return <span style={{ color: "#ef4444" }}>● Error</span>;
			default:
				return <span style={{ color: "#9ca3af" }}>● Disconnected</span>;
		}
	};

	if (!isConnected) {
		return (
			<div className="app">
				<div className="join-container">
					<h1>Peer-to-Peer Demo</h1>
					<div className="card">
						<h2>Connect to Network</h2>
						<input
							type="text"
							placeholder="Enter your name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && handleConnect()}
							className="input"
							maxLength={50}
						/>
						<button
							type="button"
							onClick={handleConnect}
							disabled={!name.trim() || connectionState === "connecting"}
							className="button"
						>
							{connectionState === "connecting" ? "Connecting..." : "Connect"}
						</button>
						<div className="status">{getConnectionIndicator()}</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="app">
			<header className="header">
				<div>
					<h1>Peer-to-Peer Messaging</h1>
					<div className="status">
						{getConnectionIndicator()}
						<span className="username">@{name}</span>
						<span className="client-id">ID: {clientId?.slice(0, 8)}</span>
					</div>
				</div>
			</header>

			<div className="main-content">
				<div className="peers-panel">
					<h3>Connected Peers ({peers.length})</h3>
					<div className="peer-list">
						{peers.map((p) => (
							<button
								key={p.id}
								type="button"
								className={`peer-item ${selectedPeer === p.id ? "selected" : ""} ${
									p.id === clientId ? "current-peer" : ""
								}`}
								onClick={() => {
									if (p.id !== clientId) {
										setSelectedPeer(p.id);
										setMessageMode("direct");
									}
								}}
								disabled={p.id === clientId}
							>
								<div className="peer-name">
									{p.name}
									{p.id === clientId && " (you)"}
								</div>
								<div className="peer-id">{p.id.slice(0, 8)}</div>
							</button>
						))}
					</div>
				</div>

				<div className="chat-panel">
					<div className="messages">
						{messages.map((msg) => {
							const isOwnMessage = msg.from === clientId;
							const isDirect = msg.type === "direct";

							return (
								<div
									key={msg.id}
									className={`message ${isOwnMessage ? "own-message" : ""} ${
										isDirect ? "direct-message" : "broadcast-message"
									}`}
								>
									<div className="message-header">
										<span className="message-author">
											{msg.fromName}
											{isDirect && (
												<span className="message-badge">
													{isOwnMessage
														? `→ ${peers.find((p) => p.id === msg.to)?.name || "Unknown"}`
														: "Direct"}
												</span>
											)}
											{!isDirect && (
												<span className="message-badge">Broadcast</span>
											)}
										</span>
										<span className="message-time">
											{new Date(msg.timestamp).toLocaleTimeString()}
										</span>
									</div>
									<div className="message-content">{msg.content}</div>
								</div>
							);
						})}
						<div ref={messagesEndRef} />
					</div>

					<div className="message-input-container">
						<div className="mode-selector">
							<button
								type="button"
								className={`mode-button ${messageMode === "direct" ? "active" : ""}`}
								onClick={() => setMessageMode("direct")}
							>
								🎯 Direct
								{messageMode === "direct" && selectedPeer && (
									<span className="target-peer">
										→ {peers.find((p) => p.id === selectedPeer)?.name}
									</span>
								)}
							</button>
							<button
								type="button"
								className={`mode-button ${messageMode === "broadcast" ? "active" : ""}`}
								onClick={() => setMessageMode("broadcast")}
							>
								📢 Broadcast
							</button>
						</div>

						<form onSubmit={handleSendMessage} className="message-input-form">
							<input
								type="text"
								placeholder={
									messageMode === "direct"
										? selectedPeer
											? "Type a direct message..."
											: "Select a peer first..."
										: "Type a broadcast message..."
								}
								value={inputMessage}
								onChange={(e) => setInputMessage(e.target.value)}
								className="input"
								maxLength={1000}
								disabled={messageMode === "direct" && !selectedPeer}
							/>
							<button
								type="submit"
								disabled={
									!inputMessage.trim() ||
									(messageMode === "direct" && !selectedPeer)
								}
								className="button"
							>
								Send
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}
