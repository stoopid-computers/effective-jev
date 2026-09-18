import { readFileSync } from "node:fs";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export const pkg: { name: string; version: string } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
export const BODY = {
  model: "jev-latest",
  answers: {
    ok: { type: "noul", noul: 0.9 },
    tone: {
      type: "choice",
      choice: "warm",
      confidence: 0.8,
      probabilities: { warm: 0.8, cold: 0.2 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};

/** Exercise built exports against an injected fetch transport. */
export const roundTrip = async (sdk: typeof import("../../dist/index.mjs")): Promise<void> => {
  const fetch: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify(BODY), { headers: { "x-typesafe-request-id": "req_dist" } });
  const layer = sdk.TypeSafeClient.layerFetch({ apiKey: "test" }).pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  const program = sdk.TypeSafeClient.use((client) =>
    client.systemOneWithResponse({
      state: null,
      questions: { ok: sdk.noul(), tone: sdk.choice(null, { warm: null, cold: null }) },
    }),
  );
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  if (result.data.answers.tone.choice !== "warm" || result.requestId !== "req_dist")
    throw new Error("Built package request failed");
  if (JSON.stringify(await Effect.runPromise(result.response.json)) !== JSON.stringify(BODY))
    throw new Error("Built package lost response metadata");
};
