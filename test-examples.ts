#!/usr/bin/env bun

const examples = [
	"auth-scenarios.ts",
	"authorization.ts",
	"close-codes.ts",
	"error-handling.ts",
	"peer-to-peer.ts",
	"rate-limiting.ts",
	"retry-socket.ts",
	"rpc.ts",
	"stream.ts",
	"stream-backpressure.ts",
	"StreamSimple.ts",
];

const results: {
	name: string;
	status: "PASS" | "FAIL" | "TIMEOUT";
	time: number;
}[] = [];

for (const example of examples) {
	const startTime = Date.now();
	console.log(`\n========== Testing ${example} ==========`);

	try {
		const proc = Bun.spawn(["bun", `examples/${example}`], {
			stdout: "pipe",
			stderr: "pipe",
		});

		// Set a timeout
		const timeoutId = setTimeout(() => {
			proc.kill();
		}, 30000); // 30 second timeout per example

		const exitCode = await proc.exited;
		clearTimeout(timeoutId);

		const elapsed = Date.now() - startTime;

		if (exitCode === 0) {
			console.log(`✅ PASS (${elapsed}ms)`);
			results.push({ name: example, status: "PASS", time: elapsed });
		} else {
			console.log(`❌ FAIL (exit code: ${exitCode})`);
			const stderr = await new Response(proc.stderr).text();
			console.log("Error output:", stderr.slice(-500)); // Last 500 chars
			results.push({ name: example, status: "FAIL", time: elapsed });
		}
	} catch (error) {
		const elapsed = Date.now() - startTime;
		console.log(`⏱️  TIMEOUT or ERROR`);
		console.log(error);
		results.push({ name: example, status: "TIMEOUT", time: elapsed });
	}
}

console.log("\n========== SUMMARY ==========");
for (const result of results) {
	const icon =
		result.status === "PASS" ? "✅" : result.status === "FAIL" ? "❌" : "⏱️ ";
	console.log(`${icon} ${result.name} - ${result.status} (${result.time}ms)`);
}

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const timeoutCount = results.filter((r) => r.status === "TIMEOUT").length;

console.log(
	`\nTotal: ${results.length} | Pass: ${passCount} | Fail: ${failCount} | Timeout: ${timeoutCount}`,
);

process.exit(failCount + timeoutCount > 0 ? 1 : 0);
