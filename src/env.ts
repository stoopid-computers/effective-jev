import { Config, ConfigProvider, Context, Effect, Redacted, Schema } from "effect";
import { TypeSafeConfigError } from "./errors.ts";
import { DEFAULT_RETRY_POLICY, DEFAULT_TIMEOUT_MS, resolveRetryPolicy } from "./retry.ts";
import { isBrowser } from "./runtime.ts";
import type { RetryPolicy, TypeSafeClientConfig } from "./types.ts";

/** Configuration keys read through Effect's ConfigProvider. */
export const ENV = {
  apiKey: "TYPESAFE_API_KEY",
  baseURL: "TYPESAFE_BASE_URL",
  defaultModel: "TYPESAFE_DEFAULT_MODEL",
} as const;
export type EnvVar = (typeof ENV)[keyof typeof ENV];

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
export const Timeout = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0));

export interface ResolvedConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly timeout: number;
  readonly retry: RetryPolicy;
  readonly defaultHeaders: Readonly<Record<string, string>>;
}

const textConfig = (
  value: string | undefined,
  key: EnvVar,
  fallback: string,
): Effect.Effect<string, Config.ConfigError | Schema.SchemaError> =>
  value === undefined
    ? Config.string(key).pipe(
        Config.withDefault(fallback),
        Effect.map((text) => text.trim() || fallback),
      )
    : Schema.decodeEffect(Schema.String)(value);

const resolveWithProvider = (
  options: TypeSafeClientConfig,
): Effect.Effect<ResolvedConfig, TypeSafeConfigError> =>
  Effect.gen(function* () {
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      return yield* new TypeSafeConfigError({
        message:
          "TypeSafeClient would expose your API key in this browser. Use a server, or explicitly set dangerouslyAllowBrowser: true.",
      });
    }
    const apiKey =
      options.apiKey === undefined
        ? yield* Config.redacted(ENV.apiKey).pipe(
            Effect.map((secret) => Redacted.make(Redacted.value(secret).trim())),
          )
        : typeof options.apiKey === "string"
          ? Redacted.make(options.apiKey)
          : yield* Schema.decodeEffect(Schema.Redacted(Schema.String))(options.apiKey);
    if (!Redacted.value(apiKey).trim()) {
      return yield* new TypeSafeConfigError({ message: `Provide apiKey or set ${ENV.apiKey}.` });
    }
    const baseURL = (yield* textConfig(options.baseURL, ENV.baseURL, DEFAULT_BASE_URL)).replace(
      /\/+$/,
      "",
    );
    yield* Effect.try({
      try: () => {
        const url = new URL(baseURL);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      },
      catch: () =>
        new TypeSafeConfigError({
          message:
            "baseURL must be an HTTP or HTTPS URL without credentials, a query, or a fragment.",
        }),
    });
    const defaultModel = yield* textConfig(options.defaultModel, ENV.defaultModel, DEFAULT_MODEL);
    yield* Schema.decodeEffect(Schema.NonEmptyString)(defaultModel);
    const timeout = yield* Schema.decodeEffect(Timeout)(options.timeout ?? DEFAULT_TIMEOUT_MS);
    const retry = yield* resolveRetryPolicy(DEFAULT_RETRY_POLICY, options.retry);
    return {
      apiKey,
      baseURL,
      defaultModel,
      timeout,
      retry,
      defaultHeaders: { ...options.defaultHeaders },
    };
  }).pipe(
    Effect.mapError((cause) =>
      cause._tag === "TypeSafeConfigError"
        ? cause
        : new TypeSafeConfigError({
            message:
              cause._tag === "ConfigError"
                ? `Cannot load TypeSafe configuration: ${cause.message}`
                : `Invalid TypeSafe configuration: ${cause.message}`,
          }),
    ),
  );

/** Resolve explicit settings before consulting the active ConfigProvider. */
export const resolveConfig = (
  options: TypeSafeClientConfig,
): Effect.Effect<ResolvedConfig, TypeSafeConfigError> =>
  Effect.contextWith((context) => {
    const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
    if (!deno || Context.getOrUndefined(context, ConfigProvider.ConfigProvider) !== undefined) {
      return resolveWithProvider(options);
    }
    // Effect's default provider enumerates process.env, which needs unrestricted
    // environment access in Deno. Read only settings not supplied by the caller.
    return Effect.gen(function* () {
      const values: Record<string, string | undefined> = {};
      for (const option of ["apiKey", "baseURL", "defaultModel"] as const) {
        if (options[option] !== undefined) continue;
        const key = ENV[option];
        values[key] = yield* Effect.try({
          try: () => deno.env.get(key),
          catch: () =>
            new TypeSafeConfigError({
              message: `Cannot read ${key}. Grant --allow-env=${key} or provide ${option} explicitly.`,
            }),
        });
      }
      return yield* resolveWithProvider(options).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(values)),
      );
    });
  });
