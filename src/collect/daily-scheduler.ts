// Runs a task once a day at a fixed time (UTC), without depending on cron.
import { ErrorMessage } from "../logging/error-message.ts";
import type { Logger } from "../logging/logger-factory.ts";

export class DailyScheduler {
  private readonly hour: number;
  private readonly minute: number;
  private readonly task: () => Promise<void>;
  private readonly logger: Logger;

  /** at: UTC time formatted as "HH:MM". */
  constructor(at: string, task: () => Promise<void>, logger: Logger) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);

    if (!match) {
      throw new Error(`Invalid time: "${at}" (expected HH:MM, in UTC)`);
    }

    this.hour = Number(match[1]);
    this.minute = Number(match[2]);
    this.task = task;
    this.logger = logger;
  }

  /** Next run strictly after "now". */
  nextRun(now: Date): Date {
    const todayAtTime = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.hour, this.minute);
    const next = new Date(todayAtTime);

    // Today's time has passed: tomorrow at the same time.
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return next;
  }

  /** Endless loop: a failed collection is logged and scheduling carries on. */
  async runForever(): Promise<never> {
    for (;;) {
      const next = this.nextRun(new Date());

      this.logger.info(`Next collection: ${next.toISOString()}`);
      const waitMs = next.getTime() - Date.now();

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await this.runOnce();
    }
  }

  async runOnce(): Promise<void> {
    try {
      await this.task();
    } catch (error) {
      this.logger.error(`Collection failed: ${ErrorMessage.of(error)}`);
    }
  }
}
