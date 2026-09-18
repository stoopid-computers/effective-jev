import { expect, it } from "@effect/vitest";
import { Effect, Logger, References } from "effect";
import { noul } from "../src";
import { ANSWER, jsonResponse, makeClient, mockHttp } from "./helpers";

it.effect("uses the caller's Effect logger without logging credentials or bodies", () =>
  Effect.gen(function* () {
    const entries: unknown[] = [];
    const logger = Logger.make((options) =>
      entries.push({
        message: options.message,
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      }),
    );
    const { http } = mockHttp((_, index) =>
      Effect.sync(() => jsonResponse(index === 0 ? {} : ANSWER, index === 0 ? 429 : 200)),
    );
    const client = yield* makeClient(http, { retry: { backoffInitialMs: 0 } });
    yield* client
      .systemOne({ state: "sensitive request text", questions: { ok: noul() } })
      .pipe(
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "Debug"),
      );
    expect(entries).toHaveLength(3);
    const serialized = JSON.stringify(entries);
    expect(serialized).toContain("Retrying TypeSafe request");
    expect(serialized).toContain("RateLimitError");
    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("sensitive request text");
  }),
);
