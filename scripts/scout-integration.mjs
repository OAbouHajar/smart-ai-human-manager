import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const managedMarker = "<!-- context-workspace-managed-scout-skill -->";

export function detectScout(options = {}) {
  const env = options.env || process.env;
  const currentPlatform = options.platform || process.platform;
  const home = options.home || homedir();
  const commandPath = resolveCommand("scout", env, currentPlatform);
  const executable = commandPath || scoutCandidates(env, currentPlatform, home)
    .find((candidate) => existsSync(candidate));
  return { detected: Boolean(executable), executable: executable || "" };
}

export async function inspectScoutIntegration(options = {}) {
  const env = options.env || process.env;
  const home = options.home || homedir();
  const skillPath = scoutSkillPath(env, home);
  let configured = false;
  try {
    configured = (await readFile(skillPath, "utf8")).includes(managedMarker);
  } catch {
  }
  return {
    provider: "scout",
    ...detectScout(options),
    configured,
    skillPath
  };
}

export async function configureScoutIntegration(action, installRoot, options = {}) {
  if (!["install", "uninstall"].includes(action)) {
    throw new Error("Scout integration action must be install or uninstall.");
  }
  const env = options.env || process.env;
  const home = options.home || homedir();
  const detected = detectScout(options).detected;
  const skillPath = scoutSkillPath(env, home);
  if (action === "install" && !options.force && !detected) {
    return { provider: "scout", action: "skipped", detected, configured: false, skillPath };
  }

  if (action === "uninstall") {
    let content = "";
    try {
      content = await readFile(skillPath, "utf8");
    } catch {
      return { provider: "scout", action: "skipped", detected, configured: false, skillPath };
    }
    if (!content.includes(managedMarker)) {
      return { provider: "scout", action: "preserved", detected, configured: false, skillPath };
    }
    await rm(skillPath, { force: true });
    const skillDirectory = dirname(skillPath);
    if ((await readdir(skillDirectory)).length === 0) await rm(skillDirectory, { recursive: true });
    return { provider: "scout", action: "uninstalled", detected, configured: false, skillPath };
  }

  const sourcePath = join(installRoot, "skills", "scout-context-workspace", "SKILL.md");
  const source = await readFile(sourcePath, "utf8");
  let existing = "";
  try {
    existing = await readFile(skillPath, "utf8");
  } catch {
  }
  if (existing && !existing.includes(managedMarker)) {
    throw new Error(`Cannot install the Microsoft Scout skill because ${skillPath} already exists and is not managed by Context Workspace.`);
  }
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, source, "utf8");
  return { provider: "scout", action: "installed", detected, configured: true, skillPath };
}

function scoutSkillPath(env, home) {
  return join(env.COPILOT_HOME || join(home, ".copilot"), "skills", "context-workspace-scout", "SKILL.md");
}

function scoutCandidates(env, currentPlatform, home) {
  if (currentPlatform === "win32") {
    return [
      env.SCOUT_PATH,
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Clawpilot", "scout", "scout.exe"),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Microsoft Scout", "scout.exe")
    ].filter(Boolean);
  }
  if (currentPlatform === "darwin") {
    return [
      env.SCOUT_PATH,
      "/Applications/Microsoft Scout.app/Contents/MacOS/Microsoft Scout",
      "/Applications/Scout.app/Contents/MacOS/Scout",
      join(home, "Applications", "Microsoft Scout.app", "Contents", "MacOS", "Microsoft Scout")
    ].filter(Boolean);
  }
  return [];
}

function resolveCommand(command, env, currentPlatform) {
  try {
    const resolver = currentPlatform === "win32" ? "where.exe" : "/usr/bin/which";
    return execFileSync(resolver, [command], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim().split(/\r?\n/)[0];
  } catch {
    return "";
  }
}

async function main() {
  const action = process.argv[2];
  const installRoot = process.argv[3];
  if (!["install", "uninstall", "status"].includes(action) || (action !== "status" && !installRoot)) {
    throw new Error("Usage: node scout-integration.mjs <install|uninstall|status> [install-root]");
  }
  const result = action === "status"
    ? await inspectScoutIntegration()
    : await configureScoutIntegration(action, installRoot);
  console.log(`scout: ${action === "status" ? result.configured ? "configured" : result.detected ? "detected" : "missing" : result.action}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
