import { useEffect, useRef, useState } from "react";
import type z from "zod";
import type { Message } from "../../shared/types.ts";
import { useRpcPeer } from "../../shared/useRpcPeer.ts";
import { ChatRequestSchema, ChatResponseSchema } from "../shared/schema.ts";

export function ChatApp() {
	const [username, setUsername] = useState("");
	const [isJoined, setIsJoined] = useState(false);
	const [messages, setMessages] = useState<Message[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const { peer, connectionState, clientId, connect } = useRpcPeer({
		url: "ws://localhost:8080/chat",
		name: "ChatClient",
		requestSchema: ChatRequestSchema,
		responseSchema: ChatResponseSchema,
		autoConnect: false,
	});

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	// Set up message listener
	useEffect(() => {
		if (!peer) {
			return;
		}

		type ChatResponse = z.infer<typeof ChatResponseSchema>;
		peer.onNotification((data: ChatResponse, from?: string) => {
			switch (data.type) {
				case "message": {
					// Skip own messages — already added optimistically
					if (from === peer.clientId) break;
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: data.from,
							fromName: data.fromName,
							content: data.content,
							timestamp: data.timestamp,
						},
					]);
					break;
				}
				case "message-history": {
					setMessages((prev) => [
						...prev,
						...data.messages.map((msg) => ({
							id: crypto.randomUUID(),
							from: msg.from,
							fromName: msg.fromName,
							content: msg.content,
							timestamp: msg.timestamp,
						})),
					]);
					break;
				}
				case "user-joined": {
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: "system",
							fromName: "System",
							content: `${data.username} joined the chat`,
							timestamp: data.timestamp,
						},
					]);
					// Refresh user list asynchronously
					(async () => {
						try {
							const response = await peer.call({ type: "list-users" });
							if (response.data.type === "user-list") {
								setUsers(response.data.users);
							}
						} catch (error) {
							console.error("Failed to refresh user list:", error);
						}
					})();
					break;
				}
				case "user-left": {
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: "system",
							fromName: "System",
							content: `${data.username} left the chat`,
							timestamp: data.timestamp,
						},
					]);
					// Refresh user list asynchronously
					(async () => {
						try {
							const response = await peer.call({ type: "list-users" });
							if (response.data.type === "user-list") {
								setUsers(response.data.users);
							}
						} catch (error) {
							console.error("Failed to refresh user list:", error);
						}
					})();
					break;
				}
				case "user-list": {
					setUsers(data.users);
					break;
				}
				case "error": {
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							from: "system",
							fromName: "System",
							content: `Error: ${data.message}`,
							timestamp: Date.now(),
						},
					]);
					break;
				}
				default:
					console.warn("Unknown notification type:", data);
					break;
			}
		});
	}, [peer]);

	const handleJoin = async () => {
		if (!username.trim()) return;

		try {
			// Connect if not already connected
			if (connectionState !== "connected") {
				await connect();
				// Wait for React to update the peer reference
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			if (peer) {
				await peer.send({ type: "join", username: username.trim() });
				setIsJoined(true);

				// Get initial user list
				const response = await peer.call({ type: "list-users" });
				if (response.data.type === "user-list") {
					setUsers(response.data.users);
				}
			}
		} catch (error) {
			console.error("Failed to join:", error);
		}
	};

	const handleSendMessage = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!inputMessage.trim() || !peer || !isJoined) return;

		const messageContent = inputMessage.trim();
		const timestamp = Date.now();

		try {
			// Optimistically add message to local state immediately
			setMessages((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					from: clientId || "unknown",
					fromName: username,
					content: messageContent,
					timestamp,
				},
			]);
			setInputMessage("");

			// Send to server (fire-and-forget, server will broadcast to others)
			await peer.send({
				type: "message",
				content: messageContent,
				username,
			});
		} catch (error) {
			console.error("Failed to send message:", error);
		}
	};

	const getConnectionIndicator = () => {
		switch (connectionState) {
			case "connected":
				return <span style={{ color: "#4ade80" }}>● Connected</span>;
			case "connecting":
				return <span style={{ color: "#fbbf24" }}>● Connecting...</span>;
			case "error":
				return <span style={{ color: "#ef4444" }}>● Error</span>;
			default:
				return <span style={{ color: "#9ca3af" }}>● Disconnected</span>;
		}
	};

	if (!isJoined) {
		return (
			<div className="app">
				<div className="join-container">
					<h1>Chat Room</h1>
					<div className="card">
						<h2>Join the Chat</h2>
						<input
							type="text"
							placeholder="Enter your username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && handleJoin()}
							className="input"
							maxLength={50}
						/>
						<button
							type="button"
							onClick={handleJoin}
							disabled={!username.trim() || connectionState === "connecting"}
							className="button"
						>
							{connectionState === "connecting" ? "Connecting..." : "Join Chat"}
						</button>
						<div className="status">
							{getConnectionIndicator()}
							{clientId && (
								<span className="client-id">ID: {clientId.slice(0, 8)}</span>
							)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="app">
			<header className="header">
				<div>
					<h1>Chat Room</h1>
					<div className="status">
						{getConnectionIndicator()}
						<span className="username">@{username}</span>
					</div>
				</div>
			</header>

			<div className="main-content">
				<div className="users-panel">
					<h3>Online Users ({users.length})</h3>
					<ul className="user-list">
						{users.map((user) => (
							<li
								key={user.id}
								className={user.id === clientId ? "current-user" : ""}
							>
								{user.name}
								{user.id === clientId && " (you)"}
							</li>
						))}
					</ul>
				</div>

				<div className="chat-panel">
					<div className="messages">
						{messages.map((msg) => (
							<div
								key={msg.id}
								className={`message ${msg.from === clientId ? "own-message" : ""} ${
									msg.from === "system" ? "system-message" : ""
								}`}
							>
								<div className="message-header">
									<span className="message-author">{msg.fromName}</span>
									<span className="message-time">
										{new Date(msg.timestamp).toLocaleTimeString()}
									</span>
								</div>
								<div className="message-content">{msg.content}</div>
							</div>
						))}
						<div ref={messagesEndRef} />
					</div>

					<form onSubmit={handleSendMessage} className="message-input-form">
						<input
							type="text"
							placeholder="Type a message..."
							value={inputMessage}
							onChange={(e) => setInputMessage(e.target.value)}
							className="input"
							maxLength={1000}
						/>
						<button
							type="submit"
							disabled={!inputMessage.trim()}
							className="button"
						>
							Send
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}
