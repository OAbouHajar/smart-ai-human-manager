import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureScoutIntegration, inspectScoutIntegration } from "../scripts/scout-integration.mjs";

test("installs and removes only the managed Microsoft Scout skill", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-workspace-scout-"));
  const home = join(directory, "home");
  const installRoot = join(directory, "app");
  const sourceDirectory = join(installRoot, "skills", "scout-context-workspace");
  const scoutPath = join(directory, "scout.exe");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "SKILL.md"),
    "<!-- context-workspace-managed-scout-skill -->\n---\nname: context-workspace-scout\n---\n",
    "utf8"
  );
  await writeFile(scoutPath, "", "utf8");
  const options = {
    env: { ...process.env, COPILOT_HOME: join(home, ".copilot"), SCOUT_PATH: scoutPath },
    home,
    platform: "win32"
  };

  let result = await configureScoutIntegration("install", installRoot, options);
  assert.equal(result.action, "installed");
  assert.equal(result.detected, true);
  assert.match(await readFile(result.skillPath, "utf8"), /context-workspace-managed-scout-skill/);
  assert.equal((await inspectScoutIntegration(options)).configured, true);

  result = await configureScoutIntegration("uninstall", installRoot, options);
  assert.equal(result.action, "uninstalled");
  assert.equal((await inspectScoutIntegration(options)).configured, false);
});

test("preserves an existing Scout skill not managed by Context Workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-workspace-scout-existing-"));
  const home = join(directory, "home");
  const installRoot = join(directory, "app");
  const sourceDirectory = join(installRoot, "skills", "scout-context-workspace");
  const skillPath = join(home, ".copilot", "skills", "context-workspace-scout", "SKILL.md");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(home, ".copilot", "skills", "context-workspace-scout"), { recursive: true });
  await writeFile(join(sourceDirectory, "SKILL.md"), "<!-- context-workspace-managed-scout-skill -->", "utf8");
  await writeFile(skillPath, "user-owned skill", "utf8");
  const options = {
    env: { ...process.env, COPILOT_HOME: join(home, ".copilot") },
    home,
    platform: "win32",
    force: true
  };

  await assert.rejects(
    configureScoutIntegration("install", installRoot, options),
    /not managed by Context Workspace/
  );
  assert.equal(await readFile(skillPath, "utf8"), "user-owned skill");
  const result = await configureScoutIntegration("uninstall", installRoot, options);
  assert.equal(result.action, "preserved");
  assert.equal(await readFile(skillPath, "utf8"), "user-owned skill");
});

test("Scout skill routes slash commands through verified Context Workspace sessions", async () => {
  const skill = await readFile(
    new URL("../skills/scout-context-workspace/SKILL.md", import.meta.url),
    "utf8"
  );
  assert.match(skill, /message contains \/cw:/);
  assert.match(skill, /\/cw:wrap-session/);
  assert.match(skill, /supported Scout chat alias/);
  assert.match(skill, /GET `\/api\/sessions\/\{returnedSessionId\}`/);
  assert.match(skill, /Never create or report a local-only wrap/);
  assert.match(skill, /do not claim the conversation is tracked/);
});
