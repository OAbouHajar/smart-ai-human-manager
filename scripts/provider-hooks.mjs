import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const providerEvents = {
  claude: {
    SessionStart: "sessionStart",
    Stop: "agentStop",
    PreCompact: "preCompact",
    SessionEnd: "sessionEnd"
  },
  codex: {
    SessionStart: "sessionStart",
    Stop: "agentStop",
    PreCompact: "preCompact",
    SessionEnd: "sessionEnd"
  },
  gemini: {
    SessionStart: "sessionStart",
    AfterAgent: "agentStop",
    PreCompress: "preCompact",
    SessionEnd: "sessionEnd"
  }
};

export async function configureProviderHooks(provider, action, options) {
  const configPath = providerConfigPath(provider, options.env);
  if (action === "install" && !options.force && !commandExists(provider, options.env)) {
    return { provider, action: "skipped", configPath };
  }
  const config = await readConfig(configPath);
  config.hooks ||= {};

  for (const [eventName, normalizedEvent] of Object.entries(providerEvents[provider])) {
    const groups = Array.isArray(config.hooks[eventName]) ? config.hooks[eventName] : [];
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: Array.isArray(group.hooks)
          ? group.hooks.filter((handler) => !isSessionHubHandler(handler, provider))
          : []
      }))
      .filter((group) => group.hooks.length);
    if (action === "install") {
      cleaned.push({
        hooks: [providerHandler(provider, normalizedEvent, options.nodePath, options.hookPath)]
      });
    }
    if (cleaned.length) config.hooks[eventName] = cleaned;
    else delete config.hooks[eventName];
  }

  if (!Object.keys(config.hooks).length) delete config.hooks;
  if (action === "uninstall" && !existsSync(configPath)) {
    return { provider, action: "skipped", configPath };
  }
  await writeConfig(configPath, config);
  return { provider, action: action === "install" ? "installed" : "uninstalled", configPath };
}

export async function inspectProviderHooks(provider, options = {}) {
  const env = options.env || process.env;
  const detected = commandExists(provider, env);
  const configPath = providerConfigPath(provider, env);
  if (!existsSync(configPath)) return { provider, detected, configured: false, configPath };
  const config = await readConfig(configPath);
  const configured = Object.values(config.hooks || {}).some((groups) =>
    Array.isArray(groups) && groups.some((group) =>
      Array.isArray(group?.hooks) && group.hooks.some((handler) => isSessionHubHandler(handler, provider))
    )
  );
  return { provider, detected, configured, configPath };
}

function providerHandler(provider, eventName, nodePath, hookPath) {
  if (provider === "claude") {
    return {
      type: "command",
      command: nodePath,
      args: [hookPath, provider, eventName],
      timeout: 8
    };
  }
  const handler = {
    type: "command",
    command: [nodePath, hookPath, provider, eventName].map(commandQuote).join(" "),
    timeout: provider === "gemini" ? 8000 : 8
  };
  if (provider === "gemini") {
    handler.name = "Context Workspace";
    handler.description = "Track local AI CLI session continuity";
  }
  return handler;
}

function isSessionHubHandler(handler, provider) {
  if (!handler || handler.type !== "command") return false;
  const values = [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])]
    .filter((value) => typeof value === "string");
  return values.some((value) => value.includes("hook-client.mjs")) &&
    values.some((value) => value.includes(provider));
}

function providerConfigPath(provider, env) {
  if (provider === "claude") return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
  if (provider === "codex") return join(env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json");
  if (provider === "gemini") return join(env.GEMINI_CLI_HOME || join(homedir(), ".gemini"), "settings.json");
  throw new Error(`Unsupported provider: ${provider}`);
}

function commandExists(command, env) {
  try {
    const resolver = process.platform === "win32" ? "where.exe" : "/usr/bin/which";
    execFileSync(resolver, [command], { env, stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function readConfig(path) {
  if (!existsSync(path)) return {};
  const content = await readFile(path, "utf8");
  if (!content.trim()) return {};
  try {
    const value = JSON.parse(content);
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("the root value must be an object");
    }
    return value;
  } catch (error) {
    throw new Error(`Cannot update ${path}: invalid JSON (${error.message})`);
  }
}

async function writeConfig(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.context-workspace.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function commandQuote(value) {
  if (process.platform === "win32") return `"${String(value).replaceAll("\"", "\\\"")}"`;
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function main() {
  const action = process.argv[2];
  const installRoot = process.argv[3];
  if (!["install", "uninstall"].includes(action) || !installRoot) {
    throw new Error("Usage: node provider-hooks.mjs <install|uninstall> <install-root>");
  }
  const options = {
    env: process.env,
    nodePath: process.execPath,
    hookPath: join(resolve(installRoot), "scripts", "hook-client.mjs")
  };
  for (const provider of Object.keys(providerEvents)) {
    const result = await configureProviderHooks(provider, action, options);
    console.log(`${provider}: ${result.action}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
