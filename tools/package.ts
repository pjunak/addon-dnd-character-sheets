import archiver from "archiver";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = resolve(repositoryRoot, "dist");
const packageRoot = resolve(distributionRoot, "package");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "addon.json"), "utf8")) as { readonly id: string; readonly version: string; readonly runtime: { readonly worker: { readonly entrypoints: Record<string, string> } } };
const archivePath = resolve(distributionRoot, `${manifest.id}-${manifest.version}.zip`);

await rm(packageRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(packageRoot, { recursive: true });
for (const entry of ["addon.json", "contracts", "web", "worker"]) {
  await cp(resolve(repositoryRoot, entry), resolve(packageRoot, entry), { recursive: true, force: false, errorOnExist: true });
}
const files = await listFiles(packageRoot);
const checksums: Record<string, string> = {};
for (const filename of files) {
  const packagePath = relative(packageRoot, filename).split(sep).join("/");
  checksums[packagePath] = createHash("sha256").update(await readFile(filename)).digest("hex");
}
await writeFile(resolve(packageRoot, "checksums.json"), `${JSON.stringify({ algorithm: "sha256", files: checksums }, null, 2)}\n`, "utf8");
await createArchive(packageRoot, archivePath);
process.stdout.write(`${relative(repositoryRoot, archivePath)}\n`);

async function listFiles(directory: string): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(filename));
    else if (entry.isFile()) found.push(filename);
  }
  return found.sort((left, right) => left.localeCompare(right));
}

async function createArchive(source: string, destination: string): Promise<void> {
  await new Promise<void>((resolveArchive, rejectArchive) => {
    const output = createWriteStream(destination, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.once("close", resolveArchive);
    output.once("error", rejectArchive);
    archive.once("warning", rejectArchive);
    archive.once("error", rejectArchive);
    archive.pipe(output);
    void (async () => {
      const executable = new Set(Object.entries(manifest.runtime.worker.entrypoints).filter(([target]) => !target.startsWith("windows-")).map(([, path]) => path));
      for (const file of await listFiles(source)) {
        const name = relative(source, file).split(sep).join("/");
        archive.append(await readFile(file), { name, date: new Date("2000-01-01T00:00:00Z"), mode: executable.has(name) ? 0o755 : 0o644 });
      }
      await archive.finalize();
    })().catch(rejectArchive);
  });
}
