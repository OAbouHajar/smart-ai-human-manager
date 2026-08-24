import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryUrl = "https://github.com/OAbouHajar/smart-ai-human-manager.git";

export async function runUpdate(config, dependencies = {}) {
  validateUpdateConfig(config);
  const {
    cloneRelease = defaultCloneRelease,
    installRelease = defaultInstallRelease,
    waitForSignal = defaultWaitForSignal,
    verifyHealth = defaultVerifyHealth,
    remove = (path) => rmSync(path, { recursive: true, force: true })
  } = dependencies;
  const writeStatus = (state, extra = {}) => {
    const current = readJson(config.statusPath) || {};
    writeJson(config.statusPath, {
      ...current,
      fromVersion: config.fromVersion,
      toVersion: config.toVersion,
      releaseUrl: config.releaseUrl,
      sessionId: config.sessionId,
      runnerPid: process.pid,
      state,
      updatedAt: Date.now(),
      ...extra
    });
  };

  let phase = "prepare";
  try {
    writeStatus("preparing", { error: "" });
    writeFileSync(config.logPath, "", "utf8");
    remove(config.stagingPath);
    phase = "download";
    await cloneRelease(config, repositoryUrl);
    verifyStagedRelease(config);
    writeStatus("waiting_for_exit");
    phase = "wait";
    let installClaimed = false;
    const beginInstall = () => {
      if (installClaimed) return;
      installClaimed = true;
      writeStatus("installing");
    };
    await waitForSignal(config.signalPath, config.cancelPath, config.deadline, beginInstall);
    beginInstall();
    phase = "install";
    let installError;
    try {
      await installRelease(config);
    } catch (error) {
      installError = error;
    }
    phase = "verify";
    try {
      await verifyHealth(config);
    } catch (healthError) {
      if (installError) {
        phase = "install";
        throw installError;
      }
      throw healthError;
    }
    writeStatus(installError ? "succeeded_with_warnings" : "succeeded", {
      warning: installError ? "The application updated, but one or more CLI integrations need to be refreshed after restart." : "",
      completedAt: Date.now()
    });
    remove(config.stagingPath);
    rmSync(config.signalPath, { force: true });
    rmSync(config.cancelPath, { force: true });
  } catch (error) {
    writeStatus("failed", {
      error: userFacingError(error, phase),
      completedAt: Date.now()
    });
    remove(config.stagingPath);
    rmSync(config.signalPath, { force: true });
    rmSync(config.cancelPath, { force: true });
    process.exitCode = 1;
  }
}

export function validateUpdateConfig(config) {
  for (const key of ["fromVersion", "toVersion"]) {
    if (!/^\d+\.\d+\.\d+$/.test(config?.[key] || "")) {
      throw new Error(`Invalid ${key}.`);
    }
  }
  if (!config.sessionId || typeof config.sessionId !== "string") throw new Error("Missing session ID.");
  if (!validReleaseUrl(config.releaseUrl, config.toVersion)) throw new Error("Invalid release URL.");
  if (!Number.isFinite(config.deadline) || config.deadline <= config.createdAt) {
    throw new Error("Invalid update deadline.");
  }
  for (const key of ["statusPath", "signalPath", "cancelPath", "stagingPath", "logPath"]) {
    const childPath = relative(resolve(config.dataDir), resolve(config[key] || ""));
    if (!config[key] || !childPath || childPath.startsWith("..") || isAbsolute(childPath)) {
      throw new Error(`Invalid ${key}.`);
    }
  }
}

export function verifyStagedRelease(config) {
  const packageVersion = readJson(join(config.stagingPath, "package.json"))?.version;
  const pluginVersion = readJson(join(config.stagingPath, "plugin.json"))?.version;
  if (packageVersion !== config.toVersion || pluginVersion !== config.toVersion) {
    throw new Error("The downloaded release version does not match the verified update.");
  }
  const installer = platform() === "win32"
    ? join(config.stagingPath, "scripts", "install.ps1")
    : join(config.stagingPath, "scripts", "install.sh");
  if (!existsSync(installer)) throw new Error("The downloaded release does not contain an installer.");
}

function defaultCloneRelease(config, url) {
  run("git", [
    "clone", "--quiet", "--depth", "1", "--branch", `v${config.toVersion}`, url, config.stagingPath
  ], config.logPath);
  const head = runCapture("git", ["-C", config.stagingPath, "rev-parse", "HEAD"], config.logPath);
  const tag = runCapture("git", [
    "-C", config.stagingPath, "rev-parse", "--verify", `refs/tags/v${config.toVersion}^{commit}`
  ], config.logPath);
  if (head !== tag) throw new Error("The downloaded release tag does not match its checked-out commit.");
}

function defaultInstallRelease(config) {
  const script = platform() === "win32"
    ? join(config.stagingPath, "scripts", "install.ps1")
    : join(config.stagingPath, "scripts", "install.sh");
  if (platform() === "win32") run("pwsh", ["-NoProfile", "-File", script, "-NoOpen"], config.logPath);
  else run("/bin/bash", [script, "--no-open"], config.logPath);
}

async function defaultWaitForSignal(signalPath, cancelPath, deadline, beginInstall) {
  while (!existsSync(signalPath)) {
    assertUpdateCanContinue(cancelPath, deadline);
    await delay(500);
  }
  assertUpdateCanContinue(cancelPath, deadline);
  beginInstall();
  await delay(5000);
  assertUpdateCanContinue(cancelPath, deadline);
}

function assertUpdateCanContinue(cancelPath, deadline) {
  if (existsSync(cancelPath)) throw new Error("The scheduled update was cancelled.");
  if (Date.now() >= deadline) {
    throw new Error("The scheduled update expired before the AI CLI session exited.");
  }
}

async function defaultVerifyHealth(config) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(500);
    try {
      const response = await fetch(`${config.dashboardUrl}/api/health`, {
        signal: AbortSignal.timeout(1500)
      });
      const health = response.ok ? await response.json() : null;
      if (health?.ok && health.version === config.toVersion) return;
    } catch {
      // The service is expected to be unavailable briefly during replacement.
    }
  }
  throw new Error("The updated dashboard did not become healthy.");
}

function run(command, args, logPath) {
  const log = openSync(logPath, "a");
  try {
    const result = spawnSync(command, args, {
      stdio: ["ignore", log, log],
      windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
  } finally {
    closeSync(log);
  }
}

function runCapture(command, args, logPath) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.stderr) {
    const log = openSync(logPath, "a");
    try {
      writeFileSync(log, result.stderr);
    } finally {
      closeSync(log);
    }
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
  return result.stdout.trim();
}

function validReleaseUrl(value, version) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname === `/OAbouHajar/smart-ai-human-manager/releases/tag/v${version}`;
  } catch {
    return false;
  }
}

function userFacingError(error, phase) {
  const message = error instanceof Error ? error.message : "Unknown update error.";
  if (phase === "download") return "The release could not be downloaded or verified. Check that Git is installed and try again.";
  if (phase === "install") return "The update could not be installed. Restart your AI CLIs and try /sham:update again.";
  return message.slice(0, 300);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const configPath = process.argv[2];
  const config = readJson(configPath);
  if (!config) {
    console.error("Could not read the update job configuration.");
    process.exit(1);
  }
  await runUpdate(config);
}
