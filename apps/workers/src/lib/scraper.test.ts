import { describe, it, expect, vi } from 'vitest';
import {
  delay,
  retryWithBackoff,
  NotFoundError,
  RateLimitError,
} from './scraper';

describe('scraper utilities', () => {
  describe('delay', () => {
    it('should wait for specified milliseconds', async () => {
      const start = Date.now();
      await delay(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95); // Allow small variance
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('retryWithBackoff', () => {
    it('should return immediately on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn, 'test');
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient failures', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, 'test', {
        baseDelay: 10, // Fast for testing
        jitter: false,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on NotFoundError', async () => {
      const fn = vi.fn().mockRejectedValue(new NotFoundError('Not found'));

      await expect(retryWithBackoff(fn, 'test')).rejects.toThrow(NotFoundError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries exceeded', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        retryWithBackoff(fn, 'test', {
          maxRetries: 2,
          baseDelay: 10,
          jitter: false,
        })
      ).rejects.toThrow('Always fails');

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use Retry-After from RateLimitError', async () => {
      const start = Date.now();
      const fn = vi.fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited', 0.1)) // 0.1 seconds
        .mockResolvedValue('success');

      await retryWithBackoff(fn, 'test');

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95); // ~100ms from Retry-After
    });
  });
});
