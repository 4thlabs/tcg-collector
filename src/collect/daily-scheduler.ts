// Runs a task once a day at a fixed time (UTC), without depending on cron.

export class DailyScheduler {
  private readonly hour: number;
  private readonly minute: number;
  private readonly task: () => Promise<void>;

  /** at: UTC time formatted as "HH:MM". */
  constructor(at: string, task: () => Promise<void>) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
    if (!match) throw new Error(`Invalid time: "${at}" (expected HH:MM, in UTC)`);
    this.hour = Number(match[1]);
    this.minute = Number(match[2]);
    this.task = task;
  }

  /** Next run strictly after "now". */
  nextRun(now: Date): Date {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.hour, this.minute));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  /** Endless loop: a failed collection is logged and scheduling carries on. */
  async runForever(): Promise<never> {
    for (;;) {
      const next = this.nextRun(new Date());
      console.log(`Next collection: ${next.toISOString()}`);
      await new Promise((resolve) => setTimeout(resolve, next.getTime() - Date.now()));
      await this.runOnce();
    }
  }

  async runOnce(): Promise<void> {
    try {
      await this.task();
    } catch (error) {
      console.error(`Collection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
