import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = await mkdtemp(join(tmpdir(), "smart-ai-human-manager-"));
const port = 43121;
const baseUrl = `http://127.0.0.1:${port}`;
const currentVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const updateRunner = fileURLToPath(new URL("fixtures/update-runner-stub.mjs", import.meta.url));
const releaseUrl = `data:application/json,${encodeURIComponent(JSON.stringify({
  tag_name: "v0.4.1",
  html_url: "https://github.com/OAbouHajar/smart-ai-human-manager/releases/tag/v0.4.1",
  published_at: "2026-08-18T08:00:00Z"
}))}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    COPILOT_SESSION_HUB_DATA: dataDir,
    COPILOT_SESSION_HUB_PORT: String(port),
    COPILOT_SESSION_HUB_IMPORT_HISTORY: "0",
    COPILOT_SESSION_HUB_RELEASES_URL: releaseUrl,
    COPILOT_SESSION_HUB_UPDATE_RUNNER: updateRunner
  },
  stdio: "ignore",
  windowsHide: true
});

await waitForHealth();

test.after(async () => {
  await fetch(`${baseUrl}/api/shutdown`, { method: "POST" }).catch(() => {});
  server.kill();
});

test("reports installed and available stable versions", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.version, currentVersion);

  const update = await fetch(`${baseUrl}/api/update?refresh=1`).then((response) => response.json());
  assert.equal(update.currentVersion, currentVersion);
  assert.equal(update.latestVersion, "0.4.1");
  assert.equal(update.updateAvailable, true);
  assert.equal(update.error, "");
});

test("prepares an update and continues it when the initiating session exits", async () => {
  const id = "update-session";
  let response = await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/update/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id })
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).job.state, "preparing");

  const job = await waitForUpdateState("waiting_for_exit");
  assert.equal(job.fromVersion, currentVersion);
  assert.equal(job.toVersion, "0.4.1");
  const config = JSON.parse(await readFile(join(dataDir, "update", "job.json"), "utf8"));
  assert.equal(config.cancelPath, join(dataDir, "update", "cancel"));
  assert.equal(config.deadline - config.createdAt, 4 * 60 * 60 * 1000);

  response = await fetch(`${baseUrl}/api/hooks/sessionEnd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now() })
  });
  assert.equal(response.status, 200);
  await waitForFile(join(dataDir, "update", "continue"));

  await writeFile(join(dataDir, "update", "status.json"), JSON.stringify({
    ...job,
    state: "succeeded",
    completedAt: Date.now()
  }));
  response = await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "post-update-session", timestamp: Date.now(), cwd: process.cwd() })
  });
  assert.equal(response.status, 200);
  const startResult = await response.json();
  assert.equal(startResult.updateJob.state, "succeeded");
  assert.equal(startResult.updateJob.toVersion, "0.4.1");
});

test("rejects inactive sessions and accepts cancellation before installation", async () => {
  const inactiveId = "inactive-update-session";
  await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: inactiveId, timestamp: Date.now(), cwd: process.cwd() })
  });
  await fetch(`${baseUrl}/api/hooks/sessionEnd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: inactiveId, timestamp: Date.now() })
  });
  let response = await fetch(`${baseUrl}/api/update/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: inactiveId })
  });
  assert.equal(response.status, 400);

  const activeId = "cancel-update-session";
  await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: activeId, timestamp: Date.now(), cwd: process.cwd() })
  });
  response = await fetch(`${baseUrl}/api/update/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: activeId })
  });
  assert.equal(response.status, 202);
  await waitForUpdateState("waiting_for_exit");

  response = await fetch(`${baseUrl}/api/update/cancel`, { method: "POST" });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).state, "cancelling");
  await waitForFile(join(dataDir, "update", "cancel"));
});

test("tracks, checkpoints, and updates a Copilot session", async () => {
  const id = "test-session-1";
  let response = await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });

  test("returns application version, providers, and public project links", async () => {
    const response = await fetch(`${baseUrl}/api/info`);
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.match(info.version, /^\d+\.\d+\.\d+$/);
    assert.equal(info.repositoryUrl, "https://github.com/OAbouHajar/smart-ai-human-manager");
    assert.equal(info.releasesUrl, "https://github.com/OAbouHajar/smart-ai-human-manager/releases");
    assert.deepEqual(info.providers.map((provider) => provider.id), ["copilot", "claude", "codex", "gemini"]);
    assert.equal(info.providers.every((provider) =>
      typeof provider.detected === "boolean" && typeof provider.configured === "boolean"
    ), true);
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).update.updateAvailable, true);

  const metricsPath = join(dataDir, "metrics-events.jsonl");
  await writeFile(metricsPath, `${JSON.stringify({
    type: "session.usage_checkpoint",
    data: { totalNanoAiu: 18_943_000_000_000 }
  })}\n`, "utf8");
  response = await fetch(`${baseUrl}/api/hooks/agentStop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), transcriptPath: metricsPath })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Build session dashboard",
      summary: "Implemented local continuity tracking.",
      lastAction: "Created the API.",
      nextAction: "Verify the dashboard.",
      tasks: ["Run tests", "Install plugin"],
      unresolved: ["Visual regression testing"],
      decisions: ["Use localhost-only storage"],
      files: [{ path: "server/server.mjs", toolName: "edit" }]
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).update.updateAvailable, true);

  const session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(session.title, "Build session dashboard");
  assert.equal(session.tasks.length, 2);
  assert.equal(session.needsReview, false);
  assert.equal(session.metrics.aiCredits, 18_943);
  assert.equal(session.fileHistoryStatus, "current");
  assert.equal(session.files[0].displayPath, "server/server.mjs");

  response = await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ needsReview: true })
  });
  assert.equal(response.status, 200);
  const unwrapped = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(unwrapped.needsReview, true);
  assert.equal(unwrapped.title, "Build session dashboard");
  assert.equal(unwrapped.summary, "Implemented local continuity tracking.");
  assert.equal(unwrapped.tasks.length, 2);

  response = await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ needsReview: false })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/tasks/${session.tasks[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ completed: true })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, true);

  response = await fetch(`${baseUrl}/api/tasks/${session.tasks[1].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in_progress" })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "in_progress");

  response = await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isProject: true })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/sessions/${id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "Feature",
      title: "Session continuity",
      url: "https://example.visualstudio.com/Engineering/_workitems/edit/12345"
    })
  });
  assert.equal(response.status, 201);

  const board = await fetch(`${baseUrl}/api/board?sessionId=${id}`).then((result) => result.json());
  assert.equal(board.counts.done, 1);
  assert.equal(board.counts.in_progress, 1);
  assert.equal(board.workItems[0].workItemId, 12345);
  const projects = await fetch(`${baseUrl}/api/projects`).then((result) => result.json());
  assert.equal(projects.length, 1);
  assert.equal(projects[0].isProject, true);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: "Updated summary only." })
  });
  assert.equal(response.status, 200);
  const preserved = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(preserved.title, "Build session dashboard");
  assert.equal(preserved.tasks.length, 2);
  assert.equal(preserved.summary, "Updated summary only.");
  assert.equal(preserved.imported, false);
  assert.equal(preserved.workItems.length, 1);
  assert.equal(preserved.providerName, "GitHub Copilot CLI");
  assert.equal(preserved.resumeCommand, `copilot --resume=${id}`);
  assert.ok("metrics" in preserved);
});

test("checkpoint task reconciliation preserves board identities and statuses", async () => {
  const id = "task-preservation";
  await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isProject: true })
  });

  const taskA = await fetch(`${baseUrl}/api/sessions/${id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Keep backlog identity" })
  }).then((response) => response.json());
  const taskB = await fetch(`${baseUrl}/api/sessions/${id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Keep blocked identity" })
  }).then((response) => response.json());
  await fetch(`${baseUrl}/api/tasks/${taskA.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "backlog" })
  });
  await fetch(`${baseUrl}/api/tasks/${taskB.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "blocked" })
  });

  let response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: ["Keep backlog identity", "New AI-discovered task"] })
  });
  assert.equal(response.status, 200);

  let session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  const preservedA = session.tasks.find((task) => task.text === "Keep backlog identity");
  const preservedB = session.tasks.find((task) => task.text === "Keep blocked identity");
  assert.equal(preservedA.id, taskA.id);
  assert.equal(preservedA.status, "backlog");
  assert.equal(preservedB.id, taskB.id);
  assert.equal(preservedB.status, "blocked");
  assert.equal(session.tasks.filter((task) => task.text === "Keep backlog identity").length, 1);
  assert.equal(session.tasks.some((task) => task.text === "New AI-discovered task"), true);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: [] })
  });
  assert.equal(response.status, 200);
  session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(session.tasks.find((task) => task.id === taskA.id).status, "backlog");
  assert.equal(session.tasks.find((task) => task.id === taskB.id).status, "blocked");
});

test("tracks provider sessions with collision-safe IDs and resume commands", async () => {
  const externalId = "shared-session-id";
  let response = await fetch(`${baseUrl}/api/hooks/claude/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: externalId,
      timestamp: Date.now(),
      cwd: process.cwd(),
      source: "startup",
      transcriptPath: "/tmp/claude-session.jsonl"
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessionId, `claude:${externalId}`);

  response = await fetch(`${baseUrl}/api/hooks/gemini/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: externalId, timestamp: Date.now(), cwd: process.cwd(), source: "startup" })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/hooks/codex/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: externalId, timestamp: Date.now(), cwd: process.cwd(), source: "startup" })
  });
  assert.equal(response.status, 200);

  const claude = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`claude:${externalId}`)}`).then((result) => result.json());
  const gemini = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`gemini:${externalId}`)}`).then((result) => result.json());
  const codex = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`codex:${externalId}`)}`).then((result) => result.json());
  assert.equal(claude.provider, "claude");
  assert.equal(claude.externalId, externalId);
  assert.equal(claude.providerName, "Claude Code");
  assert.equal(claude.resumeCommand, `claude --resume ${externalId}`);
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.resumeCommand, `gemini --resume ${externalId}`);
  assert.equal(codex.providerName, "Codex CLI");
  assert.equal(codex.resumeCommand, `codex resume ${externalId}`);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
}

async function waitForUpdateState(expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const job = await fetch(`${baseUrl}/api/update/job`).then((response) => response.json());
    if (job.state === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Update job did not reach ${expected}`);
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`File was not created: ${path}`);
}
