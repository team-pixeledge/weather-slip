import pino from "pino";

// Structured JSON logs to stdout (Lightsail/Vercel capture stdout). Log ids,
// shop domains, counts and durations — never customer names, addresses,
// phones or emails (protected customer data).
export const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
