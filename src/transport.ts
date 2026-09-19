import { Clock, Effect, Ref, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { ResolvedConfig } from "./env.ts";
import { Timeout } from "./env.ts";
import {
  APIConnectionError,
  APITimeoutError,
  fromResponse,
  InvalidRequestError,
  ResponseValidationError,
  type TypeSafeError,
} from "./errors.ts";
import { parseRetryAfter, resolveRetryPolicy, retrySchedule } from "./retry.ts";
import { describeRuntime } from "./runtime.ts";
import type { RequestOptions, WithResponse } from "./types.ts";
import { VERSION } from "./version.ts";

/** HTTP requests with decoded data and buffered response metadata. */
export interface Transport {
  readonly request: <A>(
    method: "GET" | "POST",
    path: string,
    schema: Schema.Codec<A>,
    options?: RequestOptions,
    body?: string,
  ) => Effect.Effect<WithResponse<A>, TypeSafeError>;
}

/** Build an Effect transport from the caller's HTTP client. */
export const makeTransport = (config: ResolvedConfig, http: HttpClient.HttpClient): Transport => {
  const client = HttpClient.withScope(http);
  const request: Transport["request"] = (method, path, schema, options = {}, body) =>
    Effect.gen(function* () {
      const timeout = yield* Schema.decodeEffect(Timeout)(options.timeout ?? config.timeout).pipe(
        Effect.mapError(
          (cause) =>
            new InvalidRequestError({ message: `Invalid timeout: ${cause.message}`, cause }),
        ),
      );
      const policy = yield* resolveRetryPolicy(config.retry, options.retry).pipe(
        Effect.mapError(
          (cause) =>
            new InvalidRequestError({ message: `Invalid retry policy: ${cause.message}`, cause }),
        ),
      );
      const base = HttpClientRequest.make(method)(`${config.baseURL}${path}`).pipe(
        HttpClientRequest.setHeaders(config.defaultHeaders),
        HttpClientRequest.setHeaders(options.headers ?? {}),
        HttpClientRequest.bearerToken(config.apiKey),
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader("user-agent", `@compootor/effective-jev/${VERSION}`),
        HttpClientRequest.setHeader("x-typesafe-sdk", `@compootor/effective-jev/${VERSION}`),
        HttpClientRequest.setHeader("x-typesafe-runtime", describeRuntime()),
        HttpClientRequest.removeHeader("content-type"),
        HttpClientRequest.removeHeader("x-typesafe-retry-count"),
      );
      const prepared =
        body === undefined ? base : HttpClientRequest.bodyText(base, body, "application/json");
      const attempts = yield* Ref.make(0);
      const attempt = Effect.gen(function* () {
        const count = yield* Ref.getAndUpdate(attempts, (current) => current + 1);
        const current =
          count === 0
            ? prepared
            : HttpClientRequest.setHeader(prepared, "x-typesafe-retry-count", String(count));
        const response = yield* client.execute(current);
        const text = yield* response.text;
        const requestId = response.headers["x-typesafe-request-id"];
        yield* Effect.logDebug("TypeSafe response received").pipe(
          Effect.annotateLogs({ method, path, status: response.status, requestId, attempt: count }),
        );
        if (response.status < 200 || response.status >= 300) {
          const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
            text,
          ).pipe(Effect.orElseSucceed(() => (text.length === 0 ? undefined : text)));
          return yield* fromResponse(
            response.status,
            parsed,
            response.headers,
            parseRetryAfter(response.headers, yield* Clock.currentTimeMillis),
          );
        }
        const data = yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
          Effect.mapError(
            (cause) =>
              new ResponseValidationError({
                message: `Invalid response from ${method} ${path}: ${cause.message}`,
                cause,
                requestId,
              }),
          ),
        );
        return { data, response, requestId };
      }).pipe(
        Effect.catchTag("HttpClientError", (cause) =>
          Effect.fail(
            new APIConnectionError({
              message: "TypeSafe request or response body delivery failed.",
              cause,
            }),
          ),
        ),
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(
              new APITimeoutError({
                message: `Request timed out after ${timeout}ms.`,
                timeoutMs: timeout,
              }),
            ),
        }),
      );
      return yield* attempt.pipe(Effect.retry(retrySchedule(policy)));
    }).pipe(Effect.withSpan(`TypeSafe ${method} ${path}`));
  return { request };
};
