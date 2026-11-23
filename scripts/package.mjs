import { readdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
const files = {};
async function walk(dir, prefix = "") {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.isDirectory()) await walk(`${dir}/${f.name}`, `${prefix}${f.name}/`);
    else
      files[prefix + f.name] = new Uint8Array(
        await readFile(`${dir}/${f.name}`),
      );
  }
}
await walk("dist");
await writeFile("volna-1.0.0.zip", zipSync(files));
console.log("volna-1.0.0.zip ready");
