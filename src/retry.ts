import { Clock, Duration, Effect, Random, Schedule, Schema } from "effect";
import type { TypeSafeError } from "./errors.ts";
import type { RetryPolicy } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Retry defaults retained from the upstream SDK. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 5_000,
  backoffJitter: 0.25,
  httpStatuses: new Set([408, 429, ...Array.from({ length: 100 }, (_, index) => 500 + index)]),
  respectRetryAfter: true,
  maxRetryAfterMs: 60_000,
  apiConnectionError: true,
  apiTimeoutError: true,
};

const nonNegative = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const retryPolicy: Schema.Codec<RetryPolicy> = Schema.Struct({
  maxRetries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  backoffInitialMs: nonNegative,
  backoffMaxMs: nonNegative,
  backoffJitter: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  httpStatuses: Schema.ReadonlySet(
    Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  ),
  respectRetryAfter: Schema.Boolean,
  maxRetryAfterMs: nonNegative,
  apiConnectionError: Schema.Boolean,
  apiTimeoutError: Schema.Boolean,
});

/** Merge retry settings, validate them, and copy the caller-owned status set. */
export const resolveRetryPolicy = (
  base: RetryPolicy,
  overrides: Partial<RetryPolicy> | undefined,
): Effect.Effect<RetryPolicy, Schema.SchemaError> =>
  Schema.decodeEffect(retryPolicy)({
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined),
    ),
  }).pipe(Effect.map((policy) => ({ ...policy, httpStatuses: new Set(policy.httpStatuses) })));

/** Parse the server's requested delay using Effect's clock at the call site. */
export const parseRetryAfter = (
  headers: Readonly<Record<string, string | undefined>>,
  now: number,
): number | undefined => {
  const rawMs = headers["retry-after-ms"];
  if (rawMs !== undefined && rawMs.trim() !== "") {
    const millis = Number(rawMs);
    if (Number.isFinite(millis) && millis >= 0) return millis;
  }
  const raw = headers["retry-after"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

const retryable = (error: TypeSafeError, policy: RetryPolicy): boolean => {
  switch (error._tag) {
    case "APIConnectionError":
      return policy.apiConnectionError;
    case "APITimeoutError":
      return policy.apiTimeoutError;
    case "InvalidRequestError":
    case "ResponseValidationError":
      return false;
    default:
      return policy.httpStatuses.has(error.status);
  }
};

/** Capped exponential backoff with Effect time, randomness, and interruption. */
export const retrySchedule = (
  policy: RetryPolicy,
): Schedule.Schedule<Duration.Duration, TypeSafeError> =>
  Schedule.exponential(policy.backoffInitialMs).pipe(
    Schedule.setInputType<TypeSafeError>(),
    Schedule.while(
      ({ input, attempt }) => attempt <= policy.maxRetries && retryable(input, policy),
    ),
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.gen(function* () {
        if (policy.respectRetryAfter && "headers" in input) {
          const delay = parseRetryAfter(input.headers, yield* Clock.currentTimeMillis);
          if (delay !== undefined && delay <= policy.maxRetryAfterMs) return delay;
        }
        const base = Math.min(Duration.toMillis(duration), policy.backoffMaxMs);
        const random = yield* Random.next;
        return Math.round(base * (1 - random * policy.backoffJitter));
      }),
    ),
    Schedule.tap(({ input, duration, attempt }) =>
      Effect.logDebug("Retrying TypeSafe request").pipe(
        Effect.annotateLogs({
          error: input._tag,
          retry: attempt,
          delayMs: Duration.toMillis(duration),
        }),
      ),
    ),
  );
