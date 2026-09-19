import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registryJson, run, visible } from "./registry.mjs";
import { artifact, sourceManifest, validateRelease } from "./release-lib.mjs";

const versionUrl = (info) => `https://jsr.io/${info.name}/${info.version}_meta.json`;

export async function verifyJsr(info, manifest, read = registryJson) {
  const published = await visible(versionUrl(info), read);
  assert.deepEqual(
    published.manifest,
    manifest,
    "This JSR version contains different files. Choose a new version.",
  );
  const pkg = await read(`https://jsr.io/${info.name}/meta.json`);
  assert.notEqual(pkg?.versions?.[info.version]?.yanked, true, "This JSR version has been yanked.");
}

export async function publishJsr(info, manifest, { read = registryJson, execute = run } = {}) {
  const existing = await read(versionUrl(info));
  if (existing !== undefined) {
    assert.deepEqual(
      existing.manifest,
      manifest,
      "This JSR version contains different files. Choose a new version.",
    );
  } else {
    execute("npm", ["exec", "--no", "--", "jsr", "publish"]);
  }
  await verifyJsr(info, manifest, read);
  console.log(`Verified ${info.name}@${info.version} on JSR.`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  assert.equal(process.argv.length, 2, "publish-jsr takes no arguments.");
  validateRelease({ remote: true, publish: true });
  await publishJsr(artifact(), sourceManifest(process.cwd(), true));
}
