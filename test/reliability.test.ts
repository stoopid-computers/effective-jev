import { describe, expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError } from "effect/unstable/http";
import { noul, type RequestOptions } from "../src";
import {
  ANSWER,
  jsonResponse,
  MODEL,
  MODEL_BODY,
  makeClient,
  mockHttp,
  requestBody,
} from "./helpers";

describe("retries", () => {
  it.effect("retries with exponential delays and an attempt header", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp((_, index) =>
        Effect.sync(() =>
          jsonResponse(index < 2 ? { error: "busy" } : MODEL_BODY, index < 2 ? 529 : 200),
        ),
      );
      const client = yield* makeClient(http, { retry: { backoffJitter: 0 } });
      const fiber = yield* Effect.forkChild(client.models.list());
      yield* TestClock.adjust(499);
      expect(calls).toHaveLength(1);
      yield* TestClock.adjust(1);
      expect(calls).toHaveLength(2);
      yield* TestClock.adjust(999);
      expect(calls).toHaveLength(2);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toEqual([MODEL]);
      expect(calls.map(({ request }) => request.headers["x-typesafe-retry-count"])).toEqual([
        undefined,
        "1",
        "2",
      ]);
      expect(calls.every(({ signal }) => signal.aborted)).toBe(true);
    }),
  );

  it.effect.each([
    { headers: { "retry-after-ms": "200", "retry-after": "10" }, delay: 200, retry: {} },
    { headers: { "retry-after": "2" }, delay: 2000, retry: {} },
    { headers: { "retry-after": "Thu, 01 Jan 1970 00:00:02 GMT" }, delay: 2000, retry: {} },
    { headers: { "retry-after": "1000" }, delay: 500, retry: {} },
    { headers: { "retry-after": "5" }, delay: 500, retry: { respectRetryAfter: false } },
    { headers: { "retry-after": "5" }, delay: 500, retry: { maxRetryAfterMs: 4000 } },
  ])("honors retry headers and configured limits %#", ({ headers, delay, retry }) =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp((_, index) =>
        Effect.sync(() =>
          jsonResponse(index === 0 ? {} : MODEL_BODY, index === 0 ? 429 : 200, headers),
        ),
      );
      const client = yield* makeClient(http, { retry: { backoffJitter: 0, ...retry } });
      const fiber = yield* Effect.forkChild(client.models.list());
      yield* TestClock.adjust(delay - 1);
      expect(calls).toHaveLength(1);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toEqual([MODEL]);
    }),
  );

  it.effect("stops at maxRetries and returns the last failure", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp((_, index) =>
        Effect.sync(() => jsonResponse({ message: `attempt ${index}` }, 500)),
      );
      const client = yield* makeClient(http, { retry: { backoffInitialMs: 0 } });
      const error = yield* client.models.list().pipe(Effect.flip);
      expect(error.message).toBe("500 attempt 2");
      expect(calls).toHaveLength(3);
      const immediate = yield* client.models.list({ retry: { maxRetries: 0 } }).pipe(Effect.flip);
      expect(immediate._tag).toBe("InternalServerError");
      expect(calls).toHaveLength(4);
    }),
  );

  it.effect("allows per-call status overrides without mutating client policy", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp(() => Effect.sync(() => jsonResponse({}, 400)));
      const statuses = new Set([429]);
      const client = yield* makeClient(http, {
        retry: { httpStatuses: statuses, backoffInitialMs: 0 },
      });
      statuses.add(400);
      yield* client.models.list().pipe(Effect.flip);
      expect(calls).toHaveLength(1);
      yield* client.models
        .list({ retry: { httpStatuses: new Set([400]), maxRetries: 1 } })
        .pipe(Effect.flip);
      expect(calls).toHaveLength(3);
      yield* client.models.list().pipe(Effect.flip);
      expect(calls).toHaveLength(4);
    }),
  );

  it.effect.each([true, false])("respects connection retry policy %s", (retry) =>
    Effect.gen(function* () {
      const cause = new Error("connection closed");
      const { http, calls } = mockHttp(({ request }) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
        ),
      );
      const error = yield* (yield* makeClient(http, {
        retry: { apiConnectionError: retry, backoffInitialMs: 0 },
      })).models
        .list()
        .pipe(Effect.flip);
      expect(error._tag).toBe("APIConnectionError");
      expect(calls).toHaveLength(retry ? 3 : 1);
    }),
  );

  it.effect("snapshots the body and expected answers across retries", () =>
    Effect.gen(function* () {
      const questions = { ok: noul() };
      const request = { state: { text: "before" }, questions };
      const { http, calls } = mockHttp((_, index) =>
        Effect.sync(() => {
          request.state.text = "after";
          return jsonResponse(index === 0 ? {} : ANSWER, index === 0 ? 500 : 200);
        }),
      );
      const client = yield* makeClient(http, { retry: { backoffInitialMs: 0 } });
      yield* client.systemOne(request);
      expect(requestBody(calls[0])).toMatchObject({ state: { text: "before" } });
      expect(requestBody(calls[1])).toEqual(requestBody(calls[0]));
    }),
  );
});

describe("timeouts and interruption", () => {
  it.effect.each([true, false])("applies per-attempt timeouts and retry policy %s", (retry) =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp(() => Effect.never);
      const client = yield* makeClient(http, {
        timeout: 100,
        retry: { apiTimeoutError: retry, backoffInitialMs: 0 },
      });
      const fiber = yield* Effect.forkChild(client.models.list().pipe(Effect.flip));
      yield* TestClock.adjust(retry ? 299 : 99);
      expect(calls).toHaveLength(retry ? 3 : 1);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toMatchObject({ _tag: "APITimeoutError", timeoutMs: 100 });
      expect(calls.every(({ signal }) => signal.aborted)).toBe(true);
    }),
  );

  it.effect("uses the per-call timeout", () =>
    Effect.gen(function* () {
      const { http } = mockHttp(() => Effect.never);
      const client = yield* makeClient(http, { timeout: 1000, retry: { maxRetries: 0 } });
      const fiber = yield* Effect.forkChild(client.models.list({ timeout: 50 }).pipe(Effect.flip));
      yield* TestClock.adjust(50);
      expect(yield* Fiber.join(fiber)).toMatchObject({ _tag: "APITimeoutError", timeoutMs: 50 });
    }),
  );

  it.effect("interrupts an in-flight request and aborts the transport", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const { http, calls } = mockHttp(() =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const client = yield* makeClient(http);
      const fiber = yield* Effect.forkChild(client.models.list());
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(calls[0]?.signal.aborted).toBe(true);
      yield* TestClock.adjust(60_000);
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("interrupts retry sleep without starting another request", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp(() =>
        Effect.sync(() => jsonResponse({}, 429, { "retry-after": "30" })),
      );
      const client = yield* makeClient(http);
      const fiber = yield* Effect.forkChild(client.models.list());
      yield* TestClock.adjust(1);
      expect(calls).toHaveLength(1);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust(60_000);
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect.each([
    { timeout: 0 },
    { timeout: Number.NaN },
    { retry: { maxRetries: -1 } },
    { retry: { backoffJitter: -1 } },
  ] satisfies RequestOptions[])("fails invalid request options before HTTP %#", (options) =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const error = yield* (yield* makeClient(http)).models.list(options).pipe(Effect.flip);
      expect(error._tag).toBe("InvalidRequestError");
      expect(calls).toHaveLength(0);
    }),
  );
});
