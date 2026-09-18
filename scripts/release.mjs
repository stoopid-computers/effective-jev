import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gt } from "semver";
import {
  git,
  hash,
  json,
  metadata,
  releaseInfo,
  releaseNotes,
  sourceManifest,
  validateRelease,
} from "./release-lib.mjs";

const cwd = process.cwd();
const [command, ...args] = process.argv.slice(2);
const writeJson = (file, data) =>
  writeFileSync(join(cwd, file), `${JSON.stringify(data, null, 2)}\n`);

if (command === "prepare") {
  const [version, flag, notesPath] = args;
  assert.ok(
    args.length === 1 || (args.length === 3 && flag === "--notes"),
    "Usage: release:prepare -- VERSION [--notes FILE]",
  );
  const current = metadata(cwd);
  const info = releaseInfo(version);
  assert.equal(
    git(cwd, "branch", "--show-current"),
    info.branch,
    `Switch to ${info.branch} first.`,
  );
  assert.ok(version === current.version || gt(version, current.version), "Versions must increase.");
  assert.ok(
    !git(cwd, "tag", "--list", info.tag),
    `${info.tag} already exists. Choose a new version.`,
  );
  const changelog = readFileSync(join(cwd, "docs/changelog.md"), "utf8");
  let updated = changelog;
  if (notesPath) {
    assert.ok(!changelog.includes(`## ${info.tag} (`), "This version already has release notes.");
    const notes = readFileSync(notesPath, "utf8").trim();
    updated = changelog.replace(
      "# Changelog\n",
      `# Changelog\n\n## ${info.tag} (${new Date().toISOString().slice(0, 10)})\n\n${notes}\n`,
    );
  }
  releaseNotes(updated, version);
  const pkg = json(join(cwd, "package.json"));
  const lock = json(join(cwd, "package-lock.json"));
  const jsr = json(join(cwd, "jsr.json"));
  pkg.version = lock.version = lock.packages[""].version = jsr.version = version;
  writeJson("package.json", pkg);
  writeJson("package-lock.json", lock);
  writeJson("jsr.json", jsr);
  const runtime = readFileSync(join(cwd, "src/version.ts"), "utf8").replace(
    /VERSION = "[^"]+"/,
    `VERSION = "${version}"`,
  );
  writeFileSync(join(cwd, "src/version.ts"), runtime);
  writeFileSync(join(cwd, "docs/changelog.md"), updated);
  execFileSync(
    "npm",
    [
      "exec",
      "--no",
      "--",
      "biome",
      "format",
      "--write",
      "package.json",
      "package-lock.json",
      "jsr.json",
      "src/version.ts",
    ],
    { stdio: "inherit" },
  );
  console.log(
    `Prepared ${info.tag} on ${info.branch}. Review, validate, and commit before tagging.`,
  );
} else if (command === "check") {
  assert.ok(
    args.every((arg) => ["--remote", "--publish"].includes(arg)),
    "Unknown release-check option.",
  );
  const info = validateRelease({
    remote: args.includes("--remote"),
    publish: args.includes("--publish"),
  });
  if (process.env.GITHUB_OUTPUT) {
    for (const key of ["version", "tag", "branch", "prerelease", "channel", "filename"]) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${info[key]}\n`);
    }
  }
  console.log(`${info.tag} at ${info.commit} belongs to ${info.branch}.`);
} else if (command === "pack") {
  assert.equal(args.length, 0, "pack takes no arguments.");
  const info = metadata();
  const { title, notes } = releaseNotes(readFileSync("docs/changelog.md", "utf8"), info.version);
  mkdirSync("release", { recursive: true });
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", "release"], {
      encoding: "utf8",
    }),
  );
  assert.equal(packed.name, info.name);
  assert.equal(packed.filename, info.filename);
  const saved = {
    ...info,
    commit: git(cwd, "rev-parse", "HEAD"),
    integrity: packed.integrity,
    title,
  };
  writeJson("release/release.json", saved);
  writeJson("release/source-files.json", sourceManifest());
  writeJson("release/jsr-files.json", sourceManifest(cwd, true));
  writeFileSync("release/release-notes.md", notes);
  const digest = hash(readFileSync(join("release", info.filename))).slice("sha256-".length);
  writeFileSync("release/SHA256SUMS", `${digest}  ${info.filename}\n`);
  console.log(`Packed release/${info.filename}`);
} else {
  throw new Error(
    "Usage: release.mjs prepare VERSION [--notes FILE] | check [--remote] [--publish] | pack",
  );
}
