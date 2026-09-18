// Install the packed artifact in a clean consumer and exercise both package exports.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { artifact } from "./release-lib.mjs";

const { tarball } = artifact();
const consumer = mkdtempSync(join(tmpdir(), "effective-jev-consumer-"));
try {
  writeFileSync(join(consumer, "package.json"), '{"private":true}');
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(tarball)],
    { cwd: consumer, stdio: "inherit" },
  );
  for (const type of ["commonjs", "module"]) {
    const load =
      type === "module"
        ? 'import * as sdk from "@compootor/effective-jev"; import { Effect, Layer } from "effect"; import { FetchHttpClient } from "effect/unstable/http";'
        : 'const sdk = require("@compootor/effective-jev"); const { Effect, Layer } = require("effect"); const { FetchHttpClient } = require("effect/unstable/http");';
    execFileSync(
      process.execPath,
      [
        "--input-type",
        type,
        "--eval",
        `${load}
      if (typeof sdk.TypeSafeClient !== "function" || typeof sdk.choice !== "function")
        throw new Error("Missing package exports");
      const fetch = async () => new Response(JSON.stringify({ models: [{ name: "jev-latest", description: "Jev", release_date: "2026-09-01" }] }));
      const layer = sdk.TypeSafeClient.layerFetch({ apiKey: "package-smoke-test" }).pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));
      const program = sdk.TypeSafeClient.use((client) => client.models.list()).pipe(Effect.provide(layer));
      Effect.runPromise(program).then((models) => {
        if (models[0]?.name !== "jev-latest") throw new Error("Installed client request failed");
      }).catch((error) => { console.error(error); process.exitCode = 1; });
    `,
      ],
      { cwd: consumer, stdio: "inherit" },
    );
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
