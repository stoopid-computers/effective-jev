import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { pkg, roundTrip } from "./helpers";

const require = createRequire(import.meta.url);
const sdk: typeof import("../../dist/index.mjs") = require("../../dist/index.cjs");

describe("CommonJS package", () => {
  it("uses the built exports with the same Effect runtime", async () => roundTrip(sdk));
  it("resolves through the public package name", () => {
    const installed = require(pkg.name);
    expect(installed.TypeSafeClient.key).toBe(sdk.TypeSafeClient.key);
  });
});
