import { createServer, type ServerResponse } from "node:http";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { noul, TypeSafeClient, type TypeSafeClientConfig } from "../src";
import { ANSWER, MODEL, MODEL_BODY } from "./helpers";

const withServer = async (
  handler: (response: ServerResponse, index: number) => void,
  run: (baseURL: string) => Promise<void>,
): Promise<void> => {
  let count = 0;
  const server = createServer((_request, response) => handler(response, count++));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("Missing server address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

const make = (baseURL: string, config: TypeSafeClientConfig = {}) =>
  TypeSafeClient.make({ apiKey: "native-test", baseURL, ...config }).pipe(
    Effect.provide(FetchHttpClient.layer),
  );

describe("FetchHttpClient over real HTTP", () => {
  it("drains delayed body chunks and keeps raw metadata readable", async () => {
    await withServer(
      (response) => {
        response.writeHead(200, {
          "content-type": "application/json",
          "x-typesafe-request-id": "req_native",
        });
        const text = JSON.stringify(MODEL_BODY);
        response.write(text.slice(0, 10));
        setTimeout(() => response.end(text.slice(10)), 20);
      },
      async (baseURL) => {
        const client = await Effect.runPromise(make(baseURL));
        const result = await Effect.runPromise(client.models.listWithResponse());
        expect(result.data).toEqual([MODEL]);
        expect(result.requestId).toBe("req_native");
        expect(await Effect.runPromise(result.response.json)).toEqual(MODEL_BODY);
      },
    );
  });

  it("times out a stalled response body and retries the whole request", async () => {
    let attempts = 0;
    await withServer(
      (response, index) => {
        attempts++;
        response.writeHead(200, { "content-type": "application/json" });
        if (index === 0) response.write('{"models":');
        else response.end(JSON.stringify(MODEL_BODY));
      },
      async (baseURL) => {
        const client = await Effect.runPromise(
          make(baseURL, { timeout: 100, retry: { maxRetries: 1, backoffInitialMs: 0 } }),
        );
        expect(await Effect.runPromise(client.models.list())).toEqual([MODEL]);
        expect(attempts).toBe(2);
      },
    );
  });

  it("retries a response body connection failure", async () => {
    let attempts = 0;
    await withServer(
      (response, index) => {
        attempts++;
        if (index === 0) {
          response.writeHead(200, { "content-type": "application/json", "content-length": "999" });
          response.write('{"models":');
          setTimeout(() => response.destroy(), 10);
        } else response.end(JSON.stringify(MODEL_BODY));
      },
      async (baseURL) => {
        const client = await Effect.runPromise(
          make(baseURL, { retry: { maxRetries: 1, backoffInitialMs: 0 } }),
        );
        expect(await Effect.runPromise(client.models.list())).toEqual([MODEL]);
        expect(attempts).toBe(2);
      },
    );
  });

  it("supports AbortSignal at the Effect runner boundary", async () => {
    let received: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    await withServer(
      (response) => {
        response.writeHead(200);
        response.write("{");
        received?.();
      },
      async (baseURL) => {
        const client = await Effect.runPromise(make(baseURL));
        const controller = new AbortController();
        const running = Effect.runPromiseExit(client.models.list(), { signal: controller.signal });
        await started;
        controller.abort();
        const exit = await running;
        expect(exit._tag).toBe("Failure");
      },
    );
  });

  it("supports fetch injection through the native Fetch reference and layerFetch", async () => {
    const calls: RequestInit[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init) calls.push(init);
      return new Response(JSON.stringify(ANSWER));
    };
    const layer = TypeSafeClient.layerFetch({ apiKey: "secret" }).pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );
    const program = Effect.gen(function* () {
      const client = yield* TypeSafeClient;
      return yield* client.systemOne({ state: "hello", questions: { ok: noul() } });
    });
    expect(await Effect.runPromise(program.pipe(Effect.provide(layer)))).toEqual(ANSWER);
    expect(calls).toHaveLength(1);
  });
});
