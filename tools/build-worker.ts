import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "addon.json"), "utf8")) as { runtime: { worker: { entrypoints: Record<string, string> } } };
for (const [target, entry] of Object.entries(manifest.runtime.worker.entrypoints)) {
  const [goos, goarch] = target.split("-");
  if (!goos || !goarch || !entry.startsWith("worker/") || entry.includes("..")) throw new Error("Invalid native worker target.");
  const output = resolve(root, entry); mkdirSync(dirname(output), { recursive: true });
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", output, "./cmd/worker"], { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch } });
}
