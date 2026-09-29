import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repository = "OAbouHajar/smart-ai-human-manager";
const noOpen = process.argv.includes("--no-open");
const temporaryRoot = join(tmpdir(), `context-workspace-install-${Date.now()}`);

try {
  const release = await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`);
  const version = String(release.tag_name || "").match(/^v(\d+\.\d+\.\d+)$/)?.[1];
  if (!version || release.draft || release.prerelease) throw new Error("The latest release is not a stable Context Workspace version.");
  const archiveName = `context-workspace-v${version}.tar.gz`;
  const checksumName = `${archiveName}.sha256`;
  const archiveUrl = release.assets?.find((asset) => asset.name === archiveName)?.browser_download_url;
  const checksumUrl = release.assets?.find((asset) => asset.name === checksumName)?.browser_download_url;
  if (!archiveUrl || !checksumUrl) throw new Error("The latest release does not include a verified installation package.");

  await mkdir(temporaryRoot, { recursive: true });
  const archivePath = join(temporaryRoot, archiveName);
  const [archiveResponse, checksumResponse] = await Promise.all([fetch(archiveUrl), fetch(checksumUrl)]);
  if (!archiveResponse.ok || !checksumResponse.ok) throw new Error("Could not download the Context Workspace release.");
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(archive).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expected || "") || actual !== expected) throw new Error("The release checksum does not match.");
  await writeFile(archivePath, archive);
  run("tar", ["-xzf", archivePath, "-C", temporaryRoot]);

  const sourceRoot = join(temporaryRoot, "context-workspace");
  const installer = platform() === "win32"
    ? join(sourceRoot, "scripts", "install.ps1")
    : join(sourceRoot, "scripts", "install.sh");
  if (!existsSync(installer)) throw new Error("The verified package does not contain the platform installer.");
  if (platform() === "win32") {
    run("pwsh", ["-NoProfile", "-File", installer, ...(noOpen ? ["-NoOpen"] : [])]);
  } else if (platform() === "darwin") {
    run("/bin/bash", [installer, ...(noOpen ? ["--no-open"] : [])]);
  } else {
    throw new Error("Context Workspace supports Windows and macOS.");
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "context-workspace-bootstrap"
    }
  });
  if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
  return response.json();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}
