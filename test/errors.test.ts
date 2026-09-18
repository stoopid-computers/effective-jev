import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { jsonResponse, makeClient, mockHttp } from "./helpers";

it.effect.each([
  [400, "BadRequestError"],
  [401, "AuthenticationError"],
  [403, "PermissionDeniedError"],
  [404, "NotFoundError"],
  [422, "UnprocessableEntityError"],
  [429, "RateLimitError"],
  [500, "InternalServerError"],
  [529, "InternalServerError"],
  [418, "APIError"],
] as const)("returns tagged failures for HTTP %s", ([status, tag]) =>
  Effect.gen(function* () {
    const { http, calls } = mockHttp(() =>
      Effect.sync(() =>
        jsonResponse({ error: { message: "failed" } }, status, {
          "x-typesafe-request-id": "req_error",
          "retry-after-ms": "10",
        }),
      ),
    );
    const error = yield* (yield* makeClient(http, { retry: { maxRetries: 0 } })).models
      .list()
      .pipe(Effect.flip);
    expect(error).toMatchObject({
      _tag: tag,
      status,
      requestId: "req_error",
      message: `${status} failed`,
      body: { error: { message: "failed" } },
    });
    if (error._tag === "RateLimitError") expect(error.retryAfterMs).toBe(10);
    expect(calls).toHaveLength(1);
  }),
);

it.effect("handles API errors with catchTag", () =>
  Effect.gen(function* () {
    const { http } = mockHttp(() =>
      Effect.sync(() => jsonResponse({ detail: "bad credentials" }, 401)),
    );
    const client = yield* makeClient(http);
    const result = yield* client.models
      .list()
      .pipe(Effect.catchTag("AuthenticationError", (error) => Effect.succeed(error.status)));
    expect(result).toBe(401);
  }),
);

it.effect.each([
  ["plain error", "plain error"],
  [{ error: "error string" }, "error string"],
  [{ message: "message" }, "message"],
  [{ detail: "detail" }, "detail"],
  [{ detail: { message: "nested detail" } }, "nested detail"],
  [
    { detail: [{ loc: ["body", "questions", "q"], msg: "missing" }, { msg: "invalid" }, null, {}] },
    "questions.q: missing; invalid",
  ],
  [{ detail: [] }, '{"detail":[]}'],
  [null, "null"],
  [42, "42"],
  [{ error: {} }, '{"error":{}}'],
  ["", ""],
] as const)("formats error response messages %#", ([body, message]) =>
  Effect.gen(function* () {
    const { http } = mockHttp(() => Effect.sync(() => jsonResponse(body, 400)));
    const error = yield* (yield* makeClient(http)).models.list().pipe(Effect.flip);
    expect(error.message).toBe(`400 ${message}`);
  }),
);

it.effect.each([
  ["", "400 status code (no body)"],
  ["plain non-JSON text", "400 plain non-JSON text"],
  [
    JSON.stringify({ unknown: "x".repeat(300) }),
    `400 ${JSON.stringify({ unknown: "x".repeat(300) }).slice(0, 200)}…`,
  ],
])("retains raw error bodies without a content type %#", ([body, message]) =>
  Effect.gen(function* () {
    const { http } = mockHttp(() => Effect.succeed(new Response(body, { status: 400 })));
    const error = yield* (yield* makeClient(http)).models.list().pipe(Effect.flip);
    expect(error.message).toBe(message);
  }),
);
