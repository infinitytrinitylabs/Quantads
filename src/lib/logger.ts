import pino from "pino";

export const logger = pino({
  name: "quantads",
  level: process.env["LOG_LEVEL"] ?? "info",
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.authorization", "*.email", "*.pii"],
    censor: "[REDACTED]"
  }
});
