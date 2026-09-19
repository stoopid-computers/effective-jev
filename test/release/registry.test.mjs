import assert from "node:assert/strict";
import { test } from "node:test";
import { visible } from "../../scripts/registry.mjs";

test("waits for an accepted upload that takes four minutes to become visible", async () => {
  let elapsed = 0;
  const version = { version: "0.0.4" };
  const result = await visible(
    "https://registry.invalid/package/0.0.4",
    async () => (elapsed < 240_000 ? undefined : version),
    async (delay) => {
      elapsed += delay;
    },
  );
  assert.deepEqual(result, version);
  assert.equal(elapsed, 240_000);
});

test("stops waiting after five minutes without treating lookup errors as missing versions", async () => {
  let elapsed = 0;
  const wait = async (delay) => {
    elapsed += delay;
  };
  await assert.rejects(
    visible("https://registry.invalid/package", async () => undefined, wait),
    /not visible yet/,
  );
  assert.equal(elapsed, 300_000);
  elapsed = 0;
  await assert.rejects(
    visible(
      "https://registry.invalid/package",
      async () => {
        throw new Error("Unauthorized");
      },
      wait,
    ),
    /Unauthorized/,
  );
  assert.equal(elapsed, 0);
});
