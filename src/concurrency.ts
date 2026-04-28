export class RateLimiter {
  private readonly minIntervalMs: number;
  private chain: Promise<void> = Promise.resolve();
  private lastFiredAt = 0;

  constructor(rpm: number) {
    if (rpm <= 0) throw new Error('rate-limit must be > 0');
    this.minIntervalMs = 60_000 / rpm;
  }

  acquire(): Promise<void> {
    const next = this.chain.then(async () => {
      const elapsed = Date.now() - this.lastFiredAt;
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed);
      }
      this.lastFiredAt = Date.now();
    });
    this.chain = next.catch(() => {});
    return next;
  }
}

export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
