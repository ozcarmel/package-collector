import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = "out";
const buildVersion = process.env.BUILD_VERSION ?? Date.now().toString();

async function listHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

const htmlFiles = await listHtmlFiles(outDir);

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const updated = html.replace(
    /(\/_next\/static\/[^"'()\s<>?]+)(?!\?)/g,
    `$1?v=${buildVersion}`,
  );

  if (updated !== html) {
    await writeFile(file, updated);
  }
}

console.log(`Cache-busted ${htmlFiles.length} exported HTML files with v=${buildVersion}`);
