// Soft token bucket — tracks usage but NEVER blocks.
// Blocking for up to 30 s caused Vercel function timeouts when a previous
// request (e.g. a sync) depleted the bucket on the same warm instance.
//
// Real rate-limit enforcement is handled by the 429 retry logic inside
// SpotifyClient.request() — that's the right place to back off.
// This limiter now only logs a warning so runaway loops are still visible.

const MAX_TOKENS = 180;
const REFILL_INTERVAL_MS = 30_000;

class SpotifyRateLimiter {
  private tokens = MAX_TOKENS;
  private lastRefill = Date.now();

  acquire(count: number = 1): void {
    this.refill();
    if (this.tokens < count) {
      // Don't block — let Spotify's 429 + retry handle actual throttling
      console.warn(`[rate-limiter] bucket low (${this.tokens} left), proceeding anyway`);
    }
    this.tokens = Math.max(0, this.tokens - count);
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
