import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import * as sdk from "../../dist/index.mjs";
import { pkg, roundTrip } from "./helpers";

describe("ESM package", () => {
  it("uses the built exports to send a typed request", async () => roundTrip(sdk));
  it("reports the package version", () => expect(sdk.VERSION).toBe(pkg.version));
  it("resolves through the public package name", async () => {
    const installed = await import("@compootor/effective-jev");
    expect(installed.TypeSafeClient.key).toBe(sdk.TypeSafeClient.key);
  });
  it("supports typed error recovery from the bundle", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response('{"message":"invalid key"}', { status: 401 });
    const layer = sdk.TypeSafeClient.layerFetch({ apiKey: "bad" }).pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );
    const operation = sdk.TypeSafeClient.use((client) => client.models.list()).pipe(
      Effect.catchTag("AuthenticationError", (error) => Effect.succeed(error.status)),
      Effect.provide(layer),
    );
    expect(await Effect.runPromise(operation)).toBe(401);
  });
});
