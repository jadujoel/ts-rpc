/**
 * Structured logging utility for demo applications
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
	constructor(private readonly prefix: string) {}

	private log(level: LogLevel, ...args: unknown[]) {
		const timestamp = new Date().toISOString();
		const message = `[${timestamp}] [${this.prefix}] [${level.toUpperCase()}]`;

		switch (level) {
			case "debug":
				console.debug(message, ...args);
				break;
			case "info":
				console.log(message, ...args);
				break;
			case "warn":
				console.warn(message, ...args);
				break;
			case "error":
				console.error(message, ...args);
				break;
		}
	}

	debug(...args: unknown[]) {
		this.log("debug", ...args);
	}

	info(...args: unknown[]) {
		this.log("info", ...args);
	}

	warn(...args: unknown[]) {
		this.log("warn", ...args);
	}

	error(...args: unknown[]) {
		this.log("error", ...args);
	}
}
