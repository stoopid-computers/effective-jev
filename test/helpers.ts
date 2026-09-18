import { Effect } from "effect";
import {
  HttpClient,
  type HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  TypeSafeClient,
  type TypeSafeClientConfig,
  type TypeSafeClientService,
  type TypeSafeConfigError,
} from "../src";

export interface RecordedRequest {
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly url: URL;
  readonly signal: AbortSignal;
}

export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string | undefined> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    },
  });

export const MODEL = { name: "jev-latest", description: "Jev", release_date: "2026-09-01" };
export const MODEL_BODY = { models: [MODEL] };
export const ANSWER = {
  model: "jev-latest",
  answers: { ok: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 2 },
};

export const mockHttp = (
  handler: (
    call: RecordedRequest,
    index: number,
  ) => Effect.Effect<Response, HttpClientError.HttpClientError> = () =>
    Effect.sync(() => jsonResponse(MODEL_BODY)),
): { http: HttpClient.HttpClient; calls: RecordedRequest[] } => {
  const calls: RecordedRequest[] = [];
  const http = HttpClient.make((request, url, signal) =>
    Effect.suspend(() => {
      const call = { request, url, signal };
      calls.push(call);
      return handler(call, calls.length - 1).pipe(
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      );
    }),
  );
  return { http, calls };
};

export const makeClient = (
  http: HttpClient.HttpClient,
  options: TypeSafeClientConfig = {},
): Effect.Effect<TypeSafeClientService, TypeSafeConfigError> =>
  TypeSafeClient.make({ apiKey: "test-secret", baseURL: "https://typesafe.test", ...options }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
  );

export const requestBody = (call: RecordedRequest | undefined): unknown => {
  if (call?.request.body._tag !== "Uint8Array") throw new Error("Expected a JSON body");
  return JSON.parse(new TextDecoder().decode(call.request.body.body));
};
