import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, "web");
await mkdir(outputDirectory, { recursive: true });
const styles = await Promise.all(
  ["character.css", "character-compact.css"].map((name) =>
    readFile(resolve(repositoryRoot, "src", name), "utf8"),
  ),
);
await writeFile(resolve(outputDirectory, "index.css"), styles.join("\n"));
