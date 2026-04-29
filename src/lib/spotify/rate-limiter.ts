const MAX_TOKENS = 170;
const REFILL_INTERVAL_MS = 30_000;

class SpotifyRateLimiter {
  private tokens = MAX_TOKENS;
  private lastRefill = Date.now();

  async acquire(count: number = 1): Promise<void> {
    this.refill();
    if (this.tokens < count) {
      const waitMs = REFILL_INTERVAL_MS - (Date.now() - this.lastRefill);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
      this.refill();
    }
    this.tokens -= count;
  }

  private refill(): void {
    const now = Date.now();
    if (now - this.lastRefill >= REFILL_INTERVAL_MS) {
      this.tokens = MAX_TOKENS;
      this.lastRefill = now;
    }
  }
}

export const rateLimiter = new SpotifyRateLimiter();
