import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".cjs", ".js", ".jsm", ".jsx", ".mjs"]);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  },
)
  .split("\0")
  .filter(Boolean);
const javascriptSources = files
  .filter((filename) => existsSync(resolve(repositoryRoot, filename)))
  .filter((filename) => sourceExtensions.has(extname(filename).toLowerCase()))
  .toSorted();

if (javascriptSources.length > 0) {
  process.stderr.write(
    `Authored JavaScript source is not allowed; use TypeScript instead:\n${javascriptSources.map((filename) => `- ${filename}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("No authored JavaScript source found.\n");
}
