import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

const filesToCopy = [
  "index.html",
  "styles.css",
  "app.js",
  "reservation_seed.json",
];

async function ensureCleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyFileRelative(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(distDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function copyDirectoryRelative(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(distDir, relativePath);
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

async function writeSupportFiles() {
  await fs.writeFile(path.join(distDir, ".nojekyll"), "");
}

await ensureCleanDist();

for (const file of filesToCopy) {
  await copyFileRelative(file);
}

await copyDirectoryRelative("icons");
await writeSupportFiles();

console.log(`Static build hazir: ${distDir}`);
