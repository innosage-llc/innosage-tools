import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function sourceManifest() {
  const paths = ["package.json", "package-lock.json", "quota-profile.json"];
  for (const dir of ["src", "test"])
    for (const f of (await readdir(dir)).sort())
      if (f.endsWith(".mjs")) paths.push(dir + "/" + f);
  paths.sort();
  const files = {};
  for (const path of paths)
    files[path] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    files,
  };
}
