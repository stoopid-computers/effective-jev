import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { HttpClient } from "effect/unstable/http";
import { afterEach, vi } from "vitest";
import {
  choice,
  noul,
  type SystemOneRequest,
  score,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "../src";
import {
  ANSWER,
  jsonResponse,
  MODEL,
  MODEL_BODY,
  makeClient,
  mockHttp,
  requestBody,
} from "./helpers";

const configProvider = (values: Record<string, string | undefined>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values));

describe("configuration and layers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect("loads credentials and settings through ConfigProvider", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* TypeSafeClient.make().pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        configProvider({
          TYPESAFE_API_KEY: " provider-secret \n",
          TYPESAFE_BASE_URL: "https://custom.test///",
          TYPESAFE_DEFAULT_MODEL: "jev-pinned",
        }),
      );
      expect(client.baseURL).toBe("https://custom.test");
      expect(client.defaultModel).toBe("jev-pinned");
      yield* client.models.list();
      expect(calls[0]?.request.headers.authorization).toBe("Bearer provider-secret");
      expect(JSON.stringify(client)).not.toContain("provider-secret");
    }),
  );

  it.effect("uses defaults for missing and blank optional environment settings", () =>
    Effect.gen(function* () {
      const { http } = mockHttp();
      for (const env of [{}, { TYPESAFE_BASE_URL: " ", TYPESAFE_DEFAULT_MODEL: " " }]) {
        const client = yield* TypeSafeClient.make({ apiKey: "key" }).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          configProvider(env),
        );
        expect(client.baseURL).toBe("https://api.typesafe.ai");
        expect(client.defaultModel).toBe("jev-latest");
      }
    }),
  );

  it.effect("gives explicit settings precedence and accepts Redacted credentials", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* makeClient(http, {
        apiKey: Redacted.make("explicit"),
        defaultModel: "jev-fixed",
      }).pipe(configProvider({ TYPESAFE_API_KEY: "env", TYPESAFE_DEFAULT_MODEL: "env" }));
      yield* client.models.list();
      expect(client.defaultModel).toBe("jev-fixed");
      expect(calls[0]?.request.headers.authorization).toBe("Bearer explicit");
    }),
  );

  it.effect("reports a missing credential as a typed configuration failure", () =>
    Effect.gen(function* () {
      const { http } = mockHttp();
      const error = yield* TypeSafeClient.make().pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        configProvider({}),
        Effect.flip,
      );
      expect(error._tag).toBe("TypeSafeConfigError");
      expect(error.message).toContain("TYPESAFE_API_KEY");
    }),
  );

  it.effect("reads individual Deno environment keys without enumerating the environment", () =>
    Effect.gen(function* () {
      const values: Record<string, string> = { TYPESAFE_API_KEY: " deno-secret " };
      const get = vi.fn((key: string) => values[key]);
      vi.stubGlobal("Deno", { env: { get } });
      const { http, calls } = mockHttp();
      const client = yield* TypeSafeClient.make({ baseURL: "https://deno.test" }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      yield* client.models.list();
      expect(client.defaultModel).toBe("jev-latest");
      expect(calls[0]?.request.headers.authorization).toBe("Bearer deno-secret");
      expect(get.mock.calls).toEqual([["TYPESAFE_API_KEY"], ["TYPESAFE_DEFAULT_MODEL"]]);
    }),
  );

  it.effect("preserves an explicit ConfigProvider in Deno without reading the environment", () =>
    Effect.gen(function* () {
      const get = vi.fn(() => {
        throw new Error("Denied");
      });
      vi.stubGlobal("Deno", { env: { get } });
      const client = yield* makeClient(mockHttp().http).pipe(
        configProvider({ TYPESAFE_DEFAULT_MODEL: "custom-model" }),
      );
      expect(client.defaultModel).toBe("custom-model");
      expect(get).not.toHaveBeenCalled();
    }),
  );

  it.effect("returns a typed Deno permission error with the missing key", () =>
    Effect.gen(function* () {
      vi.stubGlobal("Deno", {
        env: {
          get: () => {
            throw new Error("Denied");
          },
        },
      });
      const error = yield* makeClient(mockHttp().http).pipe(Effect.flip);
      expect(error._tag).toBe("TypeSafeConfigError");
      expect(error.message).toContain("--allow-env=TYPESAFE_DEFAULT_MODEL");
    }),
  );

  it.effect.each([
    { apiKey: " " },
    { baseURL: "not a URL" },
    { baseURL: "file:///tmp" },
    { baseURL: "https://user:pass@test" },
    { baseURL: "https://test?q=1" },
    { baseURL: "https://test#fragment" },
    { defaultModel: "" },
    { timeout: 0 },
    { timeout: -1 },
    { timeout: Number.NaN },
    { timeout: Number.POSITIVE_INFINITY },
    { retry: { maxRetries: -1 } },
    { retry: { maxRetries: 1.5 } },
    { retry: { backoffInitialMs: -1 } },
    { retry: { backoffMaxMs: Number.NaN } },
    { retry: { backoffJitter: 2 } },
    { retry: { maxRetryAfterMs: -1 } },
    { retry: { httpStatuses: new Set([99]) } },
  ] satisfies TypeSafeClientConfig[])("rejects invalid configuration %#", (options) =>
    Effect.gen(function* () {
      const error = yield* makeClient(mockHttp().http, options).pipe(Effect.flip);
      expect(error._tag).toBe("TypeSafeConfigError");
    }),
  );

  it.effect("guards browser use unless explicitly enabled", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", { document: {} });
      vi.stubGlobal("navigator", {});
      const error = yield* makeClient(mockHttp().http).pipe(Effect.flip);
      expect(error.message).toContain("browser");
      const client = yield* makeClient(mockHttp().http, { dangerouslyAllowBrowser: true });
      expect(yield* client.models.list()).toEqual([MODEL]);
    }),
  );

  it.effect("provides an injectable service through Layer", () =>
    Effect.gen(function* () {
      const { http } = mockHttp();
      const program = Effect.gen(function* () {
        return yield* (yield* TypeSafeClient).models.list();
      });
      const layer = TypeSafeClient.layer({ apiKey: "key" }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      );
      expect(yield* program.pipe(Effect.provide(layer))).toEqual([MODEL]);
    }),
  );
});

describe("requests", () => {
  it.effect("is lazy and sends a new request each time an Effect runs", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* makeClient(http);
      const operation = client.models.list();
      expect(calls).toHaveLength(0);
      expect(yield* operation).toEqual([MODEL]);
      expect(yield* operation).toEqual([MODEL]);
      expect(calls).toHaveLength(2);
    }),
  );

  it.effect("merges headers case insensitively and protects SDK headers", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp(() => Effect.sync(() => jsonResponse(ANSWER)));
      const client = yield* makeClient(http, {
        defaultHeaders: {
          "X-Custom": "base",
          AUTHORIZATION: "fake",
          "CONTENT-TYPE": "bad",
          "X-TypeSafe-Retry-Count": "50",
        },
      });
      yield* client.systemOne(
        { state: null, questions: { ok: noul() } },
        {
          headers: {
            "x-custom": "call",
            ACCEPT: "bad",
            "X-TYPESAFE-SDK": "bad",
            "User-Agent": "bad",
            "X-TypeSafe-Runtime": "bad",
          },
        },
      );
      const headers = calls[0]?.request.headers;
      expect(headers).toMatchObject({
        authorization: "Bearer test-secret",
        "x-custom": "call",
        "content-type": "application/json",
        accept: "application/json",
      });
      expect(headers?.["x-typesafe-retry-count"]).toBeUndefined();
      expect(headers?.["x-typesafe-sdk"]).toMatch(/^@compootor\/effective-jev\//);
      expect(headers?.["user-agent"]).toMatch(/^@compootor\/effective-jev\//);
      expect(headers?.["x-typesafe-runtime"]).toContain("node/");
    }),
  );

  it.effect("omits content type and body on model requests", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* makeClient(http, { defaultHeaders: { "Content-Type": "bad" } });
      yield* client.models.list();
      expect(calls[0]?.request.headers["content-type"]).toBeUndefined();
      expect(calls[0]?.request.body._tag).toBe("Empty");
      expect(calls[0]?.url.href).toBe("https://typesafe.test/v1/models");
    }),
  );

  it.effect("preserves nulls, extra fields, structured descriptions, and model overrides", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp(() => Effect.sync(() => jsonResponse(ANSWER)));
      const client = yield* makeClient(http, { defaultModel: "default" });
      const request = {
        state: [null, { text: "hello" }],
        questions: { ok: { type: "noul" as const, criteria: { true: { examples: ["yes"] } } } },
        model: "override",
        extra: null,
      };
      yield* client.systemOne(request);
      expect(requestBody(calls[0])).toEqual(request);
      yield* client.systemOne({ state: null, questions: { ok: noul(null, { false: null }) } });
      expect(requestBody(calls[1])).toEqual({
        state: null,
        questions: { ok: { type: "noul", instructions: null, criteria: { false: null } } },
        model: "default",
      });
    }),
  );

  it.effect("retains raw bodies and response metadata after decoding", () =>
    Effect.gen(function* () {
      const raw = { ...MODEL_BODY, internal: { account: true } };
      const { http } = mockHttp(() =>
        Effect.sync(() => jsonResponse(raw, 200, { "x-typesafe-request-id": "req_test" })),
      );
      const client = yield* makeClient(http);
      const result = yield* client.models.listWithResponse();
      expect(result.data).toEqual([MODEL]);
      expect(result.requestId).toBe("req_test");
      expect(result.response.status).toBe(200);
      expect(JSON.parse(yield* result.response.text)).toEqual(raw);
      expect(yield* result.response.json).toEqual(raw);
    }),
  );

  it.effect("preserves own __proto__ question and criteria names", () =>
    Effect.gen(function* () {
      const questions = { ["__proto__"]: choice(null, { ["__proto__"]: null, other: null }) };
      const body = {
        ...ANSWER,
        answers: {
          ["__proto__"]: {
            type: "choice",
            choice: "__proto__",
            confidence: 0.9,
            probabilities: { ["__proto__"]: 0.9, other: 0.1 },
          },
        },
      };
      const { http, calls } = mockHttp(() => Effect.sync(() => jsonResponse(body)));
      const result = yield* (yield* makeClient(http)).systemOne({ state: null, questions });
      expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
      expect(result.answers).toEqual(body.answers);
      expect(requestBody(calls[0])).toMatchObject({ questions });
    }),
  );

  it.effect.each([
    { state: null, questions: {} },
    { state: 1, questions: { ok: noul() } },
    { state: null, questions: { q: { type: "score", criteria: ["one"] } } },
    { state: null, questions: { q: { type: "score", criteria: { 0: "a", 1: "b" } } } },
    { state: null, questions: { q: { type: "choice", criteria: [] } } },
    { state: null, questions: { q: { type: "choice", criteria: {} } } },
    { state: null, questions: { q: { type: "noul", instructions: 1 } } },
    { state: null, questions: { q: { type: "unknown" } } },
  ])("validates malformed JavaScript input before sending %#", (request) =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* makeClient(http);
      const error = yield* client
        .systemOne(request as unknown as SystemOneRequest)
        .pipe(Effect.flip);
      expect(error._tag).toBe("InvalidRequestError");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("fails cycles and bigint encoding in the error channel", () =>
    Effect.gen(function* () {
      const { http, calls } = mockHttp();
      const client = yield* makeClient(http);
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      for (const state of [cycle, { bigint: 1n }]) {
        const error = yield* client
          .systemOne({ state, questions: { ok: noul() } } as SystemOneRequest)
          .pipe(Effect.flip);
        expect(error._tag).toBe("InvalidRequestError");
      }
      expect(calls).toHaveLength(0);
    }),
  );

  it("builds questions as plain values with rich criteria", () => {
    expect(noul()).toEqual({ type: "noul", instructions: null, criteria: undefined });
    expect(choice(null, { yes: ["a"], no: null })).toEqual({
      type: "choice",
      instructions: null,
      criteria: { yes: ["a"], no: null },
    });
    expect(score("level", [null, { text: "high" }]).criteria).toEqual([null, { text: "high" }]);
  });
});
