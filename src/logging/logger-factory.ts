// Winston loggers: readable text by default, JSON lines for log collectors.
import winston from "winston";

export type Logger = winston.Logger;
export type LogFormat = "text" | "json";

export class LoggerFactory {
  static readonly levels = ["error", "warn", "info", "debug"] as const;

  /** Console logger at the given level ("debug" also shows unchanged and absent files). */
  static create(level = "info", format: LogFormat = "text"): Logger {
    if (!(LoggerFactory.levels as readonly string[]).includes(level)) {
      throw new Error(`Invalid log level: "${level}" (expected: ${LoggerFactory.levels.join(", ")})`);
    }
    return winston.createLogger({
      level,
      format: winston.format.combine(winston.format.timestamp(), format === "json" ? winston.format.json() : LoggerFactory.textFormat()),
      transports: [new winston.transports.Console()],
    });
  }

  /** Logger that writes nothing, for tests. */
  static silent(): Logger {
    return winston.createLogger({ silent: true, transports: [new winston.transports.Console()] });
  }

  /** "2026-09-29T12:00:03.123Z info  archived price_guide_21 (0.15 MB)" */
  private static textFormat(): winston.Logform.Format {
    return winston.format.printf(({ timestamp, level, message }) => `${String(timestamp)} ${level.padEnd(5)} ${String(message)}`);
  }
}
