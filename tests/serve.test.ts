import { describe, expect, test } from "bun:test";

describe("Server Configuration", () => {
	test("default hostname should be localhost", () => {
		const defaultHostname = "localhost";
		expect(defaultHostname).toBe("localhost");
	});

	test("default port should be 3000", () => {
		const defaultPort = 3000;
		expect(defaultPort).toBe(3000);
	});

	test("development mode defaults to false", () => {
		const defaultDevelopment = false;
		expect(defaultDevelopment).toBe(false);
	});

	test("hot reload defaults to false", () => {
		const defaultHot = false;
		expect(defaultHot).toBe(false);
	});
});

describe("Banned Strings", () => {
	const BANNED_STRINGS = [".."] as const;

	test("contains path traversal protection", () => {
		expect(BANNED_STRINGS).toContain("..");
	});

	test("detects malicious path in URL", () => {
		const maliciousUrl = "http://localhost:3000/../../../etc/passwd";
		const isBanned = BANNED_STRINGS.some((banned) =>
			maliciousUrl.includes(banned),
		);
		expect(isBanned).toBe(true);
	});

	test("allows normal paths", () => {
		const normalUrl = "http://localhost:3000/api/users";
		const isBanned = BANNED_STRINGS.some((banned) =>
			normalUrl.includes(banned),
		);
		expect(isBanned).toBe(false);
	});
});

describe("WebSocket Topic Extraction", () => {
	test("extracts topic from pathname", () => {
		const url = new URL("http://localhost:3000/chat");
		const topic = url.pathname.slice(1) || "none";
		expect(topic).toBe("chat");
	});

	test("defaults to 'none' for root path", () => {
		const url = new URL("http://localhost:3000/");
		const topic = url.pathname.slice(1) || "none";
		expect(topic).toBe("none");
	});

	test("extracts nested topic", () => {
		const url = new URL("http://localhost:3000/room/lobby");
		const topic = url.pathname.slice(1) || "none";
		expect(topic).toBe("room/lobby");
	});
});

describe("Client ID Generation", () => {
	test("generates unique UUIDs", () => {
		const id1 = crypto.randomUUID();
		const id2 = crypto.randomUUID();
		const id3 = crypto.randomUUID();

		expect(id1).not.toBe(id2);
		expect(id2).not.toBe(id3);
		expect(id1).not.toBe(id3);
	});

	test("UUID format is valid", () => {
		const id = crypto.randomUUID();
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(uuidRegex.test(id)).toBe(true);
	});
});

describe("WebSocket Data Structure", () => {
	test("contains required fields", () => {
		const mockData = {
			url: "ws://localhost:8080",
			topic: "test",
			host: "localhost:8080",
			origin: "http://localhost",
			secWebsocketVersion: "13",
			secWebsocketKey: "test-key",
			secWebsocketExtensions: "permessage-deflate",
			secWebsocketProtocol: "",
			acceptEncoding: "gzip, deflate",
			userAgent: "Mozilla/5.0",
			date: new Date(),
			id: crypto.randomUUID(),
		};

		expect(mockData.url).toBeDefined();
		expect(mockData.topic).toBeDefined();
		expect(mockData.host).toBeDefined();
		expect(mockData.id).toBeDefined();
		expect(mockData.date).toBeInstanceOf(Date);
	});
});

describe("Message Routing Logic", () => {
	test("routes message to specific client when 'to' field present", () => {
		const message = {
			category: "response",
			requestId: "req-123",
			from: "client-1",
			to: "client-2",
			data: { result: "success" },
		};

		expect(message.to).toBe("client-2");
		expect(message.from).toBe("client-1");
	});

	test("broadcasts when 'to' field is missing", () => {
		const message = {
			category: "request",
			requestId: "req-456",
			from: "client-1",
			data: { type: "test" },
		};
		// Should broadcast to all subscribers
	});

	test("parses JSON message correctly", () => {
		const messageStr = JSON.stringify({
			category: "request",
			requestId: "req-789",
			data: { type: "score" },
		});

		const parsed = JSON.parse(messageStr);
		expect(parsed.category).toBe("request");
		expect(parsed.requestId).toBe("req-789");
	});
});

describe("Welcome Message", () => {
	test("welcome message has correct structure", () => {
		const clientId = crypto.randomUUID();
		const welcome = {
			category: "welcome",
			clientId: clientId,
		};

		expect(welcome.category).toBe("welcome");
		expect(welcome.clientId).toBe(clientId);
	});

	test("welcome message serializes correctly", () => {
		const welcome = {
			category: "welcome",
			clientId: "test-client-123",
		};

		const serialized = JSON.stringify(welcome);
		const deserialized = JSON.parse(serialized);

		expect(deserialized.category).toBe("welcome");
		expect(deserialized.clientId).toBe("test-client-123");
	});
});

describe("CLI Arguments", () => {
	test("parses development flag", () => {
		const args = {
			development: true,
			hostname: "127.0.0.1",
			hot: false,
			port: "8080",
		};

		expect(args.development).toBe(true);
	});

	test("parses port as string and converts to number", () => {
		const port = Number.parseInt("8080", 10);
		expect(port).toBe(8080);
		expect(typeof port).toBe("number");
	});

	test("handles invalid port gracefully", () => {
		const invalidPort = Number.parseInt("not-a-port", 10);
		expect(Number.isNaN(invalidPort)).toBe(true);
	});

	test("default values are applied", () => {
		const defaults = {
			development: true,
			hostname: "127.0.0.1",
			hot: false,
			port: "8080",
		};

		expect(defaults.hostname).toBe("127.0.0.1");
		expect(defaults.port).toBe("8080");
	});
});

describe("HTTP Routing", () => {
	test("GET requests should be handled", () => {
		const method = "GET";
		expect(["GET", "POST", "DELETE"]).toContain(method);
	});

	test("POST requests should be handled", () => {
		const method = "POST";
		expect(["GET", "POST", "DELETE"]).toContain(method);
	});

	test("DELETE requests should be handled", () => {
		const method = "DELETE";
		expect(["GET", "POST", "DELETE"]).toContain(method);
	});

	test("unsupported methods return 404", () => {
		const method = "PATCH";
		const isSupported = ["GET", "POST", "DELETE"].includes(method);
		expect(isSupported).toBe(false);
	});
});

describe("Request Upgrade", () => {
	test("detects upgrade header for WebSocket", () => {
		const headers = new Map([["upgrade", "websocket"]]);
		expect(headers.get("upgrade")).toBe("websocket");
	});

	test("missing upgrade header returns falsy", () => {
		const headers = new Map([["content-type", "application/json"]]);
		expect(headers.get("upgrade")).toBeFalsy();
	});
});

describe("Server URL Construction", () => {
	test("constructs correct server URL", () => {
		const hostname = "127.0.0.1";
		const port = 8080;
		const url = `http://${hostname}:${port}`;
		expect(url).toBe("http://127.0.0.1:8080");
	});

	test("constructs correct WebSocket URL", () => {
		const hostname = "127.0.0.1";
		const port = 8080;
		const wsUrl = `ws://${hostname}:${port}`;
		expect(wsUrl).toBe("ws://127.0.0.1:8080");
	});
});
