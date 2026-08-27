import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
let nextPort = 44000 + Math.floor(Math.random() * 1000);

test("synchronizes files, exposes safe paths, and searches archived sessions", async () => {
  const fixture = await createFixture();
  const sessionId = "recall-files";
  createHistory(fixture.historyPath, {
    sessions: [{
      id: sessionId,
      cwd: "C:\\repo",
      repository: "C:\\repo",
      summary: "Recall the payment migration"
    }],
    files: [
      { sessionId, path: "C:\\repo\\src\\inside.js", toolName: "edit", turnIndex: 2 },
      { sessionId, path: "D:\\private\\outside.js", toolName: "view", turnIndex: 3 }
    ],
    questions: [
      { sessionId, text: "/sham:wrap", turnIndex: 0 },
      { sessionId, text: "<skill-context name=\"session-wrap\">Internal skill instructions</skill-context>", turnIndex: 1 },
      { sessionId, text: "How can I finish the payment migration?", turnIndex: 2 },
      { sessionId, text: "Can you add tests for the retry path?", turnIndex: 3 }
    ]
  });

  const server = await startServer(fixture);
  try {
    const imported = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(imported.imported, 1, `${JSON.stringify(imported)} ${server.getStderr()}`);
    assert.equal(imported.fileSessions, 1);

    await request(server, `/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: { archived: true }
    });

    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "current");
    assert.equal(detail.initialQuestion, "How can I finish the payment migration?");
    assert.deepEqual(detail.questions, [
      "Session Wrap skill was called.",
      "How can I finish the payment migration?",
      "Can you add tests for the retry path?"
    ]);
    assert.equal(detail.fileCount, 2);
    assert.deepEqual(
      detail.files.map(({ displayPath, outsideWorkspace }) => ({ displayPath, outsideWorkspace })),
      [
        { displayPath: "src/inside.js", outsideWorkspace: false },
        { displayPath: "outside.js", outsideWorkspace: true }
      ]
    );
    for (const file of detail.files) {
      assert.equal("filePath" in file, false);
      assert.equal("file_path" in file, false);
      assert.equal("pathKey" in file, false);
    }

    const results = await request(server, "/api/sessions?filter=open&q=outside.js");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, sessionId);
    assert.deepEqual(results[0].searchMatch, { type: "file", text: "outside.js" });
  } finally {
    await stopServer(server, fixture);
  }
});

test("searches task text across archived history and preserves project state", async () => {
  const fixture = await createFixture();
  const server = await startServer(fixture);
  const sessionId = "task-recall";
  try {
    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId, cwd: process.cwd(), timestamp: Date.now(), source: "new" }
    });
    await request(server, `/api/sessions/${sessionId}/tasks`, {
      method: "POST",
      body: { text: "Reconcile lunar invoice queue" }
    });
    await request(server, `/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: { archived: true, isProject: true }
    });

    const results = await request(server, "/api/sessions?filter=open&q=LUNAR");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, sessionId);
    assert.equal(results[0].isProject, true);
    assert.deepEqual(results[0].searchMatch, {
      type: "task",
      text: "Reconcile lunar invoice queue"
    });
  } finally {
    await stopServer(server, fixture);
  }
});

test("searches every recall metadata field case-insensitively", async () => {
  const fixture = await createFixture();
  const sessionId = "metadata-recall";
  createHistory(fixture.historyPath, {
    sessions: [{
      id: sessionId,
      cwd: "C:\\work\\rare-folder",
      repository: "C:\\repos\\NebulaProject",
      summary: "Migrate the stellar billing service"
    }, {
      id: "unrelated-metadata",
      cwd: "C:\\work\\ordinary",
      repository: "C:\\repos\\OrdinaryProject",
      summary: "Routine maintenance"
    }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/import-history", { method: "POST" });
    await request(server, `/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: {
        title: "Nebula_100% Migration",
        summary: "Migrate the stellar billing service",
        lastAction: "Completed the ORBIT adapter",
        nextAction: "Validate the COMET deployment",
        archived: true
      }
    });

    for (const query of ["nebula_100% migration", "stellar billing", "rare-folder", "nebulaproject", "orbit adapter", "comet deployment"]) {
      const results = await request(server, `/api/sessions?filter=open&q=${encodeURIComponent(query)}`);
      assert.equal(results.some((session) => session.id === sessionId), true, `Expected match for ${query}`);
    }
    assert.equal((await request(server, "/api/sessions?filter=open&q=%25")).length, 1);
    assert.equal((await request(server, "/api/sessions?filter=open&q=_")).length, 1);
    assert.deepEqual(await request(server, "/api/sessions?filter=open&q=unknown-recall-term"), []);
  } finally {
    await stopServer(server, fixture);
  }
});

test("marks uncached sessions unavailable when the source database is absent", async () => {
  const fixture = await createFixture();
  const server = await startServer(fixture);
  const sessionId = "missing-source";
  try {
    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId, cwd: process.cwd(), timestamp: Date.now(), source: "new" }
    });
    const result = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(result.available, false);
    assert.equal(result.error, "SOURCE_DB_UNAVAILABLE");

    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "unavailable");
    assert.equal(detail.fileCount, 0);
    assert.deepEqual(detail.files, []);
  } finally {
    await stopServer(server, fixture);
  }
});

test("preserves cached files and marks them stale when the source disappears", async () => {
  const fixture = await createFixture();
  const sessionId = "stale-cache";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Cached work" }],
    files: [{ sessionId, path: "C:\\repo\\src\\cached.js", toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/import-history", { method: "POST" });
    const before = await request(server, `/api/sessions/${sessionId}`);
    await unlink(fixture.historyPath);

    const failed = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(failed.error, "SOURCE_DB_UNAVAILABLE");
    const after = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(after.fileHistoryStatus, "stale");
    assert.equal(after.fileCount, 1);
    assert.equal(after.files[0].displayPath, "src/cached.js");
    assert.equal(after.fileHistorySyncedAt, before.fileHistorySyncedAt);

    createHistory(fixture.historyPath, {
      sessions: [{ id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Cached work" }],
      files: [{ sessionId, path: "C:\\repo\\src\\restored.js", toolName: "edit", turnIndex: 2 }]
    });
    await request(server, "/api/import-history", { method: "POST" });
    const recovered = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(recovered.fileHistoryStatus, "current");
    assert.equal(recovered.files[0].displayPath, "src/restored.js");
  } finally {
    await stopServer(server, fixture);
  }
});

test("preserves the full cache when a source snapshot is partially malformed", async () => {
  const fixture = await createFixture();
  const sessionId = "malformed-snapshot";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Validate history" }],
    files: [{ sessionId, path: "C:\\repo\\src\\original.js", toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/import-history", { method: "POST" });
    replaceFiles(fixture.historyPath, [
      { sessionId, path: "C:\\repo\\src\\replacement.js", toolName: "edit", turnIndex: 2 },
      { sessionId, path: "C:\\repo\\src\\bad\u202efile.js", toolName: "edit", turnIndex: 3 }
    ]);

    const result = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(result.fileSessions, 0);
    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "stale");
    assert.equal(detail.fileCount, 1);
    assert.equal(detail.files[0].displayPath, "src/original.js");
  } finally {
    await stopServer(server, fixture);
  }
});

test("preserves cached files when the source file schema is unsupported", async () => {
  const fixture = await createFixture();
  const sessionId = "unsupported-schema";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Schema change" }],
    files: [{ sessionId, path: "C:\\repo\\src\\cached.js", toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/import-history", { method: "POST" });
    await unlink(fixture.historyPath);
    createSessionsOnlyHistory(fixture.historyPath, [
      { id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Schema change" }
    ]);

    const result = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(result.filesAvailable, false);
    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "stale");
    assert.equal(detail.files[0].displayPath, "src/cached.js");
  } finally {
    await stopServer(server, fixture);
  }
});

test("rejects snapshots above the 10000-file boundary without replacing cache", async () => {
  const fixture = await createFixture();
  const sessionId = "oversized-snapshot";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: "C:\\repo", repository: "C:\\repo", summary: "Large history" }],
    files: [{ sessionId, path: "C:\\repo\\src\\cached.js", toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/import-history", { method: "POST" });
    replaceFiles(fixture.historyPath, Array.from({ length: 10001 }, (_, index) => ({
      sessionId,
      path: `C:\\repo\\generated\\file-${index}.js`,
      toolName: "edit",
      turnIndex: index
    })));

    const result = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(result.fileSessions, 0);
    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "stale");
    assert.equal(detail.fileCount, 1);
    assert.equal(detail.files[0].displayPath, "src/cached.js");
  } finally {
    await stopServer(server, fixture);
  }
});

test("sets current and empty states and remains idempotent", async () => {
  const fixture = await createFixture();
  createHistory(fixture.historyPath, {
    sessions: [
      { id: "with-files", cwd: "C:\\repo", repository: "C:\\repo", summary: "Has files" },
      { id: "without-files", cwd: "C:\\repo", repository: "C:\\repo", summary: "No files" }
    ],
    files: [{ sessionId: "with-files", path: "C:\\repo\\one.js", toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    const first = await request(server, "/api/import-history", { method: "POST" });
    const second = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(first.imported, 2);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 2);

    const withFiles = await request(server, "/api/sessions/with-files");
    const withoutFiles = await request(server, "/api/sessions/without-files");
    assert.equal(withFiles.fileHistoryStatus, "current");
    assert.equal(withFiles.fileCount, 1);
    assert.equal(withoutFiles.fileHistoryStatus, "empty");
    assert.equal(withoutFiles.fileCount, 0);
    assert.ok(Number.isFinite(withFiles.fileHistorySyncedAt));
    assert.ok(Number.isFinite(withoutFiles.fileHistorySyncedAt));
    assert.equal(withFiles.events.filter((event) => event.type === "history-import").length, 1);
  } finally {
    await stopServer(server, fixture);
  }
});

test("imports a session supported only by file evidence", async () => {
  const fixture = await createFixture();
  const sessionId = "file-only";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: "", repository: "", summary: "" }],
    files: [{ sessionId, path: "D:\\outside\\only-file.txt", toolName: "view", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    const result = await request(server, "/api/import-history", { method: "POST" });
    assert.equal(result.imported, 1);
    assert.equal(result.fileSessions, 1);
    const detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.title, "New Copilot session");
    assert.equal(detail.imported, true);
    assert.equal(detail.files[0].displayPath, "only-file.txt");
    assert.equal(detail.files[0].outsideWorkspace, true);
  } finally {
    await stopServer(server, fixture);
  }
});

test("synchronizes files on all lifecycle hooks without disturbing project data", async () => {
  const fixture = await createFixture();
  const sessionId = "hook-sync";
  createHistory(fixture.historyPath, {
    sessions: [{ id: sessionId, cwd: process.cwd(), repository: process.cwd(), summary: "Hook sync" }],
    files: [{ sessionId, path: join(process.cwd(), "server", "server.mjs"), toolName: "edit", turnIndex: 1 }]
  });
  const server = await startServer(fixture);
  try {
    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId, cwd: process.cwd(), timestamp: Date.now(), source: "new" }
    });
    await request(server, `/api/sessions/${sessionId}/tasks`, {
      method: "POST",
      body: { text: "Keep project behavior" }
    });
    await request(server, `/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: { isProject: true }
    });
    await request(server, `/api/sessions/${sessionId}/work-items`, {
      method: "POST",
      body: {
        type: "Feature",
        title: "Recall-first work",
        url: "https://example.visualstudio.com/Engineering/_workitems/edit/456"
      }
    });

    await request(server, "/api/hooks/agentStop", {
      method: "POST",
      body: { sessionId, timestamp: Date.now() }
    });
    let detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "current");

    replaceFiles(fixture.historyPath, []);
    await request(server, "/api/hooks/preCompact", {
      method: "POST",
      body: { sessionId, timestamp: Date.now() }
    });
    detail = await request(server, `/api/sessions/${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "empty");

    replaceFiles(fixture.historyPath, [
      { sessionId, path: join(process.cwd(), "public", "app.js"), toolName: "edit", turnIndex: 2 }
    ]);
    await request(server, "/api/hooks/sessionEnd", {
      method: "POST",
      body: { sessionId, timestamp: Date.now(), reason: "user_exit" }
    });

    detail = await request(server, `/api/sessions/${sessionId}`);
    const projects = await request(server, "/api/projects");
    const board = await request(server, `/api/board?sessionId=${sessionId}`);
    assert.equal(detail.fileHistoryStatus, "current");
    assert.equal(detail.status, "paused");
    assert.equal(detail.tasks.length, 1);
    assert.equal(detail.workItems[0].workItemId, 456);
    assert.equal(projects[0].isProject, true);
    assert.equal(board.total, 1);
  } finally {
    await stopServer(server, fixture);
  }
});

test("returns an actionable conflict when the resume workspace is missing", async () => {
  const fixture = await createFixture();
  const server = await startServer(fixture);
  const sessionId = "missing-workspace";
  try {
    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId, cwd: join(fixture.directory, "does-not-exist"), timestamp: Date.now(), source: "new" }
    });
    const response = await fetch(`${server.baseUrl}/api/sessions/${sessionId}/resume`, { method: "POST" });
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.match(result.error, /working directory no longer exists/i);
  } finally {
    await stopServer(server, fixture);
  }
});

test("auto-wrap requires consent and preserves human control across providers", async () => {
  const fixture = await createFixture();
  const startedAt = Date.now();
  createHistory(fixture.historyPath, {
    checkpoints: [{
      sessionId: "copilot-auto-wrap",
      title: "Copilot generated title",
      overview: "Copilot generated summary",
      workDone: "Copilot generated work",
      nextSteps: "Copilot generated next action",
      checkpointNumber: 1,
      createdAt: new Date(startedAt + 100).toISOString()
    }]
  });
  const server = await startServer(fixture);
  try {
    const initialSettings = await request(server, "/api/settings");
    assert.deepEqual(initialSettings.autoWrap, { enabled: false, consented: false });

    await request(server, "/api/hooks/copilot/sessionStart", {
      method: "POST",
      body: { sessionId: "consent-check", cwd: fixture.directory, timestamp: startedAt }
    });
    const disabledResult = await request(server, "/api/hooks/copilot/preCompact", {
      method: "POST",
      body: { sessionId: "consent-check", timestamp: startedAt + 100, summary: "Must not be saved" }
    });
    assert.equal(disabledResult.autoWrapped, false);
    let detail = await request(server, "/api/sessions/consent-check");
    assert.equal(detail.needsReview, true);
    assert.equal(detail.checkpointSource, "");
    assert.equal(detail.projectId, "");

    const enabledSettings = await request(server, "/api/settings", {
      method: "PATCH",
      body: { autoWrapEnabled: true }
    });
    assert.deepEqual(enabledSettings.autoWrap, { enabled: true, consented: true });
    const unassignedWithGlobalDefault = await request(server, "/api/hooks/copilot/preCompact", {
      method: "POST",
      body: { sessionId: "consent-check", timestamp: startedAt + 200, summary: "Still must not be saved" }
    });
    assert.equal(unassignedWithGlobalDefault.autoWrapped, false);
    detail = await request(server, "/api/sessions/consent-check");
    assert.equal(detail.autoWrapMode, "inherit");
    assert.equal(detail.autoWrapEnabled, false);
    detail = await request(server, "/api/sessions/consent-check", {
      method: "PATCH",
      body: { autoWrapMode: "on" }
    });
    assert.equal(detail.autoWrapMode, "on");
    assert.equal(detail.autoWrapEnabled, true);
    detail = await request(server, "/api/sessions/consent-check", {
      method: "PATCH",
      body: { autoWrapMode: "off" }
    });
    assert.equal(detail.autoWrapMode, "off");
    assert.equal(detail.autoWrapEnabled, false);
    detail = await request(server, "/api/sessions/consent-check", {
      method: "PATCH",
      body: { autoWrapMode: "inherit" }
    });
    assert.equal(detail.autoWrapMode, "inherit");
    assert.equal(detail.autoWrapEnabled, false);
    await request(server, "/api/sessions/consent-check", {
      method: "PATCH",
      expectedStatus: 400,
      body: { autoWrapMode: "sometimes" }
    });

    for (const [index, provider] of ["copilot", "claude", "codex", "gemini"].entries()) {
      const externalId = `${provider}-auto-wrap`;
      const sessionId = provider === "copilot" ? externalId : `${provider}:${externalId}`;
      await request(server, `/api/hooks/${provider}/sessionStart`, {
        method: "POST",
        body: { sessionId: externalId, cwd: fixture.directory, timestamp: startedAt + index * 1000 }
      });
      await request(server, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: { autoWrap: true }
      });
      const wrapped = await request(server, `/api/hooks/${provider}/preCompact`, {
        method: "POST",
        body: {
          sessionId: externalId,
          timestamp: startedAt + index * 1000 + 100,
          summary: `${provider} automatic summary`,
          nextAction: `${provider} next action`
        }
      });
      assert.equal(wrapped.autoWrapped, true);
      detail = await request(server, `/api/sessions/${encodeURIComponent(sessionId)}`);
      assert.equal(detail.summary, provider === "copilot" ? "Copilot generated summary" : `${provider} automatic summary`);
      assert.equal(detail.nextAction, provider === "copilot" ? "Copilot generated next action" : `${provider} next action`);
      assert.equal(detail.checkpointSource, "automatic");
      assert.equal(detail.checkpointTrigger, provider === "copilot" ? "providerCheckpoint" : "preCompact");
      assert.equal(detail.needsReview, false);
      assert.equal(detail.projectId, "");
    }

    await request(server, "/api/sessions/copilot-auto-wrap/checkpoint", {
      method: "POST",
      body: { summary: "Human-authored wrap", nextAction: "Human-approved next action" }
    });
    const recentExit = await request(server, "/api/hooks/copilot/sessionEnd", {
      method: "POST",
      body: { sessionId: "copilot-auto-wrap", timestamp: Date.now(), reason: "user_exit" }
    });
    assert.equal(recentExit.autoWrapped, false);
    detail = await request(server, "/api/sessions/copilot-auto-wrap");
    assert.equal(detail.summary, "Human-authored wrap");
    assert.equal(detail.checkpointSource, "manual");

    const laterAutomatic = await request(server, "/api/hooks/copilot/preCompact", {
      method: "POST",
      body: {
        sessionId: "copilot-auto-wrap",
        timestamp: Date.now() + 6 * 60 * 1000,
        summary: "Automatic summary must not replace the human wrap",
        nextAction: "Automatic next action must not replace the human decision"
      }
    });
    assert.equal(laterAutomatic.autoWrapped, true);
    detail = await request(server, "/api/sessions/copilot-auto-wrap");
    assert.equal(detail.summary, "Human-authored wrap");
    assert.equal(detail.nextAction, "Human-approved next action");
    assert.equal(detail.checkpointSource, "manual");
    assert.equal(detail.autoCheckpointTrigger, "preCompact");

    const staleAutomatic = await request(server, "/api/hooks/copilot/preCompact", {
      method: "POST",
      body: {
        sessionId: "copilot-auto-wrap",
        timestamp: startedAt,
        summary: "Stale queued hook"
      }
    });
    assert.equal(staleAutomatic.autoWrapped, false);
    detail = await request(server, "/api/sessions/copilot-auto-wrap");
    assert.equal(detail.summary, "Human-authored wrap");

    await request(server, "/api/sessions/consent-check", {
      method: "PATCH",
      body: { autoWrap: true }
    });
    await request(server, "/api/hooks/copilot/preCompact", {
      method: "POST",
      body: {
        sessionId: "consent-check",
        timestamp: startedAt + 20_000,
        summary: "Newer automatic summary"
      }
    });
    const history = new DatabaseSync(fixture.historyPath);
    history.prepare(`
      INSERT INTO checkpoints(session_id, checkpoint_number, title, overview, work_done, next_steps, created_at)
      VALUES (?, 1, '', ?, '', '', ?)
    `).run("consent-check", "Older provider summary", new Date(startedAt + 10_000).toISOString());
    history.close();
    const staleProvider = await request(server, "/api/hooks/copilot/agentStop", {
      method: "POST",
      body: { sessionId: "consent-check", timestamp: startedAt + 30_000 }
    });
    assert.equal(staleProvider.autoWrapped, false);
    detail = await request(server, "/api/sessions/consent-check");
    assert.equal(detail.summary, "Newer automatic summary");
    await request(server, "/api/hooks/copilot/sessionEnd", {
      method: "POST",
      body: { sessionId: "consent-check", timestamp: startedAt + 10_000 }
    });
    detail = await request(server, "/api/sessions/consent-check");
    assert.equal(detail.status, "active");
    assert.equal(detail.endedAt, null);

    await request(server, "/api/sessions/claude%3Aclaude-auto-wrap/checkpoint", {
      method: "POST",
      body: { summary: "", lastAction: "", nextAction: "" }
    });
    await request(server, "/api/hooks/claude/preCompact", {
      method: "POST",
      body: {
        sessionId: "claude-auto-wrap",
        timestamp: Date.now() + 7 * 60 * 1000,
        summary: "Do not refill an intentionally empty summary",
        lastAction: "Do not refill an intentionally empty action",
        nextAction: "Do not refill an intentionally empty next action"
      }
    });
    detail = await request(server, "/api/sessions/claude%3Aclaude-auto-wrap");
    assert.equal(detail.summary, "");
    assert.equal(detail.lastAction, "");
    assert.equal(detail.nextAction, "");
    assert.equal(detail.checkpointSource, "manual");

    await request(server, "/api/sessions/gemini%3Agemini-auto-wrap", {
      method: "PATCH",
      body: { summary: "Human dashboard edit", nextAction: "Human dashboard decision" }
    });
    await request(server, "/api/hooks/gemini/preCompact", {
      method: "POST",
      body: {
        sessionId: "gemini-auto-wrap",
        timestamp: Date.now() + 8 * 60 * 1000,
        summary: "Automatic replacement",
        nextAction: "Automatic replacement"
      }
    });
    detail = await request(server, "/api/sessions/gemini%3Agemini-auto-wrap");
    assert.equal(detail.summary, "Human dashboard edit");
    assert.equal(detail.nextAction, "Human dashboard decision");
    assert.equal(detail.checkpointSource, "manual");
    assert.equal(detail.checkpointTrigger, "dashboard-edit");

    await request(server, "/api/hooks/claude/sessionStart", {
      method: "POST",
      body: { sessionId: "exit-fallback", cwd: fixture.directory, timestamp: startedAt }
    });
    await request(server, "/api/sessions/claude%3Aexit-fallback", {
      method: "PATCH",
      body: { autoWrap: true }
    });
    const exitFallback = await request(server, "/api/hooks/claude/sessionEnd", {
      method: "POST",
      body: { sessionId: "exit-fallback", timestamp: startedAt + 6 * 60 * 1000, summary: "Exit fallback summary" }
    });
    assert.equal(exitFallback.autoWrapped, true);
    detail = await request(server, "/api/sessions/claude%3Aexit-fallback");
    assert.equal(detail.checkpointTrigger, "sessionEnd");
    assert.equal(detail.summary, "Exit fallback summary");
    assert.equal(detail.projectId, "");

    await request(server, "/api/settings", {
      method: "PATCH",
      body: { autoWrapEnabled: false }
    });
    assert.deepEqual((await request(server, "/api/settings")).autoWrap, { enabled: false, consented: true });
  } finally {
    await stopServer(server, fixture);
  }
});

test("projects are explicit, keep unassigned sessions separate, and enforce one primary project", async () => {
  const fixture = await createFixture();
  const server = await startServer(fixture);
  const firstSession = "project-wrap-first";
  const secondSession = "project-wrap-second";
  try {
    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId: firstSession, cwd: fixture.directory, timestamp: Date.now(), source: "new" }
    });
    await request(server, `/api/sessions/${firstSession}/checkpoint`, {
      method: "POST",
      body: {
        title: "Plan project dashboard",
        summary: "Defined the project-first direction.",
        lastAction: "Created the initial plan.",
        nextAction: "Implement project overview",
        tasks: ["Implement project overview", "Write project tests"],
        completedTasks: [],
        unresolved: [],
        decisions: [],
        files: []
      }
    });

    await request(server, "/api/hooks/sessionStart", {
      method: "POST",
      body: { sessionId: secondSession, cwd: fixture.directory, timestamp: Date.now() + 1, source: "new" }
    });
    await request(server, `/api/sessions/${secondSession}/checkpoint`, {
      method: "POST",
      body: {
        title: "Build project dashboard",
        summary: "Implemented the project overview.",
        lastAction: "Implemented project overview",
        nextAction: "Release the new version",
        tasks: [],
        completedTasks: [],
        unresolved: [],
        decisions: ["Projects are the primary workspace."],
        files: []
      }
    });

    assert.deepEqual(await request(server, "/api/projects"), []);
    const unassigned = await request(server, "/api/sessions?filter=unassigned");
    assert.deepEqual(new Set(unassigned.map((session) => session.id)), new Set([firstSession, secondSession]));

    const releaseProject = await request(server, "/api/projects", {
      method: "POST",
      body: {
        title: "Prepare v0.4 release",
        description: "Ship the next stable version.",
        sessionId: firstSession,
        autoWrap: true
      }
    });
    let board = await request(server, `/api/board?projectId=${releaseProject.id}`);
    assert.equal(board.sessions.length, 1);
    assert.equal(board.sessions[0].id, firstSession);
    assert.equal((await request(server, `/api/sessions/${firstSession}`)).autoWrapEnabled, true);

    const suggestions = await request(server, `/api/project-suggestions?sessionId=${secondSession}`);
    assert.equal(suggestions[0].id, releaseProject.id);
    assert.equal(suggestions[0].suggested, true);
    assert.equal(suggestions[0].suggestionReason, "Same working directory");

    await request(server, `/api/projects/${releaseProject.id}/sessions`, {
      method: "POST",
      body: { sessionId: secondSession, autoWrap: false }
    });
    assert.equal((await request(server, `/api/sessions/${secondSession}`)).autoWrapEnabled, false);
    await request(server, `/api/projects/${releaseProject.id}/sessions`, {
      method: "POST",
      expectedStatus: 409,
      body: { sessionId: secondSession, autoWrap: true, requireUnassigned: true }
    });
    await request(server, `/api/sessions/${secondSession}/checkpoint`, {
      method: "POST",
      body: {
        nextAction: "Release the new version",
        tasks: ["Write project tests", "Release the new version"],
        completedTasks: ["Implement project overview"]
      }
    });

    const projects = await request(server, "/api/projects");
    assert.equal(projects.length, 1);
    assert.equal(projects[0].title, "Prepare v0.4 release");
    assert.equal(projects[0].sessionCount, 2);
    assert.equal(projects[0].openTaskCount, 2);

    board = await request(server, `/api/board?projectId=${releaseProject.id}`);
    assert.equal(board.sessions.length, 2);
    assert.equal(board.projectState.id, secondSession);
    assert.equal(board.projectState.nextAction, "Release the new version");
    assert.equal(board.total, 3);
    assert.equal(board.counts.done, 1);
    assert.equal(board.counts.next, 2);

    const projectWorkItem = await request(server, `/api/projects/${releaseProject.id}/work-items`, {
      method: "POST",
      body: {
        type: "Feature",
        title: "Release tracking",
        url: "https://dev.azure.com/example/session-hub/_workitems/edit/4321"
      }
    });
    assert.equal(projectWorkItem.projectId, releaseProject.id);
    board = await request(server, `/api/board?projectId=${releaseProject.id}`);
    assert.equal(board.workItems.length, 1);
    assert.equal(board.workItems[0].workItemId, 4321);
    const projectTask = await request(server, `/api/projects/${releaseProject.id}/tasks`, {
      method: "POST",
      body: { text: "Publish release notes", status: "next" }
    });
    assert.equal(projectTask.projectId, releaseProject.id);

    const codeProject = await request(server, "/api/projects", {
      method: "POST",
      body: { title: "Implement code changes", description: "Deliver a separate code goal." }
    });
    const starredProject = await request(server, `/api/projects/${releaseProject.id}`, {
      method: "PATCH",
      body: { starred: true }
    });
    assert.equal(starredProject.starred, true);
    assert.equal((await request(server, "/api/projects"))[0].id, releaseProject.id);
    await request(server, `/api/projects/${codeProject.id}/sessions`, {
      method: "POST",
      body: { sessionId: secondSession }
    });
    const releaseBoard = await request(server, `/api/board?projectId=${releaseProject.id}`);
    const codeBoard = await request(server, `/api/board?projectId=${codeProject.id}`);
    assert.deepEqual(releaseBoard.sessions.map((session) => session.id), [firstSession]);
    assert.deepEqual(codeBoard.sessions.map((session) => session.id), [secondSession]);
    assert.equal(releaseBoard.tasks.some((task) => task.text === "Publish release notes"), true);
    assert.equal(codeBoard.tasks.some((task) => task.text === "Publish release notes"), false);
    assert.equal(releaseBoard.workItems.length, 1);
    assert.equal(codeBoard.workItems.length, 0);
    const movedSessionDetail = await request(server, `/api/sessions/${secondSession}`);
    assert.deepEqual(movedSessionDetail.workItems, []);
    assert.equal(movedSessionDetail.tasks.some((task) => task.text === "Publish release notes"), false);

    await request(server, `/api/projects/${codeProject.id}/sessions/${secondSession}`, { method: "DELETE" });
    const movedSession = await request(server, `/api/sessions/${secondSession}`);
    assert.equal(movedSession.projectId, "");
    assert.equal(movedSession.project, null);

    const completedProject = await request(server, `/api/projects/${releaseProject.id}`, {
      method: "PATCH",
      body: { status: "complete" }
    });
    assert.equal(completedProject.status, "complete");

    const blockedArchive = await request(server, `/api/projects/${releaseProject.id}`, {
      method: "PATCH",
      expectedStatus: 409,
      body: { status: "archived" }
    });
    assert.equal(blockedArchive.code, "PROJECT_HAS_UNFINISHED_TASKS");
    assert.equal(blockedArchive.openTaskCount, 2);

    const archivedProject = await request(server, `/api/projects/${releaseProject.id}`, {
      method: "PATCH",
      body: { status: "archived", confirmArchive: true }
    });
    assert.equal(archivedProject.status, "archived");
    assert.equal((await request(server, "/api/projects")).some((project) => project.id === releaseProject.id), false);
    const archivedProjects = await request(server, "/api/projects?filter=archived");
    assert.equal(archivedProjects.some((project) => project.id === releaseProject.id), true);
    const archivedBoard = await request(server, `/api/board?projectId=${releaseProject.id}`);
    assert.equal(archivedBoard.project.status, "archived");
    assert.equal(archivedBoard.sessions.length, 1);
    await request(server, `/api/projects/${releaseProject.id}/tasks`, {
      method: "POST",
      expectedStatus: 404,
      body: { text: "Should not be added", status: "next" }
    });

    const restoredProject = await request(server, `/api/projects/${releaseProject.id}`, {
      method: "PATCH",
      body: { status: "active" }
    });
    assert.equal(restoredProject.status, "active");
  } finally {
    await stopServer(server, fixture);
  }
});

test("static UI presents explicit projects first and preserves session tools", async () => {
  const [html, app, styles, hookClient, wrap, handoff, project, reopen, update, refine, review, retro, installPrompt, logoMark] = await Promise.all([
    readFile(join(root, "public", "index.html"), "utf8"),
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
    readFile(join(root, "scripts", "hook-client.mjs"), "utf8"),
    readFile(join(root, "commands", "wrap.md"), "utf8"),
    readFile(join(root, "commands", "handoff.md"), "utf8"),
    readFile(join(root, "commands", "project.md"), "utf8"),
    readFile(join(root, "commands", "reopen.md"), "utf8"),
    readFile(join(root, "commands", "update.md"), "utf8"),
    readFile(join(root, "commands", "refine.md"), "utf8"),
    readFile(join(root, "commands", "review.md"), "utf8"),
    readFile(join(root, "commands", "retro.md"), "utf8"),
    readFile(join(root, "docs", "copilot-install-prompt.md"), "utf8"),
    readFile(join(root, "public", "logo-mark.png"))
  ]);
  const commandNames = ["wrap", "handoff", "reopen", "project", "archive", "auto-wrap", "refine", "plan", "work", "sync", "review", "retro", "update"];
  const shamCommands = await Promise.all(commandNames.map((name) => readFile(join(root, "commands", `${name}.md`), "utf8")));
  assert.match(html, /<strong>Smart Human-AI Manager<\/strong>/);
  assert.match(html, /<link rel="icon" href="\/logo-mark\.png"/);
  assert.match(html, /<img src="\/logo-mark\.png" alt="">/);
  assert.deepEqual([...logoMark.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(html, /Session-powered projects/);
  assert.match(html, /Find a project or session/);
  assert.match(html, /Task, project, folder, or file/);
  assert.match(html, /data-view="board"[\s\S]*Projects/);
  assert.match(html, /Where the project stands/);
  assert.match(html, /SHAM Wrap updates this project only when the session is linked/);
  assert.match(html, /Unassigned sessions/);
  assert.match(html, /id="projectDialog"/);
  assert.match(html, /id="linkProjectWorkItemButton"/);
  assert.match(html, /id="projectWorkItems"/);
  assert.match(html, /id="autoWrapPrompt"/);
  assert.match(html, /id="autoWrapToggle"/);
  assert.match(html, /id="projectAutoWrapChoice"/);
  assert.match(html, /data-action="auto-wrap"/);
  assert.match(html, /id="projectArchiveButton"/);
  assert.match(html, /id="projectArchiveFilterButton"/);
  assert.match(app, /createStarButton\(project\.starred, "project"/);
  assert.match(app, /createStarButton\(session\.pinned, "session"/);
  assert.match(app, /^function createStarButton\(/m);
  assert.match(styles, /\.session-entry:hover \.session-star/);
  assert.match(html, /Star session/);
  assert.doesNotMatch(html, /id="projectSelect"/);
  assert.doesNotMatch(html, /Current project/);
  assert.match(html, /id="workItemForm"[\s\S]*<\/form>\s*<\/div>\s*<\/div>\s*<div id="projectDialog"/);
  assert.match(html, /id="projectOverviewPanel"/);
  assert.match(html, /id="projectSessionList"/);
  assert.match(html, /id="addProjectSessionButton"/);
  assert.match(html, /id="projectSessionDialog"/);
  assert.match(html, /id="projectSessionSelect"/);
  assert.match(html, /id="projectSessionAutoWrap"/);
  assert.match(html, /id="projectMoreButton"/);
  assert.match(html, /id="projectMoreMenu"/);
  assert.match(app, /function renderProjectWorkspace/);
  assert.match(app, /function openProjectSessionDialog/);
  assert.match(app, /function linkSelectedProjectSession/);
  assert.match(app, /\/api\/sessions\?filter=unassigned/);
  assert.match(app, /requireUnassigned: true/);
  assert.match(app, /projectSessionDialogProjectId/);
  assert.match(app, /projectSessionDialogRequest/);
  assert.match(app, /projectMetaChip\("sessions"/);
  assert.match(app, /projectMetaChip\("branch"/);
  assert.match(app, /projectMetaChip\("folder"/);
  assert.match(app, /function projectMetaChip/);
  assert.match(app, /function renderProjectWorkItems/);
  assert.match(app, /function toggleProjectStar/);
  assert.match(app, /function setAutoWrap/);
  assert.match(app, /\/api\/settings/);
  assert.match(app, /function toggleProjectArchive/);
  assert.match(app, /project-empty-tasks/);
  assert.match(app, /\/api\/projects\/\$\{encodeURIComponent\(state\.selectedProjectId\)\}\/work-items/);
  assert.match(app, /sessionHub\.projectFirstView/);
  assert.match(html, /Files involved/);
  assert.match(html, /<details id="filesSection" class="context-section files-section">/);
  assert.match(html, /Questions and actions/);
  assert.match(html, /id="boardView"/);
  assert.equal((html.match(/data-add-board-task=/g) || []).length, 5);
  assert.match(html, /Resume this session/);
  assert.match(html, /id="sessionIdChip"/);
  assert.match(html, /id="infoButton"/);
  assert.match(html, /GitHub repository/);
  assert.match(app, /\/api\/info/);
  assert.match(html, /id="providerBadge"/);
  assert.match(html, /id="updateBanner"/);
  assert.match(app, /No sessions match that search/);
  assert.match(app, /resumeCommand/);
  assert.match(app, /providerName/);
  assert.match(app, /function openBoardTaskForm/);
  assert.match(app, /body: \{ text, status \}/);
  for (const name of commandNames) assert.match(app, new RegExp(`/sham:${name}`));
  assert.match(app, /function refreshUpdateStatus/);
  assert.match(app, /elements\.filesSection\.classList\.toggle\("hidden", !files\.length\)/);
  assert.match(styles, /\.kanban-card \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow: hidden;/);
  assert.match(styles, /\.card-text \{[^}]*overflow-wrap: anywhere;/);
  assert.match(hookClient, /body\.update\?\.updateAvailable/);
  assert.match(hookClient, /Copilot users can run \/sham:update/);
  assert.match(hookClient, /api\/update\/install/);
  assert.match(hookClient, /Never run or show a separate installer command/);
  assert.match(hookClient, /updated successfully from/);
  assert.match(hookClient, /files array of \{path,toolName\}/);
  assert.match(hookClient, /completedTasks/);
  assert.match(wrap, /update\.updateAvailable/);
  assert.match(wrap, /"files"/);
  assert.match(wrap, /"completedTasks"/);
  assert.match(handoff, /What should I save in the todo list for your next session\?/);
  assert.match(handoff, /"tasks"/);
  assert.match(handoff, /"completedTasks"/);
  assert.match(handoff, /update\.updateAvailable/);
  assert.match(handoff, /"files"/);
  assert.match(project, /one primary project/);
  assert.match(project, /Never infer or create a project from the repository/);
  assert.match(project, /api\/project-suggestions/);
  assert.match(shamCommands[commandNames.indexOf("auto-wrap")], /explicit argument[\s\S]*not `on`, `off`, `status`, or `default`/);
  assert.match(reopen, /"needsReview": true/);
  assert.match(reopen, /Do not clear or replace/);
  assert.match(update, /\/api\/update\/install/);
  assert.match(update, /\/api\/update\/job/);
  assert.match(update, /must not need to run a second script/);
  assert.match(refine, /Ask for confirmation before changing task wording/);
  assert.match(review, /Do not accept work merely because code changed/);
  assert.match(retro, /Avoid generic agile advice/);
  assert.equal(shamCommands.every((command) => /^---[\s\S]+description:/m.test(command)), true);
  assert.match(installPrompt, /Install Smart Human-AI Manager/);
  assert.match(installPrompt, /do not delete or overwrite/i);
  assert.match(installPrompt, /active Copilot session is locking/i);
  assert.match(installPrompt, /api\/health/);
  assert.match(app, /File history unavailable/);
  assert.match(app, /function openSidebar/);
  assert.match(app, /function closeSidebar/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-pressed="true"/);

  const references = new Set([...app.matchAll(/elements\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
  const ids = new Set([...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...references].filter((name) => !ids.has(name)), []);
});

test("returns anti-framing headers on UI and API responses", async () => {
  const fixture = await createFixture();
  const server = await startServer(fixture);
  try {
    for (const path of ["/", "/api/health"]) {
      const response = await fetch(`${server.baseUrl}${path}`);
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'");
    }
    const logo = await fetch(`${server.baseUrl}/logo-mark.png`);
    assert.equal(logo.headers.get("content-type"), "image/png");
  } finally {
    await stopServer(server, fixture);
  }
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "session-hub-files-"));
  return {
    directory,
    dataDir: join(directory, "data"),
    historyPath: join(directory, "history.db"),
    port: nextPort++
  };
}

function createHistory(path, { sessions = [], files = [], questions = [], checkpoints = [] } = {}) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      branch TEXT,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT,
      host_type TEXT
    );
    CREATE TABLE session_files (
      session_id TEXT,
      file_path TEXT,
      tool_name TEXT,
      turn_index INTEGER,
      first_seen_at TEXT
    );
    CREATE TABLE turns (
      session_id TEXT,
      turn_index INTEGER,
      user_message TEXT,
      assistant_response TEXT
    );
    CREATE TABLE checkpoints (
      session_id TEXT,
      checkpoint_number INTEGER,
      title TEXT,
      overview TEXT,
      work_done TEXT,
      next_steps TEXT,
      created_at TEXT
    );
  `);
  const insertSession = db.prepare(`
    INSERT INTO sessions(id, cwd, repository, branch, summary, created_at, updated_at, host_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const insertFile = db.prepare(`
    INSERT INTO session_files(session_id, file_path, tool_name, turn_index, first_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertQuestion = db.prepare(`
    INSERT INTO turns(session_id, turn_index, user_message, assistant_response)
    VALUES (?, ?, ?, '')
  `);
  const insertCheckpoint = db.prepare(`
    INSERT INTO checkpoints(session_id, checkpoint_number, title, overview, work_done, next_steps, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const session of sessions) {
    insertSession.run(
      session.id,
      session.cwd ?? "",
      session.repository ?? "",
      session.branch ?? "",
      session.summary ?? "",
      session.createdAt ?? now,
      session.updatedAt ?? now
    );
  }
  for (const file of files) {
    insertFile.run(
      file.sessionId,
      file.path,
      file.toolName ?? "",
      file.turnIndex ?? null,
      file.firstSeenAt ?? now
    );
  }
  for (const question of questions) {
    insertQuestion.run(question.sessionId, question.turnIndex ?? 0, question.text);
  }
  for (const checkpoint of checkpoints) {
    insertCheckpoint.run(
      checkpoint.sessionId,
      checkpoint.checkpointNumber ?? 1,
      checkpoint.title ?? "",
      checkpoint.overview ?? "",
      checkpoint.workDone ?? "",
      checkpoint.nextSteps ?? "",
      checkpoint.createdAt ?? now
    );
  }
  db.close();
}

function createSessionsOnlyHistory(path, sessions) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      branch TEXT,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT,
      host_type TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO sessions(id, cwd, repository, branch, summary, created_at, updated_at, host_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const now = new Date().toISOString();
  for (const session of sessions) {
    insert.run(session.id, session.cwd ?? "", session.repository ?? "", session.branch ?? "", session.summary ?? "", now, now);
  }
  db.close();
}

function replaceFiles(path, files) {
  const db = new DatabaseSync(path);
  db.exec("BEGIN; DELETE FROM session_files");
  const insert = db.prepare(`
    INSERT INTO session_files(session_id, file_path, tool_name, turn_index, first_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const file of files) {
    insert.run(file.sessionId, file.path, file.toolName ?? "", file.turnIndex ?? null, file.firstSeenAt ?? now);
  }
  db.exec("COMMIT");
  db.close();
}

async function startServer(fixture) {
  const baseUrl = `http://127.0.0.1:${fixture.port}`;
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      COPILOT_SESSION_HUB_DATA: fixture.dataDir,
      COPILOT_SESSION_HUB_HISTORY_DB: fixture.historyPath,
      COPILOT_SESSION_HUB_PORT: String(fixture.port),
      COPILOT_SESSION_HUB_IMPORT_HISTORY: "0"
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(baseUrl, child, () => stderr);
    return { child, baseUrl, getStderr: () => stderr };
  } catch (error) {
    await terminateChild(child);
    await rm(fixture.directory, { recursive: true, force: true });
    throw error;
  }
}

async function stopServer(server, fixture) {
  await fetch(`${server.baseUrl}/api/shutdown`, { method: "POST" }).catch(() => {});
  if (!(await waitForExit(server.child, 1500))) await terminateChild(server.child);
  await rm(fixture.directory, { recursive: true, force: true });
}

async function request(server, path, options = {}) {
  const expectedStatus = options.expectedStatus || 200;
  const { expectedStatus: _, ...fetchOptions } = options;
  const response = await fetch(`${server.baseUrl}${path}`, {
    ...fetchOptions,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json();
  if (options.expectedStatus) {
    assert.equal(response.status, expectedStatus, `${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(result)}`);
  } else {
    assert.equal(response.ok, true, `${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

async function waitForHealth(baseUrl, child, getStderr) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test server exited with ${child.exitCode}: ${getStderr()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start at ${baseUrl}: ${getStderr()}`);
}

async function terminateChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await waitForExit(child, 2000);
}

async function waitForExit(child, milliseconds) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), milliseconds))
  ]);
}
