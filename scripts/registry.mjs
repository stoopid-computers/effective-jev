import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export const run = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });

export async function registryJson(url, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Registry lookup failed: ${response.status} ${url}`);
  return response.json();
}

export async function visible(url, read = registryJson, wait = setTimeout) {
  // Accepted npm uploads can take several minutes to reach public metadata.
  // Poll the existing version; never repeat the publish operation here.
  for (let attempt = 0; attempt <= 60; attempt++) {
    const result = await read(url);
    if (result !== undefined) return result;
    if (attempt < 60) await wait(5_000);
  }
  throw new Error(`Published version is not visible yet: ${url}. Rerun the same release.`);
}
