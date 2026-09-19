import assert from "node:assert/strict";
import { ConfigProvider, Effect } from "effect";
import { noul, TypeSafeClient, type TypeSafeClientConfig } from "@compootor/effective-jev";

const model = { name: "jev-latest", description: "Jev", release_date: "2026-09-01" };
const answer = {
  model: "jev-latest",
  answers: { ok: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 2 },
};
const explicit: TypeSafeClientConfig = { apiKey: "deno-test-key", defaultModel: "jev-latest" };

const withServer = async (
  handler: (request: Request) => Response | Promise<Response>,
  run: (baseURL: string) => Promise<void>,
): Promise<void> => {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
  try {
    await run(`http://127.0.0.1:${server.addr.port}`);
  } finally {
    await server.shutdown();
  }
};

Deno.test("loads only the SDK environment variables and sends Deno headers", async () => {
  const keys = ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_DEFAULT_MODEL"];
  const previous = keys.map((key) => Deno.env.get(key));
  const requests: Headers[] = [];
  try {
    await withServer(
      (request) => {
        requests.push(new Headers(request.headers));
        return Response.json({ models: [model] }, { headers: { "x-typesafe-request-id": "deno" } });
      },
      async (baseURL) => {
        Deno.env.set("TYPESAFE_API_KEY", " deno-test-key ");
        Deno.env.set("TYPESAFE_BASE_URL", baseURL);
        Deno.env.delete("TYPESAFE_DEFAULT_MODEL");
        const result = await Effect.runPromise(
          TypeSafeClient.use((client) => client.models.listWithResponse()).pipe(
            Effect.provide(TypeSafeClient.layerFetch()),
          ),
        );
        assert.deepEqual(result.data, [model]);
        assert.equal(result.requestId, "deno");
        assert.deepEqual(await Effect.runPromise(result.response.json), { models: [model] });
        assert.equal(requests[0]?.get("authorization"), "Bearer deno-test-key");
        assert.match(requests[0]?.get("x-typesafe-runtime") ?? "", /^deno\//);
      },
    );
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
  }
});

Deno.test({
  name: "uses explicit settings and a custom ConfigProvider without environment access",
  permissions: { env: false, net: ["127.0.0.1"] },
  async fn() {
    await withServer(
      () => Response.json({ models: [model] }),
      async (baseURL) => {
        const program = TypeSafeClient.use((client) => client.models.list());
        assert.deepEqual(
          await Effect.runPromise(
            program.pipe(Effect.provide(TypeSafeClient.layerFetch({ ...explicit, baseURL }))),
          ),
          [model],
        );
        assert.deepEqual(
          await Effect.runPromise(
            program.pipe(
              Effect.provide(TypeSafeClient.layerFetch()),
              Effect.provideService(
                ConfigProvider.ConfigProvider,
                ConfigProvider.fromUnknown({
                  TYPESAFE_API_KEY: explicit.apiKey,
                  TYPESAFE_BASE_URL: baseURL,
                }),
              ),
            ),
          ),
          [model],
        );
      },
    );
  },
});

Deno.test({
  name: "reports denied environment access as a typed configuration error",
  permissions: { env: false },
  async fn() {
    const error = await Effect.runPromise(
      TypeSafeClient.use((client) => client.models.list()).pipe(
        Effect.provide(TypeSafeClient.layerFetch()),
        Effect.flip,
      ),
    );
    assert.equal(error._tag, "TypeSafeConfigError");
    assert.match(error.message, /--allow-env=TYPESAFE_API_KEY/);
  },
});

Deno.test("evaluates typed questions and retries an HTTP error using native fetch", async () => {
  let attempts = 0;
  const bodies: unknown[] = [];
  await withServer(
    async (request) => {
      attempts++;
      bodies.push(await request.json());
      return attempts === 1
        ? Response.json({ message: "Try again" }, { status: 503 })
        : Response.json(answer);
    },
    async (baseURL) => {
      const result = await Effect.runPromise(
        TypeSafeClient.use((client) =>
          client.systemOne({
            state: "hello",
            questions: { ok: noul() },
          }),
        ).pipe(
          Effect.provide(
            TypeSafeClient.layerFetch({
              ...explicit,
              baseURL,
              retry: { maxRetries: 1, backoffInitialMs: 0 },
            }),
          ),
        ),
      );
      const probability: number = result.answers.ok.noul;
      assert.equal(probability, 0.9);
      assert.equal(attempts, 2);
      assert.deepEqual(bodies[0], bodies[1]);
    },
  );
});

Deno.test("maps an authentication response to the typed error channel", async () => {
  await withServer(
    () => Response.json({ message: "Invalid key" }, { status: 401 }),
    async (baseURL) => {
      const error = await Effect.runPromise(
        TypeSafeClient.use((client) => client.models.list()).pipe(
          Effect.provide(TypeSafeClient.layerFetch({ ...explicit, baseURL })),
          Effect.flip,
        ),
      );
      assert.equal(error._tag, "AuthenticationError");
    },
  );
});
