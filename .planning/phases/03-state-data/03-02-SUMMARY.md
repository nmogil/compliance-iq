---
phase: 03-state-data
plan: 02
subsystem: infra
tags: [scraping, http, retry, rate-limiting, exponential-backoff]

# Dependency graph
requires:
  - phase: 02-federal-data
    provides: Retry logic patterns for API requests
provides:
  - Reusable HTTP utilities for Texas government website scraping
  - Rate limiting per domain to prevent 429 errors
  - Exponential backoff with jitter for resilient retries
  - Retry-After header parsing
affects: [03-state-data, texas-statutes, texas-tac]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exponential backoff with jitter (1s, 2s, 4s, 8s)"
    - "Per-domain rate limiting (200ms default)"
    - "Retry-After header compliance (RFC 7231)"
    - "Custom error types for scraping (NotFoundError, RateLimitError, ScrapingError)"

key-files:
  created:
    - apps/workers/src/lib/scraper.ts
    - apps/workers/src/lib/scraper.test.ts
  modified: []

key-decisions:
  - "200ms default rate limit delay between same-domain requests"
  - "Exponential backoff: 1s, 2s, 4s, 8s with 8s max delay cap"
  - "25% jitter to prevent thundering herd on retries"
  - "NotFoundError (404) is never retried - treated as permanent"
  - "RateLimitError respects Retry-After header when present"

patterns-established:
  - "fetchWithRateLimit() as standard wrapper for all Texas scraping"
  - "retryWithBackoff() for any operation needing retry logic"
  - "Per-domain request tracking to enforce minimum delays"

# Metrics
duration: 2min
completed: 2026-02-01
---

# Phase 3 Plan 2: Scraper Utilities Summary

**Exponential backoff HTTP utilities with per-domain rate limiting and Retry-After header support for Texas government scraping**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-01T22:20:42Z
- **Completed:** 2026-02-01T22:22:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created reusable scraper utilities for Texas government websites
- Implemented exponential backoff with jitter (1s, 2s, 4s, 8s delays)
- Per-domain rate limiting prevents 429 errors (200ms default delay)
- Retry-After header parsing complies with RFC 7231
- 6 unit tests verify retry logic, error handling, and rate limiting

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scraper utilities with retry and rate limiting** - `3cf89fc` (feat)
2. **Task 2: Add unit tests for scraper utilities** - `69b5553` (test)

## Files Created/Modified
- `apps/workers/src/lib/scraper.ts` - Scraper utilities with retry, rate limiting, and error handling (326 lines)
- `apps/workers/src/lib/scraper.test.ts` - Unit tests for delay, retry logic, and error types (76 lines)

## Decisions Made

**Rate limiting strategy:**
- 200ms minimum delay between requests to same domain
- Conservative default to prevent 429 errors from capitol.texas.gov and sos.state.tx.us
- Per-domain tracking allows concurrent requests to different domains

**Retry configuration:**
- Base delay: 1000ms (1 second)
- Max delay: 8000ms (8 seconds)
- Exponential backoff: 1s → 2s → 4s → 8s
- Max retries: 3 (4 total attempts)
- Jitter: 0-25% randomness to prevent thundering herd

**Error handling:**
- NotFoundError (404) is never retried - resource permanently missing
- RateLimitError (429) respects Retry-After header when present
- ScrapingError for general HTTP errors with retry

**User-Agent header:**
- Identifies as "ComplianceIQ-Bot/1.0" for polite scraping
- Includes contact URL for government webmasters

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for next plans:**
- Texas Statutes scraper can use fetchWithRateLimit() for capitol.texas.gov
- TAC scraper can use fetchWithRateLimit() for sos.state.tx.us
- Shared utilities reduce duplication across Texas data plans

**Exports available:**
- `retryWithBackoff()` - Generic retry wrapper for any async operation
- `fetchWithRateLimit()` - HTTP fetch with automatic rate limiting and retry
- `delay()` - Async sleep utility
- `NotFoundError`, `RateLimitError`, `ScrapingError` - Custom error types

**Testing:**
- 6 unit tests passing
- Retry logic verified with mock functions
- Timing tests confirm delay accuracy
- RateLimitError Retry-After header honored

---
*Phase: 03-state-data*
*Completed: 2026-02-01*
