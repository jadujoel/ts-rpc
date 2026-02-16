import { describe, expect, test } from "bun:test";
import {
	canReconnect,
	getCloseCodeDescription,
	isReservedCloseCode,
	WS_CLOSE_ABNORMAL,
	WS_CLOSE_BAD_GATEWAY,
	WS_CLOSE_GOING_AWAY,
	WS_CLOSE_INTERNAL_ERROR,
	WS_CLOSE_INVALID_DATA,
	WS_CLOSE_MANDATORY_EXTENSION,
	WS_CLOSE_MESSAGE_TOO_BIG,
	WS_CLOSE_NO_STATUS,
	WS_CLOSE_NORMAL,
	WS_CLOSE_POLICY_VIOLATION,
	WS_CLOSE_PROTOCOL_ERROR,
	WS_CLOSE_SERVICE_RESTART,
	WS_CLOSE_TLS_HANDSHAKE,
	WS_CLOSE_TRY_AGAIN_LATER,
	WS_CLOSE_UNSUPPORTED,
} from "./WebSocketCloseCodes.ts";

describe("WebSocket Close Codes", () => {
	describe("Constants", () => {
		test("WS_CLOSE_NORMAL has correct value", () => {
			expect(WS_CLOSE_NORMAL).toBe(1000);
		});

		test("WS_CLOSE_GOING_AWAY has correct value", () => {
			expect(WS_CLOSE_GOING_AWAY).toBe(1001);
		});

		test("WS_CLOSE_PROTOCOL_ERROR has correct value", () => {
			expect(WS_CLOSE_PROTOCOL_ERROR).toBe(1002);
		});

		test("WS_CLOSE_UNSUPPORTED has correct value", () => {
			expect(WS_CLOSE_UNSUPPORTED).toBe(1003);
		});

		test("WS_CLOSE_NO_STATUS has correct value", () => {
			expect(WS_CLOSE_NO_STATUS).toBe(1005);
		});

		test("WS_CLOSE_ABNORMAL has correct value", () => {
			expect(WS_CLOSE_ABNORMAL).toBe(1006);
		});

		test("WS_CLOSE_INVALID_DATA has correct value", () => {
			expect(WS_CLOSE_INVALID_DATA).toBe(1007);
		});

		test("WS_CLOSE_POLICY_VIOLATION has correct value", () => {
			expect(WS_CLOSE_POLICY_VIOLATION).toBe(1008);
		});

		test("WS_CLOSE_MESSAGE_TOO_BIG has correct value", () => {
			expect(WS_CLOSE_MESSAGE_TOO_BIG).toBe(1009);
		});

		test("WS_CLOSE_MANDATORY_EXTENSION has correct value", () => {
			expect(WS_CLOSE_MANDATORY_EXTENSION).toBe(1010);
		});

		test("WS_CLOSE_INTERNAL_ERROR has correct value", () => {
			expect(WS_CLOSE_INTERNAL_ERROR).toBe(1011);
		});

		test("WS_CLOSE_SERVICE_RESTART has correct value", () => {
			expect(WS_CLOSE_SERVICE_RESTART).toBe(1012);
		});

		test("WS_CLOSE_TRY_AGAIN_LATER has correct value", () => {
			expect(WS_CLOSE_TRY_AGAIN_LATER).toBe(1013);
		});

		test("WS_CLOSE_TLS_HANDSHAKE has correct value", () => {
			expect(WS_CLOSE_TLS_HANDSHAKE).toBe(1015);
		});

		test("WS_CLOSE_BAD_GATEWAY has correct value", () => {
			expect(WS_CLOSE_BAD_GATEWAY).toBe(1014);
		});
	});

	describe("getCloseCodeDescription", () => {
		test("returns correct description for normal closure", () => {
			expect(getCloseCodeDescription(1000)).toBe("Normal Closure");
		});

		test("returns correct description for going away", () => {
			expect(getCloseCodeDescription(1001)).toBe("Going Away");
		});

		test("returns correct description for protocol error", () => {
			expect(getCloseCodeDescription(1002)).toBe("Protocol Error");
		});

		test("returns correct description for unsupported data", () => {
			expect(getCloseCodeDescription(1003)).toBe("Unsupported Data");
		});

		test("returns correct description for no status", () => {
			expect(getCloseCodeDescription(1005)).toBe("No Status Received");
		});

		test("returns correct description for abnormal closure", () => {
			expect(getCloseCodeDescription(1006)).toBe("Abnormal Closure");
		});

		test("returns correct description for invalid data", () => {
			expect(getCloseCodeDescription(1007)).toBe("Invalid Frame Payload Data");
		});

		test("returns correct description for policy violation", () => {
			expect(getCloseCodeDescription(1008)).toBe("Policy Violation");
		});

		test("returns correct description for message too big", () => {
			expect(getCloseCodeDescription(1009)).toBe("Message Too Big");
		});

		test("returns correct description for mandatory extension", () => {
			expect(getCloseCodeDescription(1010)).toBe("Mandatory Extension");
		});

		test("returns correct description for internal error", () => {
			expect(getCloseCodeDescription(1011)).toBe("Internal Server Error");
		});

		test("returns correct description for service restart", () => {
			expect(getCloseCodeDescription(1012)).toBe("Service Restart");
		});

		test("returns correct description for try again later", () => {
			expect(getCloseCodeDescription(1013)).toBe("Try Again Later");
		});

		test("returns correct description for TLS handshake failed", () => {
			expect(getCloseCodeDescription(1015)).toBe("TLS Handshake Failure");
		});

		test("returns correct description for bad gateway", () => {
			expect(getCloseCodeDescription(1014)).toBe("Bad Gateway");
		});

		test("returns unknown for unrecognized code", () => {
			expect(getCloseCodeDescription(9999)).toBe("Unknown");
		});

		test("returns unknown for custom application code", () => {
			expect(getCloseCodeDescription(4000)).toBe("Unknown");
		});
	});

	describe("isReservedCloseCode", () => {
		test("returns true for no status code", () => {
			expect(isReservedCloseCode(1005)).toBe(true);
		});

		test("returns true for abnormal closure", () => {
			expect(isReservedCloseCode(1006)).toBe(true);
		});

		test("returns true for TLS handshake", () => {
			expect(isReservedCloseCode(1015)).toBe(true);
		});

		test("returns false for normal closure", () => {
			expect(isReservedCloseCode(1000)).toBe(false);
		});

		test("returns false for going away", () => {
			expect(isReservedCloseCode(1001)).toBe(false);
		});

		test("returns false for protocol error", () => {
			expect(isReservedCloseCode(1002)).toBe(false);
		});
	});

	describe("canReconnect", () => {
		test("returns false for normal closure", () => {
			expect(canReconnect(1000)).toBe(false);
		});

		test("returns true for going away", () => {
			expect(canReconnect(1001)).toBe(true);
		});

		test("returns false for protocol error", () => {
			expect(canReconnect(1002)).toBe(false);
		});

		test("returns false for unsupported data", () => {
			expect(canReconnect(1003)).toBe(false);
		});

		test("returns true for abnormal closure", () => {
			expect(canReconnect(1006)).toBe(true);
		});

		test("returns false for invalid data", () => {
			expect(canReconnect(1007)).toBe(false);
		});

		test("returns false for policy violation", () => {
			expect(canReconnect(1008)).toBe(false);
		});

		test("returns false for message too big", () => {
			expect(canReconnect(1009)).toBe(false);
		});

		test("returns false for mandatory extension", () => {
			expect(canReconnect(1010)).toBe(false);
		});

		test("returns true for internal error", () => {
			expect(canReconnect(1011)).toBe(true);
		});

		test("returns true for service restart", () => {
			expect(canReconnect(1012)).toBe(true);
		});

		test("returns true for try again later", () => {
			expect(canReconnect(1013)).toBe(true);
		});

		test("returns true for bad gateway", () => {
			expect(canReconnect(1014)).toBe(true);
		});

		test("returns false for TLS handshake", () => {
			expect(canReconnect(1015)).toBe(false);
		});

		test("returns false for unknown code by default", () => {
			expect(canReconnect(9999)).toBe(false);
		});
	});
});
