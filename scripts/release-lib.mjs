import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gt, SemVer } from "semver";
import { jsrImports } from "./jsr-imports.mjs";

export const packageName = "@compootor/effective-jev";
export const repository = "stoopid-computers/effective-jev";
export const json = (path) => JSON.parse(readFileSync(path, "utf8"));
export const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
export const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  `${algorithm}-${createHash(algorithm).update(bytes).digest(encoding)}`;

export function releaseInfo(version) {
  const parsed = new SemVer(version);
  assert.equal(
    parsed.version,
    version,
    "Use a canonical SemVer version, without v or build metadata.",
  );
  assert.equal(parsed.build.length, 0, "Build metadata is not supported for registry releases.");
  const line = `${parsed.major}.${parsed.minor}`;
  const prerelease = parsed.prerelease.length > 0;
  return {
    name: packageName,
    version,
    tag: `v${version}`,
    branch: `release/${line}`,
    prerelease,
    channel: `release-${line}${prerelease ? "-next" : ""}`,
    filename: `compootor-effective-jev-${version}.tgz`,
  };
}

export function metadata(cwd = process.cwd()) {
  const pkg = json(join(cwd, "package.json"));
  const lock = json(join(cwd, "package-lock.json"));
  const jsr = json(join(cwd, "jsr.json"));
  const info = releaseInfo(pkg.version);
  for (const [file, value] of [
    ["package.json", pkg],
    ["package-lock.json", lock],
    ["lockfile root", lock.packages[""]],
    ["jsr.json", jsr],
  ]) {
    assert.equal(value.name, packageName, `${file} must use ${packageName}.`);
    assert.equal(value.version, info.version, `${file} version must match package.json.`);
  }
  const runtime = readFileSync(join(cwd, "src/version.ts"), "utf8").match(
    /VERSION = "([^"]+)"/,
  )?.[1];
  assert.equal(runtime, info.version, "Runtime VERSION must match package.json.");
  assert.equal(
    pkg.repository.url,
    `git+https://github.com/${repository}.git`,
    "Wrong package repository.",
  );
  assert.equal(pkg.publishConfig.access, "public", "The scoped npm package must be public.");
  assert.equal(
    jsr.imports.effect,
    `npm:effect@${pkg.peerDependencies.effect}`,
    "JSR and npm must use the same Effect version.",
  );
  assert.equal(jsr.imports["effect/unstable/http"], `${jsr.imports.effect}/unstable/http`);
  // Keep the manifest used for retry verification identical to JSR's upload list.
  assert.deepEqual(jsr.publish.include, ["src/**/*.ts", "README.md", "LICENSE", "jsr.json"]);
  assert.deepEqual(jsr.publish.exclude, ["src/**/*.test.ts"]);
  return info;
}

export function releaseNotes(changelog, version) {
  const sections = changelog
    .split(/^## /m)
    .slice(1)
    .filter((part) => !part.startsWith("Unreleased\n"));
  const tag = releaseInfo(version).tag;
  const matches = sections.filter((part) => part.startsWith(`${tag} (`));
  assert.equal(matches.length, 1, `Expected exactly one changelog entry for ${tag}.`);
  assert.equal(matches[0], sections[0], `${tag} must be the first release in the changelog.`);
  const [title, ...lines] = matches[0].split("\n");
  const date = title.slice(tag.length + 2, -1);
  assert.equal(title, `${tag} (${date})`);
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(date).toISOString().slice(0, 10), date, "Invalid release date.");
  const notes = lines.join("\n").trim();
  assert.ok(notes && !/\b(?:TODO|TBD)\b/.test(notes), "Write release notes before tagging.");
  return { title, notes: `${notes}\n` };
}

export function validateRelease({
  cwd = process.cwd(),
  ref,
  remote = false,
  publish = false,
  env = process.env,
} = {}) {
  const info = metadata(cwd);
  const selected = ref ?? env.GITHUB_REF ?? `refs/heads/${git(cwd, "branch", "--show-current")}`;
  const commit = git(cwd, "rev-parse", "HEAD");
  assert.equal(
    git(cwd, "status", "--porcelain"),
    "",
    "Commit the release changes before validation.",
  );
  if (env.GITHUB_SHA)
    assert.equal(commit, env.GITHUB_SHA, "Checkout must match the workflow commit.");
  const branchRef = `${remote ? "refs/remotes/origin" : "refs/heads"}/${info.branch}`;
  if (selected.startsWith("refs/tags/")) {
    assert.equal(selected, `refs/tags/${info.tag}`, "Tag must exactly match the package version.");
    assert.equal(git(cwd, "rev-parse", `${selected}^{commit}`), commit, "Tag must point at HEAD.");
    git(cwd, "merge-base", "--is-ancestor", commit, branchRef);
  } else {
    assert.equal(
      selected,
      `refs/heads/${info.branch}`,
      `Use the ${info.branch} branch for this version.`,
    );
    if (remote)
      assert.equal(git(cwd, "rev-parse", branchRef), commit, "Release branch checkout is stale.");
  }
  if (publish) {
    assert.equal(env.GITHUB_ACTIONS, "true", "Publish through the GitHub release workflow.");
    assert.equal(
      env.GITHUB_REPOSITORY,
      repository,
      "Publishing is restricted to the project repository.",
    );
    assert.equal(selected, `refs/tags/${info.tag}`, "Publishing requires a version tag.");
  }
  for (const tag of git(cwd, "tag", "--merged", "HEAD").split("\n")) {
    if (!tag || tag === info.tag) continue;
    let previous;
    try {
      previous = releaseInfo(tag.slice(1));
    } catch {
      continue;
    }
    if (!tag.startsWith("v")) continue;
    const ancestorPackage = JSON.parse(git(cwd, "show", `${tag}:package.json`));
    if (ancestorPackage.name !== packageName) continue;
    assert.ok(
      gt(info.version, previous.version),
      `${info.version} must be newer than ancestor tag ${tag}.`,
    );
  }
  return {
    ...info,
    commit,
    ...releaseNotes(readFileSync(join(cwd, "docs/changelog.md"), "utf8"), info.version),
  };
}

export function sourceManifest(cwd = process.cwd(), published = false) {
  const imports = json(join(cwd, "jsr.json")).imports;
  const files = [
    "LICENSE",
    "README.md",
    "jsr.json",
    ...readdirSync(join(cwd, "src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => `src/${file}`),
  ];
  return Object.fromEntries(
    files
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((file) => {
        const original = readFileSync(join(cwd, file));
        const bytes =
          published && file.endsWith(".ts")
            ? Buffer.from(jsrImports(original.toString("utf8"), imports))
            : original;
        return [`/${file}`, { size: bytes.length, checksum: hash(bytes) }];
      }),
  );
}

export function artifact(cwd = process.cwd()) {
  const info = metadata(cwd);
  const saved = json(join(cwd, "release/release.json"));
  for (const [key, value] of Object.entries(info))
    assert.deepEqual(saved[key], value, `Artifact ${key} mismatch.`);
  assert.equal(
    saved.commit,
    git(cwd, "rev-parse", "HEAD"),
    "Artifact was built from another commit.",
  );
  const tarball = join(cwd, "release", info.filename);
  assert.equal(
    hash(readFileSync(tarball), "sha512", "base64"),
    saved.integrity,
    "Tarball integrity mismatch.",
  );
  assert.deepEqual(
    json(join(cwd, "release/source-files.json")),
    sourceManifest(cwd),
    "JSR sources changed after packaging.",
  );
  assert.deepEqual(
    json(join(cwd, "release/jsr-files.json")),
    sourceManifest(cwd, true),
    "JSR upload hashes changed after packaging.",
  );
  return { ...saved, tarball };
}
