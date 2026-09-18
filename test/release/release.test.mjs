import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publishJsr, verifyJsr } from "../../scripts/publish-jsr.mjs";
import { npmTag, publishNpm, verifyNpm } from "../../scripts/publish-npm.mjs";
import { registryJson } from "../../scripts/registry.mjs";
import {
  artifact,
  git,
  hash,
  json,
  metadata,
  packageName,
  releaseInfo,
  releaseNotes,
  repository,
  sourceManifest,
  validateRelease,
} from "../../scripts/release-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const commit = (cwd) => {
  git(cwd, "add", ".");
  git(
    cwd,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  );
};
function fixture(t, upstream = false) {
  const cwd = mkdtempSync(join(tmpdir(), "effective-jev-release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of [
    "package.json",
    "package-lock.json",
    "jsr.json",
    "src",
    "docs/changelog.md",
    "LICENSE",
    "README.md",
  ]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    cpSync(join(root, path), join(cwd, path), { recursive: true });
  }
  // Fixed fixtures keep the release tests valid when the real package version advances.
  for (const file of ["package.json", "package-lock.json", "jsr.json"]) {
    const data = json(join(cwd, file));
    data.version = "0.0.1";
    if (file === "package-lock.json") data.packages[""].version = "0.0.1";
    writeJson(join(cwd, file), data);
  }
  writeFileSync(join(cwd, "src/version.ts"), 'export const VERSION = "0.0.1";\n');
  writeFileSync(
    join(cwd, "docs/changelog.md"),
    "# Changelog\n\n## v0.0.1 (2026-09-19)\n\nInitial independent release.\n",
  );
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\nrelease/\n");
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
  git(cwd, "init", "-q", "-b", "release/0.0");
  git(cwd, "config", "user.name", "Release test");
  git(cwd, "config", "user.email", "release@example.invalid");
  if (upstream) {
    const pkg = json(join(cwd, "package.json"));
    writeJson(join(cwd, "package.json"), { ...pkg, name: "@typesafe-ai/sdk", version: "0.6.0" });
    commit(cwd);
    git(cwd, "tag", "v0.6.0");
    writeJson(join(cwd, "package.json"), pkg);
  }
  commit(cwd);
  git(cwd, "update-ref", "refs/remotes/origin/release/0.0", "HEAD");
  return cwd;
}
const validate = (cwd, extra = {}) => validateRelease({ cwd, env: {}, ...extra });

for (const version of ["0.0.1", "1.2.3", "2.0.0-rc.1", "0.1.0-beta.12"]) {
  test(`accepts canonical SemVer ${version}`, () => {
    const info = releaseInfo(version);
    assert.equal(info.tag, `v${version}`);
    assert.equal(info.prerelease, version.includes("-"));
  });
}
for (const version of [
  "v1.0.0",
  "01.0.0",
  "1.0",
  "1.0.0+build.1",
  "1.0.0-rc.01",
  " 1.0.0",
  "latest",
]) {
  test(`rejects non-release version ${version}`, () => assert.throws(() => releaseInfo(version)));
}

test("validates scoped metadata and rejects mismatched lockfile versions", (t) => {
  const cwd = fixture(t);
  assert.equal(metadata(cwd).name, packageName);
  const lock = json(join(cwd, "package-lock.json"));
  lock.packages[""].version = "0.0.2";
  writeJson(join(cwd, "package-lock.json"), lock);
  assert.throws(() => metadata(cwd), /version must match/);
});
test("rejects a different registry scope", (t) => {
  const cwd = fixture(t);
  const jsr = json(join(cwd, "jsr.json"));
  jsr.name = "@other/effective-jev";
  writeJson(join(cwd, "jsr.json"), jsr);
  assert.throws(() => metadata(cwd), /must use/);
});
for (const branch of ["main", "staging", "dev", "release/0.1", "release/0.0-fix"]) {
  test(`refuses releases from ${branch}`, (t) => {
    const cwd = fixture(t);
    git(cwd, "switch", "-qc", branch);
    assert.throws(() => validate(cwd), /Use the release\/0.0 branch/);
  });
}
test("accepts a tag on its release branch and ignores upstream version history", (t) => {
  const cwd = fixture(t, true);
  git(cwd, "tag", "-a", "v0.0.1", "-m", "Release");
  const info = validate(cwd, { ref: "refs/tags/v0.0.1", remote: true });
  assert.equal(info.version, "0.0.1");
});
test("rejects a tag with a different version", (t) => {
  const cwd = fixture(t);
  git(cwd, "tag", "v0.0.2");
  assert.throws(() => validate(cwd, { ref: "refs/tags/v0.0.2" }), /Tag must exactly match/);
});
test("rejects a tag that exists only on main", (t) => {
  const cwd = fixture(t);
  git(cwd, "switch", "-qc", "main");
  writeFileSync(join(cwd, "extra.txt"), "Main-only commit\n");
  commit(cwd);
  git(cwd, "tag", "v0.0.1");
  assert.throws(() => validate(cwd, { ref: "refs/tags/v0.0.1", remote: true }));
});
test("rejects dirty release sources", (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "README.md"), "Uncommitted\n");
  assert.throws(() => validate(cwd), /Commit the release changes/);
});
test("publishing requires GitHub, the right repository, and a tag", (t) => {
  const cwd = fixture(t);
  assert.throws(() => validate(cwd, { publish: true }), /GitHub release workflow/);
  assert.throws(
    () =>
      validate(cwd, {
        publish: true,
        env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository },
      }),
    /version tag/,
  );
  git(cwd, "tag", "v0.0.1");
  assert.throws(
    () =>
      validate(cwd, {
        ref: "refs/tags/v0.0.1",
        publish: true,
        env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "other/repo" },
      }),
    /project repository/,
  );
});
test("does not allow this package's version history to go backwards", (t) => {
  const cwd = fixture(t);
  git(cwd, "tag", "v0.0.2");
  assert.throws(() => validate(cwd), /must be newer/);
});

test("reads prerelease notes and rejects missing, duplicate, empty, and invalid entries", () => {
  const heading = "## v0.0.2-rc.1 (2026-09-19)\n";
  assert.equal(
    releaseNotes(`# Changelog\n\n${heading}\nFix timeout handling.\n`, "0.0.2-rc.1").notes,
    "Fix timeout handling.\n",
  );
  for (const body of ["", "TODO: write notes", "TBD"]) {
    assert.throws(() => releaseNotes(`${heading}\n${body}`, "0.0.2-rc.1"));
  }
  assert.throws(() => releaseNotes(`${heading}Fix.\n${heading}Again.`, "0.0.2-rc.1"));
  assert.throws(() => releaseNotes("## v0.0.1 (2026-02-30)\nFix.\n", "0.0.1"));
  assert.throws(() => releaseNotes("## v0.0.2 (2026-09-19)\nFix.\n", "0.0.1"));
});
test("prepare updates both registries, runtime, lockfile, and notes together", (t) => {
  const cwd = fixture(t);
  const notes = join(cwd, "release-notes.txt");
  writeFileSync(notes, "Fix retry timing.\n");
  execFileSync(
    process.execPath,
    [join(root, "scripts/release.mjs"), "prepare", "0.0.2-rc.1", "--notes", notes],
    { cwd, stdio: "pipe" },
  );
  assert.equal(metadata(cwd).version, "0.0.2-rc.1");
  assert.match(readFileSync(join(cwd, "docs/changelog.md"), "utf8"), /## v0\.0\.2-rc\.1/);
});
test("failed preparation leaves metadata untouched", (t) => {
  const cwd = fixture(t);
  const before = readFileSync(join(cwd, "package.json"), "utf8");
  assert.throws(() =>
    execFileSync(process.execPath, [join(root, "scripts/release.mjs"), "prepare", "1.0.0"], {
      cwd,
      stdio: "pipe",
    }),
  );
  assert.equal(readFileSync(join(cwd, "package.json"), "utf8"), before);
});
test("pack verification detects changed tarballs and JSR sources", (t) => {
  const cwd = fixture(t);
  const info = metadata(cwd);
  mkdirSync(join(cwd, "release"));
  const tarball = join(cwd, "release", info.filename);
  writeFileSync(tarball, "packed bytes");
  writeJson(join(cwd, "release/release.json"), {
    ...info,
    commit: git(cwd, "rev-parse", "HEAD"),
    integrity: hash(readFileSync(tarball), "sha512", "base64"),
  });
  writeJson(join(cwd, "release/source-files.json"), sourceManifest(cwd));
  writeJson(join(cwd, "release/jsr-files.json"), sourceManifest(cwd, true));
  assert.equal(artifact(cwd).tarball, tarball);
  writeFileSync(tarball, "modified");
  assert.throws(() => artifact(cwd), /Tarball integrity mismatch/);
  writeFileSync(tarball, "packed bytes");
  writeFileSync(join(cwd, "README.md"), "changed");
  assert.throws(() => artifact(cwd), /JSR sources changed/);
});

const info = { ...releaseInfo("0.0.1"), tarball: "/tmp/test.tgz", integrity: "sha512-test" };
const npmVersion = { name: info.name, version: info.version, dist: { integrity: info.integrity } };
test("npm uses latest, next, or a maintenance channel without downgrading latest", () => {
  assert.equal(npmTag(info), "latest");
  assert.equal(
    npmTag(info, { versions: { "1.0.0": {} }, "dist-tags": { latest: "1.0.0" } }),
    "release-0.0",
  );
  assert.equal(npmTag(releaseInfo("1.0.0-rc.1")), "next");
  assert.equal(
    npmTag(releaseInfo("0.1.0-rc.1"), { versions: { "1.0.0-rc.1": {} } }),
    "release-0.1-next",
  );
});
test("npm retry skips an identical published tarball", async () => {
  await publishNpm(info, {
    read: async () => npmVersion,
    execute: () => assert.fail("No republish"),
  });
});
test("npm retry rejects a different published tarball", async () => {
  await assert.rejects(
    publishNpm(info, {
      read: async () => ({ ...npmVersion, dist: { integrity: "different" } }),
      execute: () => assert.fail("No publish"),
    }),
    /different contents/,
  );
});
test("npm publishes the exact artifact and verifies the registry result", async () => {
  let published = false;
  await publishNpm(info, {
    read: async (url) =>
      url.endsWith(`/${info.version}`) ? (published ? npmVersion : undefined) : undefined,
    execute: (command, args) => {
      assert.equal(command, "npm");
      assert.equal(args[0], "publish");
      assert.equal(args[1], info.tarball);
      assert.equal(args[args.indexOf("--tag") + 1], "latest");
      assert.ok(args.includes("--provenance"));
      published = true;
    },
  });
  assert.equal(published, true);
});
test("npm refuses a new version below an existing version on the same channel", async () => {
  await assert.rejects(
    publishNpm(info, {
      read: async (url) =>
        url.endsWith(`/${info.version}`) ? undefined : { versions: { "0.0.2": {} } },
      execute: () => assert.fail("No publish"),
    }),
    /already exists/,
  );
});
test("GitHub latest follows the verified npm stable version", async () => {
  const read = async (url) =>
    url.endsWith(`/${info.version}`) ? npmVersion : { "dist-tags": { latest: "1.0.0" } };
  assert.equal(await verifyNpm(info, read), false);
});
const manifest = { "/src/index.ts": { checksum: "sha256-test", size: 4 } };
test("JSR retries verify the full published manifest", async () => {
  await publishJsr(info, manifest, {
    read: async (url) =>
      url.endsWith("_meta.json") ? { manifest } : { versions: { "0.0.1": {} } },
    execute: () => assert.fail("No republish"),
  });
});
test("JSR refuses conflicting or yanked versions", async () => {
  await assert.rejects(
    publishJsr(info, manifest, {
      read: async () => ({ manifest: {} }),
      execute: () => assert.fail("No publish"),
    }),
    /different files/,
  );
  await assert.rejects(
    verifyJsr(info, manifest, async (url) =>
      url.endsWith("_meta.json") ? { manifest } : { versions: { "0.0.1": { yanked: true } } },
    ),
    /yanked/,
  );
});
test("JSR first publish verifies uploaded source hashes", async () => {
  let published = false;
  await publishJsr(info, manifest, {
    read: async (url) =>
      url.endsWith("_meta.json")
        ? published
          ? { manifest }
          : undefined
        : { versions: { "0.0.1": {} } },
    execute: (command, args) => {
      assert.equal(command, "npm");
      assert.ok(args.includes("publish"));
      assert.ok(!args.includes("--allow-dirty"));
      published = true;
    },
  });
});
test("registry failures cannot be mistaken for an unpublished version", async () => {
  await assert.rejects(
    registryJson(
      "https://registry.invalid/package",
      async () => new Response("failure", { status: 503 }),
    ),
    /Registry lookup failed/,
  );
  assert.equal(
    await registryJson(
      "https://registry.invalid/package",
      async () => new Response("missing", { status: 404 }),
    ),
    undefined,
  );
  await assert.rejects(
    registryJson("https://registry.invalid/package", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
});
