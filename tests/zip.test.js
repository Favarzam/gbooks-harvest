import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { zipFiles } from "../public/js/zip.js";

test("zipFiles builds an archive Python can read", async () => {
  const files = new Map([
    ["records.csv", "year,title\r\n1910,Alpha\r\n"],
    ["prisma_counts.json", '{\n  "retained": 1\n}'],
  ]);
  const bytes = await zipFiles(files, "run");
  const dir = await mkdtemp(join(tmpdir(), "gbooks-zip-"));
  const zipPath = join(dir, "out.zip");
  await writeFile(zipPath, bytes);
  const result = spawnSync("python3", ["-c", `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
assert set(z.namelist()) == {"run/records.csv", "run/prisma_counts.json"}
print(z.read("run/records.csv").decode())
`, zipPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(zipPath).then((b) => b.length > 0), true);
  assert.match(result.stdout, /1910,Alpha/);
});
