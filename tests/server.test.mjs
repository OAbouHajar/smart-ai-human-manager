import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = await mkdtemp(join(tmpdir(), "context-workspace-"));
const port = 43121;
const baseUrl = `http://127.0.0.1:${port}`;
const currentVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const availableVersion = currentVersion.replace(/(\d+)$/, (patch) => String(Number(patch) + 1));
const updateRunner = fileURLToPath(new URL("fixtures/update-runner-stub.mjs", import.meta.url));
const releaseUrl = `data:application/json,${encodeURIComponent(JSON.stringify({
  tag_name: `v${availableVersion}`,
  html_url: `https://github.com/OAbouHajar/smart-ai-human-manager/releases/tag/v${availableVersion}`,
  published_at: "2026-08-18T08:00:00Z"
}))}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    CONTEXT_WORKSPACE_DATA: dataDir,
    CONTEXT_WORKSPACE_PORT: String(port),
    CONTEXT_WORKSPACE_IMPORT_HISTORY: "0",
    CONTEXT_WORKSPACE_RELEASES_URL: releaseUrl,
    CONTEXT_WORKSPACE_UPDATE_RUNNER: updateRunner
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
  assert.equal(update.latestVersion, availableVersion);
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
  assert.equal(job.toVersion, availableVersion);
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
  assert.equal(startResult.updateJob.toVersion, availableVersion);
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
    assert.deepEqual(info.providers.map((provider) => provider.id), ["copilot", "claude", "codex", "gemini", "scout"]);
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
  })}\n${JSON.stringify({
    type: "model.model_call_success",
    data: { responseUsage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } }
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
  assert.equal(session.metrics.inputTokens, 1200);
  assert.equal(session.metrics.outputTokens, 300);
  assert.equal(session.metrics.totalTokens, 1500);
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

test("exports and imports sanitized shared project boards", async () => {
  const sessionId = "shared-board-source";
  await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  const project = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Shared Delivery",
      description: "Coordinate private AI sessions through shared work.",
      sessionId,
      autoWrap: false
    })
  }).then((response) => response.json());
  const task = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Build safe project export",
      description: "Publish only approved Kanban fields.",
      owner: "Osama",
      status: "in_progress"
    })
  }).then((response) => response.json());

  assert.equal(task.ticketId, "SD-1");
  assert.equal(task.description, "Publish only approved Kanban fields.");
  assert.equal(task.owner, "Osama");
  assert.equal(task.agent, "GitHub Copilot CLI");

  const attributionSessionId = "shared-board-attribution";
  await fetch(`${baseUrl}/api/hooks/claude/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: attributionSessionId, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  await fetch(`${baseUrl}/api/projects/${project.id}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: `claude:${attributionSessionId}`,
      autoWrap: false,
      requireUnassigned: true
    })
  });
  let attributed = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "done",
      actorSessionId: `claude:${attributionSessionId}`,
      actorName: "Jack"
    })
  }).then((response) => response.json());
  assert.equal(attributed.completedBy, "Jack");
  assert.equal(attributed.completedWith, "Claude Code");
  attributed = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "in_progress",
      recommendedModel: "GPT-5.6 Sol",
      modelProvider: "GitHub Copilot CLI",
      reasoningEffort: "high",
      modelReason: "Cross-file implementation and privacy-sensitive migration logic require stronger reasoning."
    })
  }).then((response) => response.json());

  const snapshot = await fetch(`${baseUrl}/api/projects/${project.id}/share`).then((response) => response.json());
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.project.ticketPrefix, "SD");
  assert.deepEqual(snapshot.tickets[0], {
    ticketId: "SD-1",
    title: "Build safe project export",
    description: "Publish only approved Kanban fields.",
    status: "in_progress",
    owner: "Osama",
    agent: "Claude Code",
    completedBy: "",
    completedWith: "",
    recommendedModel: "GPT-5.6 Sol",
    modelProvider: "GitHub Copilot CLI",
    reasoningEffort: "high",
    modelReason: "Cross-file implementation and privacy-sensitive migration logic require stronger reasoning.",
    updatedAt: attributed.updatedAt
  });
  assert.equal(snapshot.context.summary, "");
  assert.match(snapshot.context.starterPrompt, /Continue the Context Workspace project "Shared Delivery"/);
  assert.match(snapshot.context.starterPrompt, /Build safe project export/);
  assert.equal("sessions" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes("prompt"), false);
  assert.equal("repository" in snapshot.project, false);
  assert.equal(JSON.stringify(snapshot).includes(process.cwd()), false);

  let response = await fetch(`${baseUrl}/api/projects/${project.id}/share`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      remote: "origin",
      branch: "context-workspace/shared-projects",
      path: `projects/${project.id}/project.json`,
      pushedAt: Date.now(),
      revision: snapshot.revision
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sharing.enabled, true);
  const sharedProjects = await fetch(`${baseUrl}/api/projects?filter=shared`).then((result) => result.json());
  assert.equal(sharedProjects.some((item) => item.id === project.id), true);

  await new Promise((resolve) => setTimeout(resolve, 2));
  response = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "A local change not pushed yet." })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/shared-projects/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot: { ...snapshot, revision: snapshot.revision + 1 },
      remote: "origin",
      branch: "context-workspace/shared-projects",
      path: `projects/${project.id}/project.json`
    })
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SHARED_PROJECT_LOCAL_CHANGES");

  const importedProjectId = "imported-project";
  response = await fetch(`${baseUrl}/api/shared-projects/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot: {
        ...snapshot,
        revision: snapshot.revision + 1,
        project: { ...snapshot.project, id: importedProjectId, title: "Imported Delivery" },
        tickets: [{
          ...snapshot.tickets[0],
          ticketId: "ID-1",
          owner: "Jack",
          status: "next"
        }],
        context: {
          summary: "A sanitized project handoff.",
          completedWork: "Safe export implemented.",
          nextAction: "Validate teammate import.",
          blockers: ["Waiting for review."],
          starterPrompt: "Continue the imported project using its shared board."
        }
      },
      remote: "origin",
      branch: "context-workspace/shared-projects",
      path: `projects/${importedProjectId}/project.json`
    })
  });
  assert.equal(response.status, 201);
  const imported = await response.json();
  assert.equal(imported.project.sharing.enabled, true);
  assert.equal(imported.project.sharing.pulledAt > 0, true);

  const board = await fetch(`${baseUrl}/api/board?projectId=${importedProjectId}`).then((result) => result.json());
  assert.equal(board.sessions.length, 0);
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].ticketId, "ID-1");
  assert.equal(board.tasks[0].owner, "Jack");
  assert.equal(board.tasks[0].description, "Publish only approved Kanban fields.");
  assert.equal(board.projectState.summary, "A sanitized project handoff.");
  assert.equal(board.projectState.nextAction, "Validate teammate import.");
  assert.equal(board.projectState.initialQuestion, "Continue the imported project using its shared board.");

  const teammateSessionId = "teammate-import-session";
  response = await fetch(`${baseUrl}/api/hooks/copilot/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: teammateSessionId,
      timestamp: Date.now(),
      cwd: process.cwd(),
      source: "new"
    })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/projects/${importedProjectId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: teammateSessionId,
      autoWrap: false,
      requireUnassigned: true
    })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/shared-projects/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot: {
        ...snapshot,
        revision: snapshot.revision + 2,
        project: { ...snapshot.project, id: importedProjectId, title: "Imported Delivery" },
        tickets: [{
          ...snapshot.tickets[0],
          ticketId: "ID-1",
          owner: "Jack",
          status: "done",
          updatedAt: snapshot.revision + 2
        }]
      },
      remote: "origin",
      branch: "context-workspace/shared-projects",
      path: `projects/${importedProjectId}/project.json`
    })
  });
  assert.equal(response.status, 200);
  const refreshedBoard = await fetch(`${baseUrl}/api/board?projectId=${importedProjectId}`).then((result) => result.json());
  assert.equal(refreshedBoard.tasks[0].status, "done");
  assert.equal(refreshedBoard.sessions.some((session) => session.id === teammateSessionId), true);

  response = await fetch(`${baseUrl}/api/shared-projects/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot: {
        ...snapshot,
        revision: snapshot.revision + 3,
        project: { ...snapshot.project, id: importedProjectId, title: "Imported Delivery" },
        tickets: []
      },
      remote: "origin",
      branch: "context-workspace/shared-projects",
      path: `projects/${importedProjectId}/project.json`
    })
  });
  assert.equal(response.status, 200);
  const boardAfterDeletion = await fetch(`${baseUrl}/api/board?projectId=${importedProjectId}`).then((result) => result.json());
  assert.equal(boardAfterDeletion.tasks.length, 0);
  assert.equal(boardAfterDeletion.sessions.some((session) => session.id === teammateSessionId), true);
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
  response = await fetch(`${baseUrl}/api/hooks/scout/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: externalId, timestamp: Date.now(), cwd: process.cwd(), source: "scout-skill" })
  });
  assert.equal(response.status, 200);

  const claude = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`claude:${externalId}`)}`).then((result) => result.json());
  const gemini = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`gemini:${externalId}`)}`).then((result) => result.json());
  const codex = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`codex:${externalId}`)}`).then((result) => result.json());
  const scout = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(`scout:${externalId}`)}`).then((result) => result.json());
  assert.equal(claude.provider, "claude");
  assert.equal(claude.externalId, externalId);
  assert.equal(claude.providerName, "Claude Code");
  assert.equal(claude.resumeCommand, `claude --resume ${externalId}`);
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.resumeCommand, `gemini --resume ${externalId}`);
  assert.equal(codex.providerName, "Codex CLI");
  assert.equal(codex.resumeCommand, `codex resume ${externalId}`);
  assert.equal(scout.providerName, "Microsoft Scout");
  assert.equal(scout.resumeCommand, "");
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
