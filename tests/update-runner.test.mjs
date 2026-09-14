import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpdate, validateUpdateConfig } from "../scripts/update-runner.mjs";

test("runs a verified update after the session-exit signal", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "session-hub-update-"));
  const stagingPath = join(dataDir, "staging");
  const statusPath = join(dataDir, "status.json");
  const signalPath = join(dataDir, "continue");
  const cancelPath = join(dataDir, "cancel");
  const createdAt = Date.now();
  const config = {
    dataDir,
    stagingPath,
    statusPath,
    signalPath,
    cancelPath,
    logPath: join(dataDir, "update.log"),
    fromVersion: "0.3.2",
    toVersion: "0.4.0",
    releaseUrl: "https://github.com/OAbouHajar/context-workspace/releases/tag/v0.4.0",
    sessionId: "session-1",
    dashboardUrl: "http://127.0.0.1:43120",
    createdAt,
    deadline: createdAt + 60_000
  };
  const states = [];

  await runUpdate(config, {
    cloneRelease: async () => {
      await mkdir(stagingPath, { recursive: true });
      await mkdir(join(stagingPath, "scripts"));
      await writeFile(join(stagingPath, "package.json"), '{"version":"0.4.0"}');
      await writeFile(join(stagingPath, "plugin.json"), '{"version":"0.4.0"}');
      await writeFile(join(stagingPath, "scripts", process.platform === "win32" ? "install.ps1" : "install.sh"), "");
    },
    waitForSignal: async () => {
      states.push(JSON.parse(await readFile(statusPath, "utf8")).state);
    },
    installRelease: () => {
      states.push(JSON.parse(readFileSync(statusPath, "utf8")).state);
    },
    verifyHealth: async () => {},
    remove: () => {}
  });

  const result = JSON.parse(await readFile(statusPath, "utf8"));
  assert.deepEqual(states, ["waiting_for_exit", "installing"]);
  assert.equal(result.state, "succeeded");
  assert.equal(result.fromVersion, "0.3.2");
  assert.equal(result.toVersion, "0.4.0");
});

test("reports integration refresh failures as a successful update with warnings", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "session-hub-update-warning-"));
  const stagingPath = join(dataDir, "staging");
  const statusPath = join(dataDir, "status.json");
  const createdAt = Date.now();
  const config = {
    dataDir,
    stagingPath,
    statusPath,
    signalPath: join(dataDir, "continue"),
    cancelPath: join(dataDir, "cancel"),
    logPath: join(dataDir, "update.log"),
    fromVersion: "0.3.2",
    toVersion: "0.4.0",
    releaseUrl: "https://github.com/OAbouHajar/context-workspace/releases/tag/v0.4.0",
    sessionId: "session-1",
    dashboardUrl: "http://127.0.0.1:43120",
    createdAt,
    deadline: createdAt + 60_000
  };

  await runUpdate(config, {
    cloneRelease: async () => {
      await mkdir(join(stagingPath, "scripts"), { recursive: true });
      await writeFile(join(stagingPath, "package.json"), '{"version":"0.4.0"}');
      await writeFile(join(stagingPath, "plugin.json"), '{"version":"0.4.0"}');
      await writeFile(join(stagingPath, "scripts", process.platform === "win32" ? "install.ps1" : "install.sh"), "");
    },
    waitForSignal: async () => {},
    installRelease: async () => {
      throw new Error("plugin refresh failed");
    },
    verifyHealth: async () => {},
    remove: () => {}
  });

  const result = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(result.state, "succeeded_with_warnings");
  assert.match(result.warning, /integrations need to be refreshed/);
});

test("rejects untrusted versions, release URLs, and paths", () => {
  const valid = {
    dataDir: "/tmp/session-hub",
    stagingPath: "/tmp/session-hub/staging",
    statusPath: "/tmp/session-hub/status.json",
    signalPath: "/tmp/session-hub/continue",
    cancelPath: "/tmp/session-hub/cancel",
    logPath: "/tmp/session-hub/update.log",
    fromVersion: "0.3.2",
    toVersion: "0.4.0",
    releaseUrl: "https://github.com/OAbouHajar/context-workspace/releases/tag/v0.4.0",
    sessionId: "session-1",
    createdAt: 1000,
    deadline: 2000
  };
  assert.doesNotThrow(() => validateUpdateConfig(valid));
  assert.throws(() => validateUpdateConfig({ ...valid, toVersion: "0.4.0;rm" }), /Invalid toVersion/);
  assert.throws(() => validateUpdateConfig({ ...valid, releaseUrl: "https://example.com/v0.4.0" }), /Invalid release URL/);
  assert.throws(() => validateUpdateConfig({ ...valid, statusPath: "/tmp/other/status.json" }), /Invalid statusPath/);
});
