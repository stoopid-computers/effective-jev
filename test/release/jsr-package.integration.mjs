import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { hash, sourceManifest } from "../../scripts/release-lib.mjs";

// Exercise the real, pinned JSR CLI against a local receiver. Nothing reaches a registry.
test("JSR's actual upload matches the file hashes used for release verification", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "effective-jev-jsr-upload-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let upload;
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader("Content-Type", "application/json");
    if (
      request.method === "POST" &&
      request.url.startsWith("/api/scopes/compootor/packages/effective-jev/versions/")
    ) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      upload = Buffer.concat(chunks);
      response.end(JSON.stringify({ id: "local-test", status: "success", error: null }));
    } else if (
      request.method === "GET" &&
      request.url === "/api/scopes/compootor/packages/effective-jev"
    ) {
      response.end(JSON.stringify({ latestVersion: null }));
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ code: "notFound", message: "Local fixture" }));
    }
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await promisify(execFile)(
      process.execPath,
      [
        resolve("node_modules/jsr/dist/bin.js"),
        "publish",
        "--token",
        "local-package-test",
        "--no-provenance",
        "--allow-dirty",
        "--allow-slow-types",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, JSR_URL: url, GITHUB_ACTIONS: "false" },
        timeout: 30_000,
      },
    );
  } catch (error) {
    throw new Error(`Local JSR upload failed: ${error.stderr}\n${requests.join("\n")}`, {
      cause: error,
    });
  }
  assert.ok(upload, "The CLI must upload a package to the local receiver.");
  const tarball = join(directory, "jsr.tgz");
  writeFileSync(tarball, upload);
  const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  const actual = Object.fromEntries(
    files.map((file) => {
      const bytes = execFileSync("tar", ["-xOzf", tarball, file]);
      return [`/${file.replace(/^\.\//, "")}`, { size: bytes.length, checksum: hash(bytes) }];
    }),
  );
  assert.deepEqual(actual, sourceManifest(process.cwd(), true));
});
