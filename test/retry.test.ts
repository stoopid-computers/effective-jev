import { expect, it } from "@effect/vitest";
import { Duration, Effect, Schedule } from "effect";
import { RateLimitError } from "../src";
import {
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  resolveRetryPolicy,
  retrySchedule,
} from "../src/retry";

it.each([
  [{ "retry-after": "1.5" }, 1500],
  [{ "retry-after": "-1" }, undefined],
  [{ "retry-after-ms": "20", "retry-after": "5" }, 20],
  [{ "retry-after-ms": "0" }, 0],
  [{ "retry-after-ms": "bad", "retry-after": "2" }, 2000],
  [{ "retry-after-ms": "-1" }, undefined],
  [{ "retry-after-ms": "", "retry-after": "2" }, 2000],
  [{ "retry-after": "" }, undefined],
  [{ "retry-after": "garbage" }, undefined],
  [{ "retry-after": "Thu, 01 Jan 1970 00:00:02 GMT" }, 1000],
  [{ "retry-after": "Thu, 01 Jan 1970 00:00:00 GMT" }, 0],
  [{}, undefined],
])("parses server retry delays %#", (headers, expected) => {
  expect(parseRetryAfter(headers, 1000)).toBe(expected);
});

it.effect("copies status sets and ignores undefined partial overrides", () =>
  Effect.gen(function* () {
    const statuses = new Set([429]);
    const result = yield* resolveRetryPolicy(DEFAULT_RETRY_POLICY, {
      httpStatuses: statuses,
      maxRetries: undefined,
    });
    statuses.add(400);
    expect(result.maxRetries).toBe(2);
    expect([...result.httpStatuses]).toEqual([429]);
    expect(result.httpStatuses).not.toBe(DEFAULT_RETRY_POLICY.httpStatuses);
  }),
);

it.effect("applies capped exponential jitter within the configured range", () =>
  Effect.gen(function* () {
    const policy = { ...DEFAULT_RETRY_POLICY, maxRetries: 8 };
    const step = yield* Schedule.toStep(retrySchedule(policy));
    const error = new RateLimitError({
      status: 429,
      body: null,
      headers: {},
      requestId: undefined,
      retryAfterMs: undefined,
      message: "rate limit",
    });
    for (let index = 0; index < 6; index++) {
      const [, duration] = yield* step(0, error);
      const max = Math.min(500 * 2 ** index, 5000);
      expect(Duration.toMillis(duration)).toBeGreaterThanOrEqual(max * 0.75);
      expect(Duration.toMillis(duration)).toBeLessThanOrEqual(max);
    }
  }),
);
