import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { RedisService, connectionOptions } from "../redis/redis.service";
import type { TiltEvent } from "./events";

export const QUEUE_NAME = "events";

@Injectable()
export class EventsQueue implements OnModuleDestroy {
  readonly queue: Queue<TiltEvent>;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {
    this.queue = new Queue<TiltEvent>(QUEUE_NAME, {
      connection: connectionOptions(redis.config.url),
      prefix: `${redis.prefix}:bull`,
      defaultJobOptions: {
        // A reward can arrive before its assignment is saved. The worker throws in that
        // case and BullMQ retries, so ordering never has to be guaranteed on the way in.
        attempts: 12,
        backoff: { type: "exponential", delay: 100 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }

  async add(event: TiltEvent) {
    // Deterministic ids make a duplicate enqueue a no-op while the first copy is still stored.
    const jobId = `${event.type}.${event.experiment}.${event.userKey}`.replace(/:/g, "_");
    await this.queue.add(event.type, event, { jobId });
  }

  async depth() {
    const c = await this.queue.getJobCounts("waiting", "active", "delayed", "failed");
    return {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
    };
  }

  /** Resolve once every queued event has reached PostgreSQL. Used by tests and shutdown. */
  async drain(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const d = await this.depth();
      if (d.waiting + d.active + d.delayed === 0) return;
      if (Date.now() > deadline) throw new Error(`queue did not drain: ${JSON.stringify(d)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
