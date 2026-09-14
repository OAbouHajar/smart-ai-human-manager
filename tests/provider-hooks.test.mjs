import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureProviderHooks, inspectProviderHooks } from "../scripts/provider-hooks.mjs";

for (const provider of ["claude", "codex", "gemini"]) {
  test(`installs and removes ${provider} hooks without changing existing hooks`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `session-hub-${provider}-`));
    const env = providerEnvironment(provider, directory);
    const configPath = providerConfigPath(provider, directory);
    const existingHandler = { type: "command", command: "existing-hook" };
    await writeFile(configPath, JSON.stringify({
      theme: "dark",
      hooks: { SessionStart: [{ matcher: "startup", hooks: [existingHandler] }] }
    }), "utf8");
    const options = {
      env,
      force: true,
      nodePath: "/opt/node/bin/node",
      hookPath: "/Applications/Context Workspace/scripts/hook-client.mjs"
    };

    await configureProviderHooks(provider, "install", options);
    let config = JSON.parse(await readFile(configPath, "utf8"));
    const inspected = await inspectProviderHooks(provider, { env, force: true });
    assert.equal(inspected.configured, true);
    assert.equal(config.theme, "dark");
    assert.deepEqual(config.hooks.SessionStart[0].hooks, [existingHandler]);
    assert.equal(config.hooks.SessionStart.length, 2);
    const serializedHooks = JSON.stringify(config.hooks);
    assert.equal(serializedHooks.includes("hook-client.mjs"), true);
    assert.equal(serializedHooks.includes(provider), true);
    const compactEvent = provider === "gemini" ? "PreCompress" : "PreCompact";
    assert.equal(Array.isArray(config.hooks[compactEvent]), true);
    assert.equal(Array.isArray(config.hooks.SessionEnd), true);
    assert.equal(
      config.hooks.SessionStart[1].hooks[0].timeout,
      provider === "gemini" ? 8000 : 8
    );

    await configureProviderHooks(provider, "install", options);
    config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.hooks.SessionStart.length, 2);

    await configureProviderHooks(provider, "uninstall", options);
    config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.theme, "dark");
    assert.deepEqual(config.hooks.SessionStart, [{ matcher: "startup", hooks: [existingHandler] }]);
    assert.doesNotMatch(JSON.stringify(config), /hook-client\.mjs/);
  });
}

test("rejects invalid provider configuration without overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-hub-invalid-config-"));
  const configPath = join(directory, "settings.json");
  await writeFile(configPath, "{invalid", "utf8");
  await assert.rejects(
    configureProviderHooks("claude", "install", {
      env: { ...process.env, CLAUDE_CONFIG_DIR: directory },
      force: true,
      nodePath: process.execPath,
      hookPath: "/app/scripts/hook-client.mjs"
    }),
    /invalid JSON/
  );
  assert.equal(await readFile(configPath, "utf8"), "{invalid");
});

function providerEnvironment(provider, directory) {
  const env = { ...process.env };
  if (provider === "claude") env.CLAUDE_CONFIG_DIR = directory;
  if (provider === "codex") env.CODEX_HOME = directory;
  if (provider === "gemini") env.GEMINI_CLI_HOME = directory;
  return env;
}

function providerConfigPath(provider, directory) {
  return join(directory, provider === "codex" ? "hooks.json" : "settings.json");
}
