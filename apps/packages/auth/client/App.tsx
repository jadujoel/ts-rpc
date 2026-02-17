import { useEffect, useState } from "react";
import { RpcPeer } from "../../../../shared/RpcPeer.ts";
import {
	AuthRequestSchema,
	type AuthResponse,
	AuthResponseSchema,
} from "../shared/schema.ts";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

interface Profile {
	userId: string;
	role: "admin" | "user";
	rateLimit: number;
	permissions: string[];
}

export function AuthApp() {
	const [token, setToken] = useState("");
	const [isConnected, setIsConnected] = useState(false);
	const [connectionState, setConnectionState] =
		useState<ConnectionState>("disconnected");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [clientId, setClientId] = useState<string | null>(null);
	const [logs, setLogs] = useState<string[]>([]);
	const [peer, setPeer] = useState<RpcPeer<
		typeof AuthRequestSchema,
		typeof AuthResponseSchema
	> | null>(null);

	const addLog = (message: string) => {
		const timestamp = new Date().toLocaleTimeString();
		setLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
	};

	const handleConnect = async () => {
		if (!token) {
			addLog("❌ Token required");
			return;
		}

		setConnectionState("connecting");
		addLog(`🔄 Connecting with token: ${token}...`);

		try {
			const url = `ws://localhost:8081/auth-demo?token=${encodeURIComponent(token)}`;
			const newPeer = RpcPeer.FromOptions({
				url,
				name: "AuthClient",
				requestSchema: AuthRequestSchema,
				responseSchema: AuthResponseSchema,
			});

			await newPeer.waitForWelcome();

			setPeer(newPeer);
			setClientId(newPeer.clientId);
			setIsConnected(true);
			setConnectionState("connected");
			addLog(`✅ Connected! Client ID: ${newPeer.clientId}`);

			// Get profile info
			const profileResponse = await newPeer.call({ type: "get-profile" });
			if (profileResponse.data.type === "profile") {
				setProfile({
					userId: profileResponse.data.userId,
					role: profileResponse.data.role,
					rateLimit: profileResponse.data.rateLimit,
					permissions: profileResponse.data.permissions,
				});
				addLog(
					`👤 Profile loaded: ${profileResponse.data.userId} (${profileResponse.data.role})`,
				);
			}
		} catch (error) {
			setConnectionState("error");
			addLog(
				`❌ Connection failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const handleDisconnect = async () => {
		if (peer) {
			await peer.dispose();
			setPeer(null);
			setIsConnected(false);
			setConnectionState("disconnected");
			setProfile(null);
			setClientId(null);
			addLog("🔌 Disconnected");
		}
	};

	const handleProtectedAction = async () => {
		if (!peer) return;
		addLog("📤 Sending protected action...");

		try {
			const response = await peer.call({
				type: "protected-action",
				action: "view-dashboard",
			});

			if (response.data.type === "action-result") {
				addLog(`✅ ${response.data.message}`);
			} else if (response.data.type === "error") {
				addLog(`❌ ${response.data.message}`);
			}
		} catch (error) {
			addLog(
				`❌ Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const handleAdminAction = async () => {
		if (!peer) return;
		addLog("📤 Sending admin action...");

		try {
			const response = await peer.call({
				type: "admin-action",
				action: "delete-all-users",
			});

			if (response.data.type === "action-result") {
				addLog(`✅ ${response.data.message}`);
			} else if (response.data.type === "error") {
				addLog(`❌ ${response.data.message}`);
			}
		} catch (error) {
			addLog(
				`❌ Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const handlePing = async () => {
		if (!peer) return;
		addLog("📤 Sending ping...");

		try {
			const response = await peer.call({ type: "ping" });
			if (response.data.type === "pong") {
				const latency = Date.now() - response.data.timestamp;
				addLog(`🏓 Pong received! Latency: ${latency}ms`);
			}
		} catch (error) {
			addLog(
				`❌ Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const getConnectionIndicator = () => {
		switch (connectionState) {
			case "connected":
				return <span className="status-indicator connected">● Connected</span>;
			case "connecting":
				return (
					<span className="status-indicator connecting">● Connecting...</span>
				);
			case "error":
				return <span className="status-indicator error">● Error</span>;
			default:
				return (
					<span className="status-indicator disconnected">● Disconnected</span>
				);
		}
	};

	return (
		<div className="app">
			<header className="header">
				<h1>Authentication & Authorization Demo</h1>
				<div className="header-status">{getConnectionIndicator()}</div>
			</header>

			<div className="main-content">
				<div className="left-panel">
					<div className="card">
						<h2>Connection</h2>
						{!isConnected ? (
							<div className="connection-form">
								<div className="form-group">
									<label>Authentication Token</label>
									<select
										value={token}
										onChange={(e) => setToken(e.target.value)}
										className="input"
									>
										<option value="">-- Select Token --</option>
										<option value="admin-token">admin-token (Admin)</option>
										<option value="user-token">
											user-token (Regular User)
										</option>
										<option value="demo-token">demo-token (Demo User)</option>
										<option value="invalid-token">
											invalid-token (Will Fail)
										</option>
									</select>
								</div>
								<button
									onClick={handleConnect}
									disabled={!token || connectionState === "connecting"}
									className="button primary"
								>
									{connectionState === "connecting"
										? "Connecting..."
										: "Connect"}
								</button>
							</div>
						) : (
							<div className="connected-info">
								<div className="info-row">
									<strong>Client ID:</strong>
									<code>{clientId?.slice(0, 8)}</code>
								</div>
								<button onClick={handleDisconnect} className="button secondary">
									Disconnect
								</button>
							</div>
						)}
					</div>

					{profile && (
						<div className="card">
							<h2>Profile</h2>
							<div className="profile-info">
								<div className="info-row">
									<strong>User ID:</strong>
									<span>{profile.userId}</span>
								</div>
								<div className="info-row">
									<strong>Role:</strong>
									<span className={`role-badge ${profile.role}`}>
										{profile.role.toUpperCase()}
									</span>
								</div>
								<div className="info-row">
									<strong>Rate Limit:</strong>
									<span>{profile.rateLimit} msg/sec</span>
								</div>
								<div className="info-row">
									<strong>Permissions:</strong>
									<span>{profile.permissions.join(", ")}</span>
								</div>
							</div>
						</div>
					)}

					{isConnected && (
						<div className="card">
							<h2>Actions</h2>
							<div className="actions">
								<button onClick={handlePing} className="button">
									🏓 Ping Server
								</button>
								<button onClick={handleProtectedAction} className="button">
									🔒 Protected Action
								</button>
								<button onClick={handleAdminAction} className="button">
									👑 Admin Action
								</button>
							</div>
							<div className="hint">
								<small>
									<strong>Hint:</strong> Try admin actions with different tokens
									to see authorization in action!
								</small>
							</div>
						</div>
					)}
				</div>

				<div className="right-panel">
					<div className="card logs-card">
						<h2>Activity Log</h2>
						<div className="logs">
							{logs.length === 0 ? (
								<div className="empty-logs">No activity yet...</div>
							) : (
								logs.map((log, index) => (
									<div key={index} className="log-entry">
										{log}
									</div>
								))
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
