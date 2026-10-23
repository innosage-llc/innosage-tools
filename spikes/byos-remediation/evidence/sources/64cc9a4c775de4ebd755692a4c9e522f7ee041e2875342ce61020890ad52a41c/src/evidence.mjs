import { readFile, writeFile, mkdir, readdir, copyFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const session = path.resolve(root, "../../docs/sessions/20261023-byos-remediation");
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function archiveSources(overrides = {}) {
  const files = ["package.json", "package-lock.json"];
  for (const folder of ["src", "test"]) for (const f of await readdir(path.join(root, folder))) if (f.endsWith(".mjs")) files.push(`${folder}/${f}`);
  const manifest = {}, contents = {};
  for (const f of files.sort()) { contents[f] = overrides[f] ?? await readFile(path.join(root, f), "utf8"); manifest[f] = digest(contents[f]); }
  const dependency = "../byos-sync/src/mock.mjs";
  contents["dependencies/byos-sync/mock.mjs"] = await readFile(path.join(root, dependency), "utf8");
  manifest[dependency] = digest(contents["dependencies/byos-sync/mock.mjs"]);
  manifest["../byos-sync/package-lock.json"] = digest(await readFile(path.join(root, "../byos-sync/package-lock.json")));
  const sourceDigest = digest(JSON.stringify(manifest));
  const destination = path.join(root, "evidence/sources", sourceDigest);
  await mkdir(destination, { recursive: true });
  for (const [f, content] of Object.entries(contents)) { await mkdir(path.dirname(path.join(destination, f)), { recursive: true }); await writeFile(path.join(destination, f), content); }
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { sourceDigest, manifest, node: process.version, baselineCommit: "496e9a8a1b605c81e71026d0ab217e6ccb9f41a4", runtime: Object.fromEntries(await Promise.all(["rxdb", "fake-indexeddb", "esbuild", "playwright", "dexie"].map(async (name) => [name, JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8")).version]))) };
}
export async function saveRun({ id, hypothesis, command, source, result, output, error, progress, nextDecision, kind = "hypothesis" }) {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const file = `evidence/${id.toLowerCase()}-${stamp}.json`;
  const record = { id, kind, hypothesis, command, source, result, output, error, createdAt: new Date().toISOString() };
  const bytes = JSON.stringify(record, null, 2) + "\n";
  await writeFile(path.join(root, file), bytes);
  await appendFile(path.join(session, "attempts.jsonl"), JSON.stringify({ attempt: id, kind, hypothesis, command, sourceDigest: source.sourceDigest, evidence: `spikes/byos-remediation/${file}`, evidenceSha256: digest(bytes), result, progress, remaining: ["full safety seeds and 10/1000 fixture matrix", "real IndexedDB crash barriers", "repeated diagnostics", "independent review/native gates/integration"], nextDecision }) + "\n");
  return { file, sourceDigest: source.sourceDigest, evidenceSha256: digest(bytes), result };
}
