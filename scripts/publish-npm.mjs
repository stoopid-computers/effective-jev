import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gt } from "semver";
import { verifyJsr } from "./publish-jsr.mjs";
import { registryJson, run, visible } from "./registry.mjs";
import { artifact, releaseInfo, sourceManifest, validateRelease } from "./release-lib.mjs";

const packageUrl = (info) => `https://registry.npmjs.org/${encodeURIComponent(info.name)}`;
const versionUrl = (info) => `${packageUrl(info)}/${info.version}`;
const sameArtifact = (published, info) => {
  assert.equal(published.name, info.name, "Registry returned another package.");
  assert.equal(published.version, info.version, "Registry returned another version.");
  assert.equal(
    published.dist?.integrity,
    info.integrity,
    "This npm version has different contents. Choose a new version.",
  );
};

export function npmTag(info, pkg) {
  const globalTag = info.prerelease ? "next" : "latest";
  const versions = Object.keys(pkg?.versions ?? {}).filter(
    (version) => releaseInfo(version).prerelease === info.prerelease,
  );
  const current = pkg?.["dist-tags"]?.[globalTag];
  if (current) versions.push(current);
  return versions.some((version) => gt(version, info.version)) ? info.channel : globalTag;
}

export async function publishNpm(info, { read = registryJson, execute = run } = {}) {
  const existing = await read(versionUrl(info));
  if (existing !== undefined) {
    sameArtifact(existing, info);
  } else {
    const pkg = await read(packageUrl(info));
    for (const version of Object.keys(pkg?.versions ?? {})) {
      const previous = releaseInfo(version);
      if (previous.channel === info.channel) {
        assert.ok(
          gt(info.version, version),
          `Version ${version} already exists on this release line.`,
        );
      }
    }
    execute("npm", [
      "publish",
      info.tarball,
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      npmTag(info, pkg),
      "--provenance",
      "--registry",
      "https://registry.npmjs.org",
    ]);
  }
  sameArtifact(await visible(versionUrl(info), read), info);
  console.log(`Verified ${info.name}@${info.version} on npm.`);
}

export async function verifyNpm(info, read = registryJson) {
  sameArtifact(await visible(versionUrl(info), read), info);
  const pkg = await read(packageUrl(info));
  assert.ok(pkg?.["dist-tags"], "npm package metadata is unavailable.");
  return !info.prerelease && pkg["dist-tags"].latest === info.version;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  assert.ok(
    process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--verify"),
    "Use --verify or no arguments.",
  );
  validateRelease({ remote: true, publish: true });
  const info = artifact();
  if (process.argv[2] === "--verify") {
    await verifyJsr(info, sourceManifest(process.cwd(), true));
    const latest = await verifyNpm(info);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `make_latest=${latest}\n`);
  } else {
    await publishNpm(info);
  }
}
