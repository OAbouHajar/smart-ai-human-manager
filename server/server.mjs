import http from "node:http";
import { readFile, writeFile, mkdir, access, rename, unlink } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createUpdateChecker } from "./update-checker.mjs";
import { inspectProviderHooks } from "../scripts/provider-hooks.mjs";
import { inspectScoutIntegration } from "../scripts/scout-integration.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const packageMetadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appVersion = packageMetadata.version;
const port = Number(environmentValue("CONTEXT_WORKSPACE_PORT", "COPILOT_SESSION_HUB_PORT")) || 43120;
const baseUrl = `http://127.0.0.1:${port}`;
const antiFramingHeaders = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY"
};
const dataDir = environmentValue("CONTEXT_WORKSPACE_DATA", "COPILOT_SESSION_HUB_DATA") || defaultDataDir();
const historyPath = environmentValue("CONTEXT_WORKSPACE_HISTORY_DB", "COPILOT_SESSION_HUB_HISTORY_DB") ||
  join(homedir(), ".copilot", "session-store.db");
const updateJobDir = join(dataDir, "update");
const updateJobConfigPath = join(updateJobDir, "job.json");
const updateJobStatusPath = join(updateJobDir, "status.json");
const updateJobSignalPath = join(updateJobDir, "continue");
const updateJobCancelPath = join(updateJobDir, "cancel");
await mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "sessions.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled session',
    summary TEXT NOT NULL DEFAULT '',
    initial_question TEXT NOT NULL DEFAULT '',
    questions TEXT NOT NULL DEFAULT '[]',
    last_action TEXT NOT NULL DEFAULT '',
    next_action TEXT NOT NULL DEFAULT '',
    unresolved TEXT NOT NULL DEFAULT '[]',
    decisions TEXT NOT NULL DEFAULT '[]',
    cwd TEXT NOT NULL DEFAULT '',
    repository TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'startup',
    status TEXT NOT NULL DEFAULT 'active',
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 1,
    transcript_path TEXT NOT NULL DEFAULT '',
    compacted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    starred INTEGER NOT NULL DEFAULT 0,
    repository TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    work_item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(session_id, work_item_id)
  );
  CREATE TABLE IF NOT EXISTS session_files (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    path_key TEXT NOT NULL,
    tool_name TEXT NOT NULL DEFAULT '',
    turn_index INTEGER,
    first_seen_at INTEGER,
    PRIMARY KEY(session_id, path_key)
  );
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, position);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_work_items_session ON work_items(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(path_key, session_id);
`);
ensureColumn("sessions", "imported", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "is_project", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "project_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "ai_credits", "REAL");
ensureColumn("sessions", "current_tokens", "INTEGER");
ensureColumn("sessions", "input_tokens", "INTEGER");
ensureColumn("sessions", "output_tokens", "INTEGER");
ensureColumn("sessions", "total_tokens", "INTEGER");
ensureColumn("sessions", "context_limit", "INTEGER");
ensureColumn("sessions", "model", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "context_tier", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "metrics_at", "INTEGER");
ensureColumn("sessions", "initial_question", "TEXT NOT NULL DEFAULT ''");
ensureColumn("projects", "starred", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("projects", "ticket_prefix", "TEXT NOT NULL DEFAULT ''");
ensureColumn("projects", "share_remote", "TEXT NOT NULL DEFAULT ''");
ensureColumn("projects", "share_branch", "TEXT NOT NULL DEFAULT ''");
ensureColumn("projects", "share_path", "TEXT NOT NULL DEFAULT ''");
ensureColumn("projects", "shared_at", "INTEGER");
ensureColumn("projects", "share_pushed_at", "INTEGER");
ensureColumn("projects", "share_pulled_at", "INTEGER");
ensureColumn("projects", "share_revision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("tasks", "project_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "ticket_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "description", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "owner", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "agent_owner", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "completed_by", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "completed_with", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "recommended_model", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "model_provider", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "reasoning_effort", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "model_reason", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "updated_at", "INTEGER");
ensureColumn("work_items", "project_id", "TEXT NOT NULL DEFAULT ''");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, position);
  CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_project_unique
    ON work_items(project_id, work_item_id) WHERE project_id <> '';
`);
ensureColumn("sessions", "questions", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("sessions", "files_status", "TEXT NOT NULL DEFAULT 'unavailable'");
ensureColumn("sessions", "files_synced_at", "INTEGER");
ensureColumn("sessions", "files_sync_error", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "provider", "TEXT NOT NULL DEFAULT 'copilot'");
ensureColumn("sessions", "external_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("session_files", "source", "TEXT NOT NULL DEFAULT 'history'");
ensureColumn("sessions", "checkpoint_source", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "checkpoint_trigger", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "checkpointed_at", "INTEGER");
ensureColumn("sessions", "auto_checkpointed_at", "INTEGER");
ensureColumn("sessions", "auto_checkpoint_trigger", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "provider_checkpoint_synced_at", "INTEGER");
ensureColumn("sessions", "auto_wrap_mode", "TEXT NOT NULL DEFAULT 'inherit'");
db.exec("UPDATE sessions SET external_id = id WHERE external_id = ''");
ensureColumn("tasks", "status", "TEXT NOT NULL DEFAULT 'next'");
db.exec("UPDATE tasks SET status = CASE WHEN completed = 1 THEN 'done' ELSE 'next' END WHERE status IS NULL OR status = ''");
const aicUnitVersion = db.prepare("SELECT value FROM app_metadata WHERE key = 'aic_unit_version'").get()?.value;
if (aicUnitVersion !== "2") {
  db.exec("UPDATE sessions SET ai_credits = ai_credits * 1000 WHERE ai_credits IS NOT NULL");
  db.prepare("INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('aic_unit_version', '2')").run();
}
migrateLegacyProjects();
initializeProjectTicketPrefixes();

function migrateLegacyProjects() {
  const legacySessions = db.prepare("SELECT * FROM sessions WHERE is_project = 1 AND project_id = ''").all();
  if (!legacySessions.length) return;
  const create = db.prepare(`
    INSERT INTO projects(id, title, description, status, repository, cwd, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const link = db.prepare("UPDATE sessions SET project_id = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const session of legacySessions) {
      const projectId = randomUUID();
      create.run(
        projectId,
        session.title || "Untitled project",
        session.summary || "",
        session.status === "complete" ? "complete" : "active",
        session.repository || "",
        session.cwd || "",
        session.started_at,
        session.updated_at
      );
      link.run(projectId, session.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initializeProjectTicketPrefixes() {
  const update = db.prepare("UPDATE projects SET ticket_prefix = ? WHERE id = ?");
  for (const project of db.prepare("SELECT id, title FROM projects WHERE ticket_prefix = ''").all()) {
    update.run(deriveTicketPrefix(project.title), project.id);
  }
}

function writeJsonAtomicSync(path, value) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

const updateChecker = createUpdateChecker({
  currentVersion: appVersion,
  releaseUrl: environmentValue("CONTEXT_WORKSPACE_RELEASES_URL", "COPILOT_SESSION_HUB_RELEASES_URL") ||
    "https://api.github.com/repos/OAbouHajar/smart-ai-human-manager/releases/latest",
  enabled: environmentValue("CONTEXT_WORKSPACE_UPDATE_CHECK", "COPILOT_SESSION_HUB_UPDATE_CHECK") !== "0",
  readCache: () => readUpdateCache(),
  writeCache: (status) => db.prepare(
    "INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('update_status', ?)"
  ).run(JSON.stringify(status))
});
let lastUpdateError = "";
let updateInstallScheduling = false;
const clients = new Set();
await replayPendingEvents();
const initialImport = environmentValue("CONTEXT_WORKSPACE_IMPORT_HISTORY", "COPILOT_SESSION_HUB_IMPORT_HISTORY") === "0"
  ? { imported: 0 }
  : importHistory();
if (initialImport.imported) {
  console.log(`Imported ${initialImport.imported} existing Copilot CLI sessions.`);
}

function metadataSearchMatch(row, query) {
  const matches = [
    ["title", row.title, cleanText(row.title, 180)],
    ["summary", row.summary, cleanText(row.summary, 180)],
    ["last action", row.last_action, cleanText(row.last_action, 180)],
    ["next action", row.next_action, cleanText(row.next_action, 180)],
    ["project", row.repository, basenamePath(row.repository)],
    ["folder", row.cwd, basenamePath(row.cwd)]
  ];
  const needle = query.toLocaleLowerCase();
  const match = matches.find(([, value]) => String(value || "").toLocaleLowerCase().includes(needle));
  return match ? { type: match[0], text: match[2] } : undefined;
}

function basenamePath(value) {
  return slashPath(value).split("/").filter(Boolean).at(-1) || "";
}

function readUpdateCache() {
  const value = db.prepare("SELECT value FROM app_metadata WHERE key = 'update_status'").get()?.value;
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`Could not read the cached update status: ${error.message}`);
    db.prepare("DELETE FROM app_metadata WHERE key = 'update_status'").run();
    return null;
  }
}

function scheduleUpdateCheck() {
  const before = updateChecker.cachedStatus();
  void updateChecker.check()
    .then((status) => {
      reportUpdateError(status);
      if (
        status.updateAvailable !== before.updateAvailable ||
        status.latestVersion !== before.latestVersion
      ) {
        broadcast("update-changed", status);
      }
    })
    .catch((error) => {
      console.error(`Unexpected update check failure: ${error.message}`);
    });
}

function reportUpdateError(status) {
  if (!status.error) {
    lastUpdateError = "";
    return;
  }
  if (status.error !== lastUpdateError) {
    console.error(status.error);
    lastUpdateError = status.error;
  }
}

async function scheduleUpdateInstall(data, response) {
  if (updateInstallScheduling) {
    return json(response, 409, { error: "An update is already being prepared." });
  }
  updateInstallScheduling = true;
  try {
    return await prepareUpdateInstall(data, response);
  } finally {
    updateInstallScheduling = false;
  }
}

async function prepareUpdateInstall(data, response) {
  const existingJob = readUpdateJob();
  if (["preparing", "waiting_for_exit", "installing"].includes(existingJob.state)) {
    return json(response, 409, { error: "An update is already in progress.", job: existingJob });
  }

  const sessionId = cleanText(data.sessionId, 300);
  const session = sessionId
    ? db.prepare("SELECT id, status, ended_at FROM sessions WHERE id = ?").get(sessionId)
    : null;
  if (!session || session.status !== "active" || session.ended_at) {
    return json(response, 400, { error: "An active tracked session is required to schedule the update." });
  }

  const update = await updateChecker.check({ force: true });
  reportUpdateError(update);
  if (!update.enabled) return json(response, 409, { error: "Automatic update checks are disabled." });
  if (update.error) return json(response, 502, { error: update.error });
  if (!update.updateAvailable) {
    return json(response, 409, { error: `Context Workspace ${appVersion} is already up to date.` });
  }
  if (!/^\d+\.\d+\.\d+$/.test(update.latestVersion || "")) {
    return json(response, 502, { error: "The release version is invalid." });
  }

  await mkdir(updateJobDir, { recursive: true });
  await unlink(updateJobSignalPath).catch(() => {});
  await unlink(updateJobCancelPath).catch(() => {});
  const createdAt = Date.now();
  const job = {
    id: randomUUID(),
    state: "preparing",
    fromVersion: appVersion,
    toVersion: update.latestVersion,
    releaseUrl: update.releaseUrl,
    sessionId,
    createdAt,
    updatedAt: createdAt,
    deadline: createdAt + 4 * 60 * 60 * 1000
  };
  const config = {
    ...job,
    dataDir,
    statusPath: updateJobStatusPath,
    signalPath: updateJobSignalPath,
    cancelPath: updateJobCancelPath,
    stagingPath: join(updateJobDir, `v${update.latestVersion}`),
    logPath: join(updateJobDir, "update.log"),
    dashboardUrl: baseUrl
  };
  await writeJsonAtomic(updateJobConfigPath, config);
  await writeJsonAtomic(updateJobStatusPath, job);
  const currentSession = db.prepare("SELECT status, ended_at FROM sessions WHERE id = ?").get(sessionId);
  if (currentSession?.status !== "active" || currentSession?.ended_at) {
    await writeFile(updateJobSignalPath, `${Date.now()}\n`, "utf8");
  }

  const runner = environmentValue("CONTEXT_WORKSPACE_UPDATE_RUNNER", "COPILOT_SESSION_HUB_UPDATE_RUNNER") ||
    join(root, "scripts", "update-runner.mjs");
  launchUpdateRunner(runner);
  json(response, 202, { ok: true, job });
}

async function cancelUpdateInstall(response) {
  const job = readUpdateJob();
  if (!["preparing", "waiting_for_exit"].includes(job.state)) {
    return json(response, 409, { error: "There is no cancellable update." });
  }
  await writeFile(updateJobCancelPath, `${Date.now()}\n`, "utf8");
  json(response, 202, { ok: true, state: "cancelling" });
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function launchUpdateRunner(runner = environmentValue("CONTEXT_WORKSPACE_UPDATE_RUNNER", "COPILOT_SESSION_HUB_UPDATE_RUNNER") ||
  join(root, "scripts", "update-runner.mjs")) {
  const child = spawn(process.execPath, [runner, updateJobConfigPath], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.on("error", (error) => {
    console.error(`Could not launch the update runner: ${error.message}`);
    const job = readUpdateJob();
    try {
      writeJsonAtomicSync(updateJobStatusPath, {
        ...job,
        state: "failed",
        error: "The background updater could not start.",
        completedAt: Date.now(),
        updatedAt: Date.now()
      });
    } catch (writeError) {
      console.error(`Could not record the update failure: ${writeError.message}`);
    }
  });
  child.unref();
}

function resumePendingUpdate() {
  const job = readUpdateJob();
  if (
    !["preparing", "waiting_for_exit", "installing"].includes(job.state) ||
    (job.runnerPid && processIsRunning(job.runnerPid)) ||
    !existsSync(updateJobConfigPath)
  ) return;
  launchUpdateRunner();
}

function processIsRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readUpdateJob() {
  try {
    const value = JSON.parse(readFileSync(updateJobStatusPath, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function signalUpdateInstall(sessionId) {
  const job = readUpdateJob();
  if (
    job.sessionId !== sessionId ||
    !["preparing", "waiting_for_exit"].includes(job.state)
  ) return;
  void writeFile(updateJobSignalPath, `${Date.now()}\n`, "utf8").catch((error) => {
    console.error(`Could not continue the scheduled update: ${error.message}`);
  });
}

function takeUpdateCompletionNotice() {
  const job = readUpdateJob();
  if (!["succeeded", "succeeded_with_warnings", "failed"].includes(job.state) || job.notifiedAt) return null;
  const notice = {
    state: job.state,
    fromVersion: job.fromVersion,
    toVersion: job.toVersion,
    error: job.error || job.warning || ""
  };
  try {
    writeJsonAtomicSync(updateJobStatusPath, {
      ...job,
      notifiedAt: Date.now()
    });
  } catch (error) {
    console.error(`Could not acknowledge the update result: ${error.message}`);
  }
  return notice;
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedRequest(request)) return json(response, 403, { error: "Request origin is not allowed" });
    const url = new URL(request.url, baseUrl);
    if (url.pathname === "/api/health") return json(response, 200, { ok: true, version: appVersion });
    if (url.pathname === "/api/info" && request.method === "GET") return getApplicationInfo(response);
    if (url.pathname === "/api/settings" && request.method === "GET") return getSettings(response);
    if (url.pathname === "/api/settings" && request.method === "PATCH") return updateSettings(await body(request), response);
    if (url.pathname === "/api/update" && request.method === "GET") {
      if (url.searchParams.get("refresh") === "1") {
        const status = await updateChecker.check({ force: true });
        reportUpdateError(status);
        return json(response, 200, status);
      }
      const status = updateChecker.cachedStatus();
      json(response, 200, status);
      scheduleUpdateCheck();
      return;
    }
    if (url.pathname === "/api/update/job" && request.method === "GET") {
      return json(response, 200, readUpdateJob());
    }
    if (url.pathname === "/api/update/install" && request.method === "POST") {
      return await scheduleUpdateInstall(await body(request), response);
    }
    if (url.pathname === "/api/update/cancel" && request.method === "POST") {
      return await cancelUpdateInstall(response);
    }
    if (url.pathname === "/api/events" && request.method === "GET") return openEventStream(request, response);
    if (url.pathname === "/api/sessions" && request.method === "GET") return listSessions(url, response);
    if (url.pathname === "/api/stats" && request.method === "GET") return getStats(response);
    if (url.pathname === "/api/board" && request.method === "GET") return getBoard(url, response);
    if (url.pathname === "/api/projects" && request.method === "GET") return getProjects(url, response);
    if (url.pathname === "/api/projects" && request.method === "POST") return createProject(await body(request), response);
    if (url.pathname === "/api/shared-projects/import" && request.method === "POST") {
      return importSharedProject(await body(request), response);
    }
    if (url.pathname === "/api/project-suggestions" && request.method === "GET") return getProjectSuggestions(url, response);
    if (url.pathname === "/api/import-history" && request.method === "POST") {
      const result = importHistory();
      if (result.imported || result.fileSessions) broadcast("sessions-changed", { eventName: "history-imported" });
      return json(response, 200, result);
    }
    if (url.pathname.startsWith("/api/hooks/") && request.method === "POST") {
      const hookPath = url.pathname.slice("/api/hooks/".length).split("/");
      const provider = hookPath.length > 1 ? hookPath[0] : "copilot";
      const eventName = hookPath.length > 1 ? hookPath[1] : hookPath[0];
      return handleHook(provider, eventName, await body(request), response);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const action = match[2];
      if (!action && request.method === "GET") return getSession(id, response);
      if (!action && request.method === "PATCH") return updateSession(id, await body(request), response);
      if (action === "checkpoint" && request.method === "POST") return checkpoint(id, await body(request), response);
      if (action === "tasks" && request.method === "POST") return addTask(id, await body(request), response);
      if (action === "work-items" && request.method === "POST") return addWorkItem(id, await body(request), response);
      if (action === "resume" && request.method === "POST") return resumeSession(id, response);
      if (action === "folder" && request.method === "POST") return openFolder(id, response);
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(sessions|tasks|work-items|share)(?:\/([^/]+))?)?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const action = projectMatch[2];
      const targetId = projectMatch[3] ? decodeURIComponent(projectMatch[3]) : "";
      if (!action && request.method === "PATCH") return updateProject(projectId, await body(request), response);
      if (action === "sessions" && !targetId && request.method === "POST") {
        return linkProjectSession(projectId, await body(request), response);
      }
      if (action === "sessions" && targetId && request.method === "DELETE") {
        return unlinkProjectSession(projectId, targetId, response);
      }
      if (action === "tasks" && request.method === "POST") return addProjectTask(projectId, await body(request), response);
      if (action === "work-items" && request.method === "POST") {
        return addProjectWorkItem(projectId, await body(request), response);
      }
      if (action === "share" && request.method === "GET") return exportSharedProject(projectId, response);
      if (action === "share" && request.method === "PATCH") {
        return updateProjectShare(projectId, await body(request), response);
      }
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && request.method === "PATCH") return updateTask(Number(taskMatch[1]), await body(request), response);
    if (taskMatch && request.method === "DELETE") return deleteTask(Number(taskMatch[1]), response);
    const workItemMatch = url.pathname.match(/^\/api\/work-items\/(\d+)$/);
    if (workItemMatch && request.method === "DELETE") return deleteWorkItem(Number(workItemMatch[1]), response);

    if (url.pathname === "/api/shutdown" && request.method === "POST") {
      json(response, 200, { ok: true });
      setTimeout(() => server.close(() => process.exit(0)), 50);
      return;
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    json(response, error.statusCode || 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Context Workspace: ${baseUrl}`);
  resumePendingUpdate();
});

function listSessions(url, response) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
  const filter = url.searchParams.get("filter") || "open";
  const where = [];
  const params = {};
  if (!query) {
    if (filter === "open") where.push("archived = 0");
    if (filter === "wrapped") where.push("needs_review = 0 AND archived = 0");
    if (filter === "active") where.push("status = 'active' AND archived = 0");
    if (filter === "paused") where.push("status = 'paused' AND archived = 0");
    if (filter === "unassigned") where.push("project_id = '' AND archived = 0");
    if (filter === "archived") where.push("archived = 1");
  }
  if (query) {
    where.push(`(
      instr(lower(title), lower(:query)) > 0
      OR instr(lower(summary), lower(:query)) > 0
      OR instr(lower(cwd), lower(:query)) > 0
      OR instr(lower(repository), lower(:query)) > 0
      OR instr(lower(last_action), lower(:query)) > 0
      OR instr(lower(next_action), lower(:query)) > 0
      OR EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.session_id = sessions.id AND t.project_id = '' AND instr(lower(t.text), lower(:query)) > 0
      )
      OR EXISTS (
        SELECT 1 FROM session_files sf
        WHERE sf.session_id = sessions.id AND instr(lower(sf.file_path), lower(:query)) > 0
      )
    )`);
    params.query = query;
  }
  const matchSelect = query
    ? `, (SELECT sf.file_path FROM session_files sf WHERE sf.session_id = sessions.id AND instr(lower(sf.file_path), lower(:query)) > 0 ORDER BY sf.file_path LIMIT 1) AS matched_file_path
       , (SELECT t.text FROM tasks t WHERE t.session_id = sessions.id AND t.project_id = '' AND instr(lower(t.text), lower(:query)) > 0 ORDER BY t.position, t.id LIMIT 1) AS matched_task_text`
    : "";
  const sql = `SELECT sessions.*${matchSelect} FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY pinned DESC, CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`;
  const rows = db.prepare(sql).all(params).map((row) => {
    const session = sessionRecord(row);
    if (row.matched_file_path) {
      session.searchMatch = {
        type: "file",
        text: displayFilePath(row.matched_file_path, row.repository || row.cwd).path
      };
    } else if (row.matched_task_text) {
      session.searchMatch = { type: "task", text: cleanText(row.matched_task_text, 180) };
    } else {
      session.searchMatch = metadataSearchMatch(row, query);
    }
    return session;
  });
  json(response, 200, rows);
}

function getSession(id, response) {
  let row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  if ((row.provider || "copilot") === "copilot") {
    syncSessionFiles(id);
    row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  }
  const session = sessionRecord(row);
  session.tasks = db.prepare(`
    SELECT * FROM tasks WHERE session_id = ? AND project_id = '' ORDER BY position, id
  `).all(id).map(taskRecord);
  session.workItems = db.prepare(`
    SELECT * FROM work_items WHERE session_id = ? AND project_id = '' ORDER BY created_at, id
  `).all(id).map(workItemRecord);
  session.events = db.prepare("SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT 40").all(id);
  const project = row.project_id ? db.prepare("SELECT * FROM projects WHERE id = ?").get(row.project_id) : null;
  session.project = project ? projectRecord(project) : null;
  Object.assign(session, fileHistoryRecord(row));
  json(response, 200, session);
}

function getStats(response) {
  const result = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN needs_review = 0 AND archived = 0 THEN 1 ELSE 0 END) AS wrapped,
      SUM(CASE WHEN status = 'active' AND archived = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'paused' AND archived = 0 THEN 1 ELSE 0 END) AS paused,
      SUM(CASE WHEN needs_review = 1 AND archived = 0 THEN 1 ELSE 0 END) AS needsReview,
      SUM(CASE WHEN project_id = '' AND archived = 0 THEN 1 ELSE 0 END) AS unassigned,
      SUM(CASE WHEN pinned = 1 AND archived = 0 THEN 1 ELSE 0 END) AS pinned
    FROM sessions
  `).get();
  json(response, 200, result);
}

async function getApplicationInfo(response) {
  const copilotExecutable = resolveExecutable("copilot");
  const providers = [{
    id: "copilot",
    name: "GitHub Copilot CLI",
    detected: Boolean(copilotExecutable),
    configured: copilotPluginConfigured(copilotExecutable)
  }];
  for (const provider of ["claude", "codex", "gemini"]) {
    try {
      const status = await inspectProviderHooks(provider);
      providers.push({
        id: provider,
        name: providerConfig(provider).name,
        detected: status.detected,
        configured: status.configured
      });
    } catch {
      providers.push({
        id: provider,
        name: providerConfig(provider).name,
        detected: Boolean(resolveExecutable(provider)),
        configured: false
      });
    }
  }
  const scout = await inspectScoutIntegration();
  providers.push({
    id: "scout",
    name: "Microsoft Scout",
    detected: scout.detected,
    configured: scout.configured
  });
  json(response, 200, {
    version: appVersion,
    platform: platform(),
    providers,
    repositoryUrl: "https://github.com/OAbouHajar/smart-ai-human-manager",
    releasesUrl: "https://github.com/OAbouHajar/smart-ai-human-manager/releases"
  });
}

function getBoard(url, response) {
  const projectId = url.searchParams.get("projectId") || url.searchParams.get("sessionId");
  if (!projectId) return json(response, 200, { tasks: [], counts: emptyBoardCounts(), total: 0, project: null, workItems: [] });
  let projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!projectRow) {
    const legacySession = db.prepare("SELECT project_id FROM sessions WHERE id = ?").get(projectId);
    if (legacySession?.project_id) {
      projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(legacySession.project_id);
    }
  }
  if (!projectRow) return json(response, 404, { error: "Project workspace not found" });
  ensureProjectTicketIds(projectRow.id);
  const sessionRows = projectSessionRows(projectRow.id);
  const sessionIds = sessionRows.map((session) => session.id);
  const placeholders = sessionIds.map(() => "?").join(", ");
  const tasks = db.prepare(`
      SELECT t.*, s.title AS session_title, s.repository, s.cwd, s.branch, s.provider,
        s.updated_at AS session_updated_at
      FROM tasks t
      JOIN sessions s ON s.id = t.session_id
      WHERE t.project_id = ?
        ${sessionIds.length ? `OR (t.project_id = '' AND s.archived = 0 AND s.id IN (${placeholders}))` : ""}
      ORDER BY
        CASE t.status
          WHEN 'in_progress' THEN 0
          WHEN 'blocked' THEN 1
          WHEN 'next' THEN 2
          WHEN 'backlog' THEN 3
          WHEN 'done' THEN 4
          ELSE 5
        END,
        s.pinned DESC,
        s.updated_at DESC,
        t.position,
        t.id
    `).all(projectRow.id, ...sessionIds).map((row) => ({
      ...taskRecord(row),
      sessionTitle: row.session_title,
      repository: row.repository,
      cwd: row.cwd,
      branch: row.branch,
      sessionUpdatedAt: row.session_updated_at
    }));
  const counts = Object.fromEntries(["backlog", "next", "in_progress", "blocked", "done"].map((status) => [
    status,
    tasks.filter((task) => task.status === status).length
  ]));
  const workItems = db.prepare(`
    SELECT * FROM work_items
    WHERE project_id = ?
      ${sessionIds.length ? `OR (project_id = '' AND session_id IN (${placeholders}))` : ""}
    ORDER BY created_at, id
  `).all(projectRow.id, ...sessionIds).map(workItemRecord);
  const projectStateRow = sessionRows.find((session) => session.summary || session.last_action || session.next_action) ||
    db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ? AND source = 'shared-project'
        AND (summary <> '' OR last_action <> '' OR next_action <> '')
      ORDER BY updated_at DESC LIMIT 1
    `).get(projectRow.id) ||
    null;
  json(response, 200, {
    tasks,
    counts,
    total: tasks.length,
    project: projectRecord(projectRow),
    projectState: projectStateRow ? sessionRecord(projectStateRow) : null,
    sessions: sessionRows.map((row) => ({ ...sessionRecord(row), ...fileHistoryRecord(row) })),
    workItems
  });
}

function getProjects(url, response) {
  const filter = url.searchParams.get("filter") || "active";
  if (!["active", "shared", "archived", "all"].includes(filter)) {
    return json(response, 400, { error: "Invalid project filter" });
  }
  const statusWhere = filter === "archived"
    ? "p.status = 'archived'"
    : filter === "shared"
      ? "p.status <> 'archived' AND p.share_branch <> ''"
    : filter === "all"
      ? "1 = 1"
      : "p.status <> 'archived'";
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id AND s.archived = 0) AS session_count,
      (SELECT COUNT(*) FROM tasks t JOIN sessions s ON s.id = t.session_id
        WHERE (t.project_id = p.id OR (t.project_id = '' AND s.project_id = p.id AND s.archived = 0))
          AND t.status <> 'done') AS open_task_count,
      (SELECT COUNT(*) FROM work_items w LEFT JOIN sessions s ON s.id = w.session_id
        WHERE w.project_id = p.id OR (w.project_id = '' AND s.project_id = p.id AND s.archived = 0)) AS work_item_count,
      COALESCE((SELECT MAX(s.updated_at) FROM sessions s WHERE s.project_id = p.id AND s.archived = 0), p.updated_at) AS activity_at
    FROM projects p
    WHERE ${statusWhere}
    ORDER BY p.starred DESC, CASE p.status WHEN 'active' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END, activity_at DESC
  `).all().map((row) => ({
    ...projectRecord(row),
    updatedAt: row.activity_at,
    sessionCount: row.session_count,
    openTaskCount: row.open_task_count,
    workItemCount: row.work_item_count
  }));
  json(response, 200, rows);
}

function exportSharedProject(projectId, response) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return json(response, 404, { error: "Project not found" });
  ensureProjectTicketIds(projectId);
  const sessions = projectSessionRows(projectId);
  const sessionIds = sessions.map((session) => session.id);
  const placeholders = sessionIds.map(() => "?").join(", ");
  const tickets = db.prepare(`
    SELECT t.*
    FROM tasks t
    LEFT JOIN sessions s ON s.id = t.session_id
    WHERE t.project_id = ?
      ${sessionIds.length ? `OR (t.project_id = '' AND s.id IN (${placeholders}))` : ""}
    ORDER BY t.position, t.id
  `).all(projectId, ...sessionIds).map((task) => ({
    ticketId: task.ticket_id,
    title: cleanText(task.text, 500),
    description: cleanText(task.description, 1000),
    status: normalizeTaskStatus(task.status),
    owner: cleanText(task.owner, 120),
    agent: cleanText(task.agent_owner, 120),
    completedBy: cleanText(task.completed_by, 120),
    completedWith: cleanText(task.completed_with, 120),
    recommendedModel: cleanText(task.recommended_model, 120),
    modelProvider: cleanText(task.model_provider, 120),
    reasoningEffort: cleanText(task.reasoning_effort, 40),
    modelReason: cleanText(task.model_reason, 500),
    updatedAt: task.updated_at || task.created_at
  }));
  const latest = sessions[0];
  const context = latest ? {
    summary: cleanText(latest.summary, 1500),
    completedWork: cleanText(latest.last_action, 1000),
    nextAction: cleanText(latest.next_action, 1000),
    blockers: cleanArray(parseArray(latest.unresolved), 10, 300),
    starterPrompt: buildSharedStarterPrompt(project, latest, tickets)
  } : {
    summary: "",
    completedWork: "",
    nextAction: "",
    blockers: [],
    starterPrompt: buildSharedStarterPrompt(project, null, tickets)
  };
  json(response, 200, {
    schemaVersion: 1,
    revision: project.updated_at,
    project: {
      id: project.id,
      title: cleanText(project.title, 120),
      description: cleanText(project.description, 1000),
      status: project.status === "complete" ? "complete" : "active",
      ticketPrefix: project.ticket_prefix || deriveTicketPrefix(project.title)
    },
    tickets,
    context
  });
}

function buildSharedStarterPrompt(project, latest, tickets) {
  const nextTicket = tickets.find((ticket) => ["in_progress", "next"].includes(ticket.status));
  const nextAction = cleanText(latest?.next_action, 600) || nextTicket?.title || "";
  const summary = cleanText(latest?.summary, 600) || cleanText(project.description, 600);
  return cleanText([
    `Continue the Context Workspace project "${project.title}".`,
    summary ? `Current context: ${summary}` : "",
    nextAction ? `Recommended next action: ${nextAction}` : "",
    "Use the local repository as the source of truth and validate the completed outcome."
  ].filter(Boolean).join("\n\n"), 1800);
}

function updateProjectShare(projectId, data, response) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return json(response, 404, { error: "Project not found" });
  const remote = cleanText(data.remote, 80);
  const branch = cleanText(data.branch, 240);
  const path = cleanText(data.path, 500);
  if (!remote || !/^[A-Za-z0-9._-]+$/.test(remote)) {
    return json(response, 400, { error: "A valid Git remote name is required" });
  }
  if (
    !branch || branch.startsWith("-") || branch.includes("..") || branch.includes("\\") ||
    /[\s~^:?*\[]/.test(branch)
  ) {
    return json(response, 400, { error: "A valid Git branch name is required" });
  }
  if (!path || isAbsolute(path) || normalize(path).startsWith("..")) {
    return json(response, 400, { error: "A repository-relative share path is required" });
  }
  const now = Date.now();
  const pushedAt = Number(data.pushedAt) || project.share_pushed_at || null;
  const pulledAt = Number(data.pulledAt) || project.share_pulled_at || null;
  const revision = Math.max(Number(data.revision) || 0, Number(project.share_revision) || 0);
  db.prepare(`
    UPDATE projects SET
      share_remote = ?, share_branch = ?, share_path = ?,
      shared_at = COALESCE(shared_at, ?), share_pushed_at = ?, share_pulled_at = ?,
      share_revision = ?
    WHERE id = ?
  `).run(remote, branch, path, now, pushedAt, pulledAt, revision, projectId);
  broadcast("sessions-changed", { id: projectId, eventName: "project-sharing-updated" });
  json(response, 200, projectRecord(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId)));
}

function importSharedProject(data, response) {
  const snapshot = data?.snapshot;
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.project || !Array.isArray(snapshot.tickets)) {
    return json(response, 400, { error: "Invalid shared project document" });
  }
  if (snapshot.tickets.length > 2000) {
    return json(response, 400, { error: "Shared project contains too many tickets" });
  }
  const projectId = cleanText(snapshot.project.id, 100);
  const title = cleanText(snapshot.project.title, 120);
  if (!/^[A-Za-z0-9._-]+$/.test(projectId) || projectId.includes("..") || !title) {
    return json(response, 400, { error: "Shared project ID and title are required" });
  }
  const remote = cleanText(data.remote || "origin", 80);
  const branch = cleanText(data.branch || "context-workspace/shared-projects", 240);
  const path = cleanText(data.path || `projects/${projectId}/project.json`, 500);
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) {
    return json(response, 400, { error: "Invalid shared project remote" });
  }
  if (
    !branch || branch.startsWith("-") || branch.includes("..") || branch.includes("\\") ||
    /[\s~^:?*\[]/.test(branch)
  ) {
    return json(response, 400, { error: "Invalid shared project branch" });
  }
  if (!path || isAbsolute(path) || normalize(path).startsWith("..")) {
    return json(response, 400, { error: "Invalid shared project path" });
  }
  const revision = Number(snapshot.revision) || 0;
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (existing && revision && revision < Number(existing.share_revision || 0)) {
    return json(response, 409, { error: "Shared project document is older than the local copy" });
  }
  if (existing && revision && revision === Number(existing.share_revision || 0)) {
    const now = Date.now();
    db.prepare(`
      UPDATE projects SET
        share_remote = ?, share_branch = ?, share_path = ?,
        shared_at = COALESCE(shared_at, ?), share_pulled_at = ?
      WHERE id = ?
    `).run(remote, branch, path, now, now, projectId);
    return json(response, 200, {
      ok: true,
      unchanged: true,
      project: projectRecord(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId))
    });
  }
  const lastSyncAt = existing
    ? Math.max(Number(existing.share_pushed_at) || 0, Number(existing.share_pulled_at) || 0)
    : 0;
  if (
    existing && lastSyncAt && existing.updated_at > lastSyncAt &&
    revision > Number(existing.share_revision || 0)
  ) {
    return json(response, 409, {
      error: "Local project changes must be pushed or reconciled before pulling newer shared work",
      code: "SHARED_PROJECT_LOCAL_CHANGES"
    });
  }
  const now = Date.now();
  const prefix = normalizeTicketPrefix(snapshot.project.ticketPrefix) || deriveTicketPrefix(title);
  const description = cleanText(snapshot.project.description, 1000);
  const status = snapshot.project.status === "complete" ? "complete" : "active";
  const sharedContext = snapshot.context && typeof snapshot.context === "object" ? {
    summary: cleanText(snapshot.context.summary, 1500),
    completedWork: cleanText(snapshot.context.completedWork, 1000),
    nextAction: cleanText(snapshot.context.nextAction, 1000),
    blockers: cleanArray(snapshot.context.blockers, 10, 300),
    starterPrompt: cleanText(snapshot.context.starterPrompt, 1800)
  } : null;
  const syntheticSessionId = `shared-project:${projectId}`;
  db.exec("BEGIN");
  try {
    if (existing) {
      db.prepare(`
        UPDATE projects SET
          title = ?, description = ?, status = ?, ticket_prefix = ?,
          share_remote = ?, share_branch = ?, share_path = ?,
          shared_at = COALESCE(shared_at, ?), share_pulled_at = ?, share_revision = ?,
          updated_at = MAX(updated_at, ?)
        WHERE id = ?
      `).run(
        title, description, status, prefix, remote, branch, path,
        now, now, revision, revision || now, projectId
      );
    } else {
      db.prepare(`
        INSERT INTO projects(
          id, title, description, status, ticket_prefix, repository, cwd,
          created_at, updated_at, share_remote, share_branch, share_path,
          shared_at, share_pulled_at, share_revision
        ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId, title, description, status, prefix, now, revision || now,
        remote, branch, path, now, now, revision
      );
    }
    const synthetic = db.prepare("SELECT id FROM sessions WHERE id = ?").get(syntheticSessionId);
    if (!synthetic) {
      db.prepare(`
        INSERT INTO sessions(
          id, external_id, provider, title, summary, source, status,
          started_at, updated_at, ended_at, needs_review, project_id
        ) VALUES (?, ?, 'shared', ?, ?, 'shared-project', 'paused', ?, ?, ?, 0, ?)
      `).run(
        syntheticSessionId, syntheticSessionId, `Shared board · ${title}`,
        "Imported shared project state.", now, now, now, projectId
      );
    }
    if (sharedContext) {
      db.prepare(`
        UPDATE sessions SET summary = ?, last_action = ?, next_action = ?, unresolved = ?, initial_question = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sharedContext.summary,
        sharedContext.completedWork,
        sharedContext.nextAction,
        JSON.stringify(sharedContext.blockers),
        sharedContext.starterPrompt,
        revision || now,
        syntheticSessionId
      );
    }
    const selectTask = db.prepare("SELECT * FROM tasks WHERE project_id = ? AND ticket_id = ? ORDER BY id LIMIT 1");
    const insertTask = db.prepare(`
      INSERT INTO tasks(
        session_id, project_id, ticket_id, text, description, owner, agent_owner,
        completed_by, completed_with, recommended_model, model_provider, reasoning_effort,
        model_reason, completed, position, created_at, updated_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateTaskStatement = db.prepare(`
      UPDATE tasks SET text = ?, description = ?, owner = ?, agent_owner = ?,
        completed_by = ?, completed_with = ?, recommended_model = ?, model_provider = ?,
        reasoning_effort = ?, model_reason = ?, completed = ?, position = ?, updated_at = ?, status = ?
      WHERE id = ?
    `);
    const sharedTicketIds = [];
    snapshot.tickets.forEach((ticket, position) => {
      const ticketId = cleanText(ticket.ticketId, 40);
      const ticketTitle = cleanText(ticket.title, 500);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(ticketId) || !ticketTitle) return;
      sharedTicketIds.push(ticketId);
      const ticketDescription = cleanText(ticket.description, 1000);
      const owner = cleanText(ticket.owner, 120);
      const agent = cleanText(ticket.agent, 120);
      const completedBy = cleanText(ticket.completedBy, 120);
      const completedWith = cleanText(ticket.completedWith, 120);
      const recommendedModel = cleanText(ticket.recommendedModel, 120);
      const modelProvider = cleanText(ticket.modelProvider, 120);
      const reasoningEffort = cleanText(ticket.reasoningEffort, 40);
      const modelReason = cleanText(ticket.modelReason, 500);
      const ticketStatus = normalizeTaskStatus(ticket.status);
      const updatedAt = Number(ticket.updatedAt) || revision || now;
      const row = selectTask.get(projectId, ticketId);
      if (row) {
        updateTaskStatement.run(
          ticketTitle, ticketDescription, owner, agent, completedBy, completedWith,
          recommendedModel, modelProvider, reasoningEffort, modelReason,
          ticketStatus === "done" ? 1 : 0, position, updatedAt, ticketStatus, row.id
        );
      } else {
        insertTask.run(
          syntheticSessionId, projectId, ticketId, ticketTitle, ticketDescription, owner,
          agent, completedBy, completedWith, recommendedModel, modelProvider,
          reasoningEffort, modelReason, ticketStatus === "done" ? 1 : 0,
          position, updatedAt, updatedAt, ticketStatus
        );
      }
    });
    if (sharedTicketIds.length) {
      const placeholders = sharedTicketIds.map(() => "?").join(", ");
      db.prepare(`
        DELETE FROM tasks
        WHERE project_id = ? AND ticket_id NOT IN (${placeholders})
      `).run(projectId, ...sharedTicketIds);
    } else {
      db.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcast("sessions-changed", { id: projectId, eventName: "shared-project-imported" });
  json(response, existing ? 200 : 201, {
    ok: true,
    project: projectRecord(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId))
  });
}

function createProject(data, response) {
  const title = cleanText(data.title, 120);
  if (!title) return json(response, 400, { error: "Project title is required" });
  if (data.autoWrap !== undefined && typeof data.autoWrap !== "boolean") {
    return json(response, 400, { error: "autoWrap must be true or false" });
  }
  const sessionId = cleanText(data.sessionId, 300);
  const session = sessionId ? db.prepare("SELECT * FROM sessions WHERE id = ? AND archived = 0").get(sessionId) : null;
  if (sessionId && !session) return json(response, 404, { error: "Session not found" });
  const now = Date.now();
  const id = randomUUID();
  const project = {
    id,
    title,
    description: cleanText(data.description, 1000),
    status: "active",
    ticket_prefix: deriveTicketPrefix(title),
    repository: session?.repository || "",
    cwd: session?.cwd || "",
    created_at: now,
    updated_at: now
  };
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO projects(id, title, description, status, ticket_prefix, repository, cwd, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.title, project.description, project.status, project.ticket_prefix,
      project.repository, project.cwd, now, now
    );
    if (session) {
      const autoWrapMode = typeof data.autoWrap === "boolean" ? (data.autoWrap ? "on" : "off") : session.auto_wrap_mode;
      db.prepare("UPDATE sessions SET project_id = ?, auto_wrap_mode = ? WHERE id = ?").run(id, autoWrapMode, session.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcast("sessions-changed", { id: sessionId || id, eventName: "project-created" });
  json(response, 201, projectRecord(project));
}

function updateProject(id, data, response) {
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return json(response, 404, { error: "Project not found" });
  const updates = [];
  const values = [];
  if (data.title !== undefined) {
    const title = cleanText(data.title, 120);
    if (!title) return json(response, 400, { error: "Project title is required" });
    updates.push("title = ?");
    values.push(title);
  }
  if (data.description !== undefined) {
    updates.push("description = ?");
    values.push(cleanText(data.description, 1000));
  }
  if (data.ticketPrefix !== undefined) {
    const prefix = normalizeTicketPrefix(data.ticketPrefix);
    if (!prefix) return json(response, 400, { error: "Ticket prefix must contain 2 to 8 letters or numbers" });
    updates.push("ticket_prefix = ?");
    values.push(prefix);
  }
  if (data.status !== undefined) {
    const status = ["active", "complete", "archived"].includes(data.status) ? data.status : "";
    if (!status) return json(response, 400, { error: "Invalid project status" });
    if (status === "archived" && existing.status !== "archived" && !data.confirmArchive) {
      const openTasks = db.prepare(`
        SELECT COUNT(*) AS count
        FROM tasks t
        LEFT JOIN sessions s ON s.id = t.session_id
        WHERE (t.project_id = ? OR (t.project_id = '' AND s.project_id = ? AND s.archived = 0))
          AND t.status <> 'done'
      `).get(id, id).count;
      if (openTasks) {
        return json(response, 409, {
          error: "Project has unfinished tasks",
          code: "PROJECT_HAS_UNFINISHED_TASKS",
          openTaskCount: openTasks
        });
      }
    }
    updates.push("status = ?");
    values.push(status);
  }
  if (data.starred !== undefined) {
    updates.push("starred = ?");
    values.push(data.starred ? 1 : 0);
  }
  if (!updates.length) return json(response, 400, { error: "No project changes supplied" });
  updates.push("updated_at = ?");
  values.push(Date.now(), id);
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  broadcast("sessions-changed", { id, eventName: "project-updated" });
  json(response, 200, projectRecord(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)));
}

function linkProjectSession(projectId, data, response) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND status <> 'archived'").get(projectId);
  if (!project) return json(response, 404, { error: "Project not found" });
  const sessionId = cleanText(data.sessionId, 300);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND archived = 0").get(sessionId);
  if (!session) return json(response, 404, { error: "Session not found" });
  if (data.autoWrap !== undefined && typeof data.autoWrap !== "boolean") {
    return json(response, 400, { error: "autoWrap must be true or false" });
  }
  if (data.requireUnassigned !== undefined && typeof data.requireUnassigned !== "boolean") {
    return json(response, 400, { error: "requireUnassigned must be true or false" });
  }
  if (data.requireUnassigned && session.project_id) {
    return json(response, 409, { error: "Session is no longer unassigned" });
  }
  const now = Date.now();
  db.exec("BEGIN");
  try {
    const autoWrapMode = typeof data.autoWrap === "boolean" ? (data.autoWrap ? "on" : "off") : session.auto_wrap_mode;
    const assignmentCondition = data.requireUnassigned ? " AND project_id = ''" : "";
    const result = db.prepare(`UPDATE sessions SET project_id = ?, auto_wrap_mode = ?, updated_at = ? WHERE id = ?${assignmentCondition}`)
      .run(projectId, autoWrapMode, now, sessionId);
    if (!result.changes) {
      db.exec("ROLLBACK");
      return json(response, 409, { error: "Session is no longer unassigned" });
    }
    db.prepare(`
      UPDATE projects SET
        repository = CASE WHEN repository = '' THEN ? ELSE repository END,
        cwd = CASE WHEN cwd = '' THEN ? ELSE cwd END
      WHERE id = ?
    `).run(session.repository || "", session.cwd || "", projectId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcast("sessions-changed", { id: sessionId, eventName: "project-session-linked" });
  json(response, 200, { ok: true, projectId, sessionId });
}

function unlinkProjectSession(projectId, sessionId, response) {
  const result = db.prepare("UPDATE sessions SET project_id = '', updated_at = ? WHERE id = ? AND project_id = ?")
    .run(Date.now(), sessionId, projectId);
  if (!result.changes) return json(response, 404, { error: "Session is not linked to this project" });
  broadcast("sessions-changed", { id: sessionId, eventName: "project-session-unlinked" });
  json(response, 200, { ok: true, projectId, sessionId });
}

function addProjectTask(projectId, data, response) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND status <> 'archived'").get(projectId);
  if (!project) return json(response, 404, { error: "Project not found" });
  const session = db.prepare(`
    SELECT * FROM sessions WHERE project_id = ? AND archived = 0
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId);
  if (!session) return json(response, 409, { error: "Link a session to this project before adding tasks" });
  const text = cleanText(data.text, 500);
  if (!text) return json(response, 400, { error: "Task text is required" });
  const description = cleanText(data.description, 1000);
  const owner = cleanText(data.owner, 120);
  const attribution = sessionAttribution(session);
  const agent = cleanText(data.agent, 120) || attribution.agent;
  const recommendedModel = cleanText(data.recommendedModel, 120);
  const modelProvider = cleanText(data.modelProvider, 120);
  const reasoningEffort = cleanText(data.reasoningEffort, 40);
  const modelReason = cleanText(data.modelReason, 500);
  const status = normalizeTaskStatus(data.status);
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE project_id = ?")
    .get(projectId).position;
  const now = Date.now();
  const ticketId = nextProjectTicketId(projectId);
  const result = db.prepare(`
    INSERT INTO tasks(
      session_id, project_id, ticket_id, text, description, owner, agent_owner,
      completed_by, completed_with, recommended_model, model_provider, reasoning_effort,
      model_reason, completed, position, created_at, updated_at, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, projectId, ticketId, text, description, owner, agent,
    status === "done" ? (owner || attribution.human) : "",
    status === "done" ? agent : "",
    recommendedModel, modelProvider, reasoningEffort, modelReason,
    status === "done" ? 1 : 0, position, now, now, status
  );
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
  broadcast("sessions-changed", { id: session.id, eventName: "task-added" });
  json(response, 201, {
    id: Number(result.lastInsertRowid), sessionId: session.id, projectId, ticketId, text,
    description, owner, agent, completedBy: status === "done" ? (owner || attribution.human) : "",
    completedWith: status === "done" ? agent : "", recommendedModel, modelProvider, reasoningEffort, modelReason,
    completed: status === "done", status, position, updatedAt: now
  });
}

function addProjectWorkItem(projectId, data, response) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND status <> 'archived'").get(projectId);
  if (!project) return json(response, 404, { error: "Project not found" });
  const session = db.prepare(`
    SELECT id FROM sessions WHERE project_id = ? AND archived = 0
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId);
  if (!session) return json(response, 409, { error: "Link a session to this project before adding work items" });
  insertWorkItem(session.id, projectId, data, response);
}

function getProjectSuggestions(url, response) {
  const sessionId = url.searchParams.get("sessionId");
  const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND archived = 0").get(sessionId);
  if (!session) return json(response, 404, { error: "Session not found" });
  const projects = db.prepare("SELECT * FROM projects WHERE status = 'active' AND id <> ? ORDER BY updated_at DESC")
    .all(session.project_id || "")
    .map((project) => {
      const repositoryMatch = Boolean(session.repository && project.repository === session.repository);
      const workspaceMatch = Boolean(session.cwd && project.cwd === session.cwd);
      return {
        ...projectRecord(project),
        suggested: repositoryMatch || workspaceMatch,
        suggestionReason: repositoryMatch ? "Same repository" : workspaceMatch ? "Same working directory" : ""
      };
    })
    .sort((left, right) => Number(right.suggested) - Number(left.suggested) || right.updatedAt - left.updatedAt);
  json(response, 200, projects);
}

function projectSessionRows(projectId) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE project_id = ? AND archived = 0 AND source <> 'shared-project'
    ORDER BY updated_at DESC
  `).all(projectId);
}

function touchProjectForSession(sessionId, timestamp = Date.now()) {
  const row = db.prepare("SELECT project_id FROM sessions WHERE id = ?").get(sessionId);
  if (row?.project_id) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, row.project_id);
}

function handleHook(provider, eventName, payload, response) {
  if (!providerConfig(provider)) return json(response, 400, { error: "Unsupported provider" });
  const externalId = cleanText(payload.sessionId, 300);
  if (!externalId) return json(response, 400, { error: "Missing sessionId" });
  const id = provider === "copilot" ? externalId : `${provider}:${externalId}`;
  const timestamp = Number(payload.timestamp) || Date.now();
  const existing = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!existing) {
    const git = gitContext(payload.cwd);
    db.prepare(`
      INSERT INTO sessions
      (id, external_id, provider, title, cwd, repository, branch, source, status, started_at, updated_at, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)
    `).run(
      id, externalId, provider, suggestedTitle(payload.cwd, provider), payload.cwd || "",
      git.repository, git.branch, payload.source || "startup", timestamp, timestamp
    );
  }

  const current = existing || db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  const lifecycleApplied = timestamp >= current.updated_at;
  if (lifecycleApplied) {
    if (eventName === "sessionStart") {
      db.prepare("UPDATE sessions SET status = 'active', source = ?, cwd = ?, updated_at = ?, ended_at = NULL, end_reason = NULL WHERE id = ?")
        .run(payload.source || "startup", payload.cwd || "", timestamp, id);
    } else if (eventName === "agentStop") {
      db.prepare("UPDATE sessions SET status = 'active', transcript_path = ?, updated_at = ? WHERE id = ?")
        .run(payload.transcriptPath || "", timestamp, id);
    } else if (eventName === "sessionEnd") {
      db.prepare("UPDATE sessions SET status = 'paused', ended_at = ?, end_reason = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, payload.reason || "user_exit", timestamp, id);
    } else if (eventName === "preCompact") {
      db.prepare("UPDATE sessions SET compacted_at = ?, transcript_path = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, payload.transcriptPath || "", timestamp, id);
    }
  }

  if (provider === "copilot" && ["agentStop", "preCompact", "sessionEnd"].includes(eventName)) syncSessionFiles(id);
  let autoWrapped = false;
  if (autoWrapEnabledForSession(id)) {
    if (provider === "copilot" && ["preCompact", "agentStop"].includes(eventName)) {
      autoWrapped = syncCopilotGeneratedCheckpoint(id, timestamp);
    }
    if (lifecycleApplied && (eventName === "preCompact" || eventName === "sessionEnd")) {
      autoWrapped = autoCheckpoint(id, eventName, payload, timestamp) || autoWrapped;
    }
  }
  addEvent(id, eventName, eventDetail(eventName, payload), timestamp);
  if (eventName === "sessionEnd" && lifecycleApplied) signalUpdateInstall(id);
  broadcast("sessions-changed", { id, eventName });
  const update = updateChecker.cachedStatus();
  const updateJob = eventName === "sessionStart" ? takeUpdateCompletionNotice() : null;
  const trackedSession = db.prepare("SELECT project_id FROM sessions WHERE id = ?").get(id);
  const project = trackedSession?.project_id
    ? db.prepare("SELECT * FROM projects WHERE id = ?").get(trackedSession.project_id)
    : null;
  json(response, 200, {
    ok: true,
    sessionId: id,
    project: project ? projectRecord(project) : null,
    autoWrapped,
    update: update.updateAvailable ? update : null,
    updateJob
  });
  scheduleUpdateCheck();
}

function checkpoint(id, data, response) {
  const existing = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!existing) return json(response, 404, { error: "Session not found. Start the tracked AI CLI session first." });
  const now = Date.now();
  const title = data.title === undefined ? existing.title : (cleanText(data.title, 120) || existing.title);
  const summary = data.summary === undefined ? existing.summary : cleanText(data.summary, 3000);
  const lastAction = data.lastAction === undefined ? existing.last_action : cleanText(data.lastAction, 1000);
  const nextAction = data.nextAction === undefined ? existing.next_action : cleanText(data.nextAction, 1000);
  const unresolved = data.unresolved === undefined ? parseArray(existing.unresolved) : cleanArray(data.unresolved, 20, 500);
  const decisions = data.decisions === undefined ? parseArray(existing.decisions) : cleanArray(data.decisions, 20, 500);
  const tasks = data.tasks === undefined ? null : cleanArray(data.tasks, 20, 500);
  const completedTasks = data.completedTasks === undefined ? [] : cleanArray(data.completedTasks, 20, 500);
  const files = cleanCheckpointFiles(data.files, existing);
  const taskSessionIds = existing.project_id
    ? projectSessionRows(existing.project_id).map((session) => session.id)
    : [id];
  const taskPlaceholders = taskSessionIds.map(() => "?").join(", ");
  const taskScopeWhere = existing.project_id
    ? `(project_id = ? OR (project_id = '' AND session_id IN (${taskPlaceholders})))`
    : "project_id = '' AND session_id = ?";
  const taskScopeArgs = existing.project_id ? [existing.project_id, ...taskSessionIds] : [id];
  const metrics = existing.provider === "copilot"
    ? readSessionMetrics(id, existing.transcript_path)
    : {
        aiCredits: existing.ai_credits,
        currentTokens: existing.current_tokens,
        inputTokens: existing.input_tokens,
        outputTokens: existing.output_tokens,
        totalTokens: existing.total_tokens,
        contextLimit: existing.context_limit,
        model: existing.model,
        contextTier: existing.context_tier,
        capturedAt: existing.metrics_at
      };
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE sessions SET title = ?, summary = ?, last_action = ?, next_action = ?,
        unresolved = ?, decisions = ?, needs_review = 0, updated_at = ?,
        ai_credits = ?, current_tokens = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?,
        context_limit = ?, model = ?, context_tier = ?, metrics_at = ?,
        checkpoint_source = 'manual', checkpoint_trigger = 'manual', checkpointed_at = ?
      WHERE id = ?
    `).run(
      title, summary, lastAction, nextAction, JSON.stringify(unresolved), JSON.stringify(decisions), now,
      metrics.aiCredits, metrics.currentTokens, metrics.inputTokens, metrics.outputTokens, metrics.totalTokens,
      metrics.contextLimit, metrics.model, metrics.contextTier, metrics.capturedAt, now,
      id
    );
    if (tasks) {
      const existingTasks = db.prepare(`SELECT text FROM tasks WHERE ${taskScopeWhere}`).all(...taskScopeArgs);
      const existingText = new Set(existingTasks.map((task) => task.text.toLocaleLowerCase()));
      const nextPosition = Number(db.prepare(`
        SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE session_id = ? AND project_id = ''
      `).get(id).position);
      const insert = db.prepare("INSERT INTO tasks(session_id, text, completed, position, created_at, status) VALUES (?, ?, 0, ?, ?, 'next')");
      let added = 0;
      for (const task of tasks) {
        const key = task.toLocaleLowerCase();
        if (existingText.has(key)) continue;
        insert.run(id, task, nextPosition + added, now);
        existingText.add(key);
        added++;
      }

    }
    if (completedTasks.length) {
      const completedKeys = new Set(completedTasks.map((task) => task.toLocaleLowerCase()));
      const projectTasks = db.prepare(`SELECT id, text FROM tasks WHERE ${taskScopeWhere}`).all(...taskScopeArgs);
      const completeTask = db.prepare("UPDATE tasks SET completed = 1, status = 'done' WHERE id = ?");
      for (const task of projectTasks) {
        if (completedKeys.has(task.text.toLocaleLowerCase())) completeTask.run(task.id);
      }
    }
    if (existing.project_id) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, existing.project_id);
    if (files?.length) mergeCheckpointFiles(id, files, now);
    addEvent(id, "checkpoint", "AI continuity checkpoint saved", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcast("sessions-changed", { id, eventName: "checkpoint" });
  const update = updateChecker.cachedStatus();
  const project = existing.project_id
    ? db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.project_id)
    : null;
  json(response, 200, {
    ok: true,
    dashboardUrl: baseUrl,
    sessionId: id,
    project: project ? projectRecord(project) : null,
    update
  });
  scheduleUpdateCheck();
}

function autoCheckpoint(id, trigger, payload, timestamp) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!session) return false;
  const latestCheckpointAt = Math.max(
    Number(session.checkpointed_at) || 0,
    Number(session.auto_checkpointed_at) || 0
  );
  const providerCheckpoint = trigger === "providerCheckpoint";
  if (
    providerCheckpoint
      ? session.checkpoint_source === "manual"
        ? timestamp <= (Number(session.checkpointed_at) || 0)
        : timestamp < latestCheckpointAt
      : timestamp <= latestCheckpointAt
  ) return false;
  if (
    trigger === "sessionEnd" &&
    latestCheckpointAt &&
    timestamp - latestCheckpointAt < 5 * 60 * 1000
  ) return false;

  const provided = payload && typeof payload === "object"
    ? (payload.checkpoint && typeof payload.checkpoint === "object" ? payload.checkpoint : payload)
    : {};
  const manual = session.checkpoint_source === "manual";
  const providedSummary = cleanText(provided.overview ?? provided.summary, 3000);
  const providedLastAction = cleanText(provided.workDone ?? provided.work_done ?? provided.lastAction, 1000);
  const summary = manual ? session.summary : providedSummary || session.summary;
  const lastAction = manual ? session.last_action : providedLastAction || session.last_action;
  const nextTask = db.prepare(`
    SELECT text FROM tasks
    WHERE session_id = ? AND status <> 'done'
    ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'next' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END, position, id
    LIMIT 1
  `).get(id)?.text || "";
  const providedNextAction = cleanText(provided.nextSteps ?? provided.next_steps ?? provided.nextAction, 1000);
  const nextAction = manual
    ? session.next_action
    : providedNextAction || session.next_action || nextTask;

  db.prepare(`
    UPDATE sessions SET summary = ?, last_action = ?, next_action = ?, needs_review = 0,
      checkpoint_source = ?, checkpoint_trigger = ?, checkpointed_at = ?,
      auto_checkpoint_trigger = ?, auto_checkpointed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    summary,
    lastAction,
    nextAction,
    manual ? session.checkpoint_source : "automatic",
    manual ? session.checkpoint_trigger : trigger,
    manual ? session.checkpointed_at : Math.max(timestamp, Number(session.checkpointed_at) || 0),
    trigger,
    Math.max(timestamp, Number(session.auto_checkpointed_at) || 0),
    Math.max(timestamp, Number(session.updated_at) || 0),
    id
  );
  if (session.project_id) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, session.project_id);
  }
  const triggerLabel = {
    preCompact: "context compaction",
    sessionEnd: "session exit",
    providerCheckpoint: "provider checkpoint"
  }[trigger] || trigger;
  addEvent(id, "auto-checkpoint", `Automatic checkpoint saved from ${triggerLabel}`, timestamp);
  return true;
}

function readAutoWrapSettings() {
  const value = db.prepare("SELECT value FROM app_metadata WHERE key = 'auto_wrap_settings'").get()?.value;
  if (!value) return { enabled: false, consented: false };
  try {
    const settings = JSON.parse(value);
    return {
      enabled: settings.enabled === true,
      consented: settings.consented === true
    };
  } catch {
    db.prepare("DELETE FROM app_metadata WHERE key = 'auto_wrap_settings'").run();
    return { enabled: false, consented: false };
  }
}

function autoWrapEnabledForSession(id) {
  const session = db.prepare("SELECT project_id, auto_wrap_mode FROM sessions WHERE id = ?").get(id);
  if (!session || session.auto_wrap_mode === "off") return false;
  if (session.auto_wrap_mode === "on") return true;
  return Boolean(session.project_id && readAutoWrapSettings().enabled);
}

function getSettings(response) {
  json(response, 200, { autoWrap: readAutoWrapSettings() });
}

function updateSettings(data, response) {
  if (typeof data.autoWrapEnabled !== "boolean") {
    return json(response, 400, { error: "autoWrapEnabled must be true or false" });
  }
  const settings = { enabled: data.autoWrapEnabled, consented: true };
  db.prepare("INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('auto_wrap_settings', ?)").run(JSON.stringify(settings));
  broadcast("settings-changed", { autoWrap: settings });
  json(response, 200, { autoWrap: settings });
}

function syncCopilotGeneratedCheckpoint(id, timestamp) {
  if (!existsSync(historyPath)) return false;
  let history;
  try {
    history = new DatabaseSync(historyPath, { readOnly: true });
    const hasCheckpoints = history.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'"
    ).get();
    if (!hasCheckpoints) return false;
    const checkpoint = history.prepare(`
      SELECT title, overview, work_done, next_steps, created_at
      FROM checkpoints
      WHERE session_id = ?
      ORDER BY checkpoint_number DESC, created_at DESC
      LIMIT 1
    `).get(id);
    if (!checkpoint) return false;
    const createdAt = parseTimestamp(checkpoint.created_at) || timestamp;
    const session = db.prepare("SELECT provider_checkpoint_synced_at FROM sessions WHERE id = ?").get(id);
    if (session?.provider_checkpoint_synced_at && createdAt <= session.provider_checkpoint_synced_at) return false;
    db.prepare("UPDATE sessions SET provider_checkpoint_synced_at = ? WHERE id = ?").run(createdAt, id);
    return autoCheckpoint(id, "providerCheckpoint", { checkpoint }, createdAt);
  } catch (error) {
    console.error("Could not synchronize Copilot checkpoint:", error.message);
    return false;
  } finally {
    history?.close();
  }
}

function updateSession(id, data, response) {
  const allowed = {
    title: ["title", (value) => cleanText(value, 120)],
    summary: ["summary", (value) => cleanText(value, 3000)],
    lastAction: ["last_action", (value) => cleanText(value, 1000)],
    nextAction: ["next_action", (value) => cleanText(value, 1000)],
    pinned: ["pinned", (value) => value ? 1 : 0],
    archived: ["archived", (value) => value ? 1 : 0],
    needsReview: ["needs_review", (value) => value ? 1 : 0],
    status: ["status", (value) => ["active", "paused", "complete"].includes(value) ? value : "paused"],
    isProject: ["is_project", (value) => value ? 1 : 0],
    autoWrap: ["auto_wrap_mode", (value) => value ? "on" : "off"],
    autoWrapMode: ["auto_wrap_mode", (value) => value]
  };
  if (data.autoWrap !== undefined && typeof data.autoWrap !== "boolean") {
    return json(response, 400, { error: "autoWrap must be true or false" });
  }
  if (data.autoWrapMode !== undefined && !["on", "off", "inherit"].includes(data.autoWrapMode)) {
    return json(response, 400, { error: "autoWrapMode must be on, off, or inherit" });
  }
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (!allowed[key]) continue;
    updates.push(`${allowed[key][0]} = ?`);
    values.push(allowed[key][1](value));
  }
  if (!updates.length) return json(response, 400, { error: "No supported fields supplied" });
  const updatedAt = Date.now();
  if (["summary", "lastAction", "nextAction"].some((key) => Object.hasOwn(data, key))) {
    updates.push("checkpoint_source = 'manual'", "checkpoint_trigger = 'dashboard-edit'", "checkpointed_at = ?");
    values.push(updatedAt);
  }
  updates.push("updated_at = ?");
  values.push(updatedAt, id);
  const result = db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  if (!result.changes) return json(response, 404, { error: "Session not found" });
  if (data.isProject !== undefined) setLegacyProjectTracking(id, Boolean(data.isProject));
  broadcast("sessions-changed", { id, eventName: "updated" });
  getSession(id, response);
}

function setLegacyProjectTracking(sessionId, enabled) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return;
  if (enabled && !session.project_id) {
    const now = Date.now();
    const projectId = randomUUID();
    db.prepare(`
      INSERT INTO projects(id, title, description, status, ticket_prefix, repository, cwd, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(
      projectId, session.title, session.summary || "", deriveTicketPrefix(session.title),
      session.repository || "", session.cwd || "", now, now
    );
    db.prepare("UPDATE sessions SET project_id = ? WHERE id = ?").run(projectId, sessionId);
    return;
  }
  if (!enabled && session.project_id) {
    const projectId = session.project_id;
    db.prepare("UPDATE sessions SET project_id = '' WHERE id = ?").run(sessionId);
    const remaining = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE project_id = ?").get(projectId).count;
    if (!remaining) db.prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?").run(Date.now(), projectId);
  }
}

function addTask(id, data, response) {
  const text = cleanText(data.text, 500);
  if (!text) return json(response, 400, { error: "Task text is required" });
  const status = normalizeTaskStatus(data.status);
  const description = cleanText(data.description, 1000);
  const owner = cleanText(data.owner, 120);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  const attribution = sessionAttribution(session);
  const agent = cleanText(data.agent, 120) || attribution.agent;
  const recommendedModel = cleanText(data.recommendedModel, 120);
  const modelProvider = cleanText(data.modelProvider, 120);
  const reasoningEffort = cleanText(data.reasoningEffort, 40);
  const modelReason = cleanText(data.modelReason, 500);
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE session_id = ?").get(id).position;
  const now = Date.now();
  const ticketId = session?.project_id ? nextProjectTicketId(session.project_id) : "";
  const result = db.prepare(`
    INSERT INTO tasks(
      session_id, ticket_id, text, description, owner, agent_owner, completed_by,
      completed_with, recommended_model, model_provider, reasoning_effort, model_reason,
      completed, position, created_at, updated_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, ticketId, text, description, owner, agent,
    status === "done" ? (owner || attribution.human) : "",
    status === "done" ? agent : "",
    recommendedModel, modelProvider, reasoningEffort, modelReason,
    status === "done" ? 1 : 0, position, now, now, status
  );
  touchProjectForSession(id);
  broadcast("sessions-changed", { id, eventName: "task-added" });
  json(response, 201, {
    id: Number(result.lastInsertRowid), sessionId: id, ticketId, text, description, owner, agent,
    completedBy: status === "done" ? (owner || attribution.human) : "",
    completedWith: status === "done" ? agent : "",
    recommendedModel, modelProvider, reasoningEffort, modelReason,
    completed: status === "done", status, position, updatedAt: now
  });
}

function updateTask(id, data, response) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Task not found" });
  const sourceSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(row.session_id);
  const actorSessionId = cleanText(data.actorSessionId, 300);
  const actorSession = actorSessionId
    ? db.prepare("SELECT * FROM sessions WHERE id = ?").get(actorSessionId)
    : null;
  if (actorSessionId && !actorSession) {
    return json(response, 400, { error: "The attribution session does not exist" });
  }
  const taskProjectId = row.project_id || sourceSession?.project_id || "";
  if (actorSession && taskProjectId && actorSession.project_id !== taskProjectId) {
    return json(response, 409, { error: "The attribution session is not linked to this project" });
  }
  const attribution = sessionAttribution(actorSession || sourceSession);
  const text = data.text === undefined ? row.text : cleanText(data.text, 500);
  const description = data.description === undefined ? row.description : cleanText(data.description, 1000);
  let owner = data.owner === undefined ? row.owner : cleanText(data.owner, 120);
  let agent = data.agent === undefined
    ? (row.agent_owner || attribution.agent)
    : cleanText(data.agent, 120);
  const recommendedModel = data.recommendedModel === undefined
    ? row.recommended_model
    : cleanText(data.recommendedModel, 120);
  const modelProvider = data.modelProvider === undefined
    ? row.model_provider
    : cleanText(data.modelProvider, 120);
  const reasoningEffort = data.reasoningEffort === undefined
    ? row.reasoning_effort
    : cleanText(data.reasoningEffort, 40);
  const modelReason = data.modelReason === undefined
    ? row.model_reason
    : cleanText(data.modelReason, 500);
  let status = data.status === undefined ? normalizeTaskStatus(row.status) : normalizeTaskStatus(data.status);
  if (data.completed !== undefined) status = data.completed ? "done" : (status === "done" ? "next" : status);
  if (actorSession && ["in_progress", "done"].includes(status)) {
    if (!owner) owner = cleanText(data.actorName, 120) || attribution.human;
    agent = attribution.agent || agent;
  }
  const completed = status === "done" ? 1 : 0;
  const becameDone = status === "done" && normalizeTaskStatus(row.status) !== "done";
  const completedBy = status === "done"
    ? cleanText(data.completedBy, 120) || cleanText(data.actorName, 120) || row.completed_by || owner || attribution.human
    : "";
  const completedWith = status === "done"
    ? cleanText(data.completedWith, 120) || row.completed_with || agent || attribution.agent
    : "";
  const now = Date.now();
  db.prepare(`
    UPDATE tasks SET text = ?, description = ?, owner = ?, agent_owner = ?,
      completed_by = ?, completed_with = ?, recommended_model = ?, model_provider = ?,
      reasoning_effort = ?, model_reason = ?, completed = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(
    text, description, owner, agent, completedBy, completedWith,
    recommendedModel, modelProvider, reasoningEffort, modelReason,
    completed, status, now, id
  );
  if (row.project_id) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, row.project_id);
  else {
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, row.session_id);
    touchProjectForSession(row.session_id, now);
  }
  broadcast("sessions-changed", { id: row.session_id, eventName: becameDone ? "task-completed" : "task-updated" });
  json(response, 200, taskRecord({
    ...row, text, description, owner, agent_owner: agent, completed_by: completedBy,
    completed_with: completedWith, recommended_model: recommendedModel, model_provider: modelProvider,
    reasoning_effort: reasoningEffort, model_reason: modelReason, completed, status, updated_at: now
  }));
}

function deleteTask(id, response) {
  const row = db.prepare("SELECT session_id, project_id FROM tasks WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Task not found" });
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  if (row.project_id) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(Date.now(), row.project_id);
  else touchProjectForSession(row.session_id);
  broadcast("sessions-changed", { id: row.session_id, eventName: "task-deleted" });
  json(response, 200, { ok: true });
}

function addWorkItem(sessionId, data, response) {
  const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return json(response, 404, { error: "Session not found" });
  insertWorkItem(sessionId, "", data, response);
}

function insertWorkItem(sessionId, projectId, data, response) {
  const url = cleanText(data.url, 2000);
  const parsed = parseAdoWorkItemUrl(url);
  if (!parsed) return json(response, 400, { error: "Enter a valid Azure DevOps work item URL containing /_workitems/edit/{id}" });
  const type = normalizeWorkItemType(data.type);
  const title = cleanText(data.title, 200);
  try {
    const result = db.prepare(`
      INSERT INTO work_items(session_id, project_id, work_item_id, type, title, url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, projectId, parsed.id, type, title, parsed.url, Date.now());
    const now = Date.now();
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
    if (projectId) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    else touchProjectForSession(sessionId, now);
    broadcast("sessions-changed", { id: sessionId, eventName: "work-item-added" });
    json(response, 201, {
      id: Number(result.lastInsertRowid),
      sessionId,
      projectId,
      workItemId: parsed.id,
      type,
      title,
      url: parsed.url
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return json(response, 409, { error: "This work item is already linked to the project" });
    throw error;
  }
}

function deleteWorkItem(id, response) {
  const row = db.prepare("SELECT session_id, project_id FROM work_items WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Work item link not found" });
  db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
  if (row.project_id) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(Date.now(), row.project_id);
  else touchProjectForSession(row.session_id);
  broadcast("sessions-changed", { id: row.session_id, eventName: "work-item-deleted" });
  json(response, 200, { ok: true });
}

function resumeSession(id, response) {
  const row = db.prepare("SELECT cwd, provider, external_id FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  if (!row.cwd || !existsSync(row.cwd)) {
    return json(response, 409, { error: "The original working directory no longer exists. Restore or recreate that folder, then try resuming again." });
  }
  const cwd = row.cwd;
  const config = providerConfig(row.provider);
  if (!config?.supportsResume) {
    return json(response, 409, { error: `${config?.name || "This provider"} must be resumed from its own conversation history` });
  }
  const executablePath = resolveExecutable(config.executable);
  if (!executablePath) return json(response, 409, { error: `${config.name} was not found on PATH` });
  const resumeArgs = config.resumeArgs(row.external_id || id);
  if (process.platform === "darwin") {
    const command = `cd ${shellQuote(cwd)} && exec ${[executablePath, ...resumeArgs].map(shellQuote).join(" ")}`;
    const child = spawn("osascript", [
      "-e", "tell application \"Terminal\"",
      "-e", `do script ${appleScriptString(command)}`,
      "-e", "activate",
      "-e", "end tell"
    ], { detached: true, stdio: "ignore" });
    child.unref();
    addEvent(id, "resume-requested", "Resume launched from dashboard", Date.now());
    return json(response, 200, { ok: true });
  }
  if (process.platform !== "win32") {
    return json(response, 501, { error: "Launching a resume terminal is not supported on this platform" });
  }
  const pwshPath = resolveExecutable("pwsh.exe") || "pwsh.exe";
  const terminalPath = resolveExecutable("wt.exe");
  const command = `& '${escapePowerShellLiteral(executablePath)}' ${resumeArgs.map((arg) => `'${escapePowerShellLiteral(arg)}'`).join(" ")}`;
  const executable = terminalPath || pwshPath;
  const args = terminalPath
    ? ["-d", cwd, pwshPath, "-NoExit", "-Command", command]
    : ["-NoExit", "-Command", `Set-Location -LiteralPath '${escapePowerShellLiteral(cwd)}'; ${command}`];
  const child = spawn(executable, args, {
    cwd,
    detached: true,
    windowsHide: false,
    stdio: "ignore"
  });
  child.unref();
  addEvent(id, "resume-requested", "Resume launched from dashboard", Date.now());
  json(response, 200, { ok: true });
}

function providerConfig(provider) {
  return {
    copilot: {
      name: "GitHub Copilot CLI",
      supportsResume: true,
      executable: "copilot",
      resumeArgs: (id) => [`--resume=${id}`],
      resumeCommand: (id) => `copilot --resume=${id}`
    },
    claude: {
      name: "Claude Code",
      supportsResume: true,
      executable: "claude",
      resumeArgs: (id) => ["--resume", id],
      resumeCommand: (id) => `claude --resume ${id}`
    },
    codex: {
      name: "Codex CLI",
      supportsResume: true,
      executable: "codex",
      resumeArgs: (id) => ["resume", id],
      resumeCommand: (id) => `codex resume ${id}`
    },
    gemini: {
      name: "Gemini CLI",
      supportsResume: true,
      executable: "gemini",
      resumeArgs: (id) => ["--resume", id],
      resumeCommand: (id) => `gemini --resume ${id}`
    },
    scout: {
      name: "Microsoft Scout",
      supportsResume: false,
      executable: "",
      resumeArgs: () => [],
      resumeCommand: () => ""
    }
  }[provider];
}

function resolveExecutable(command) {
  try {
    if (process.platform !== "win32") {
      return execFileSync("/usr/bin/which", [command], {
        encoding: "utf8",
        timeout: 2000
      }).trim() || null;
    }
    if (command === "copilot") {
      return execFileSync("pwsh.exe", ["-NoProfile", "-Command", "(Get-Command copilot -ErrorAction Stop).Source"], {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true
      }).trim();
    }
    return execFileSync("where.exe", [command], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    }).split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function copilotPluginConfigured(executable) {
  if (!executable) return false;
  try {
    const command = process.platform === "win32" && executable.toLowerCase().endsWith(".ps1")
      ? ["pwsh.exe", ["-NoProfile", "-File", executable, "plugin", "list"]]
      : [executable, ["plugin", "list"]];
    const plugins = execFileSync(command[0], command[1], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return plugins.includes("cw@context-workspace") || plugins.includes("sham@context-workspace");
  } catch {
    return false;
  }
}

function escapePowerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function openFolder(id, response) {
  const row = db.prepare("SELECT cwd FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  if (!existsSync(row.cwd)) return json(response, 409, { error: "Working directory no longer exists" });
  const executable = process.platform === "darwin" ? "open" : "explorer.exe";
  if (!["darwin", "win32"].includes(process.platform)) {
    return json(response, 501, { error: "Opening a working directory is not supported on this platform" });
  }
  const child = spawn(executable, [row.cwd], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  json(response, 200, { ok: true });
}

function defaultDataDir() {
  if (process.env.LOCALAPPDATA) {
    const current = join(process.env.LOCALAPPDATA, "ContextWorkspace");
    const legacyCandidates = [
      join(process.env.LOCALAPPDATA, "SmartHumanAIManager"),
      join(process.env.LOCALAPPDATA, "CopilotSessionHub")
    ];
    if (existsSync(join(current, "sessions.db"))) return current;
    return legacyCandidates.find((path) => existsSync(join(path, "sessions.db"))) || current;
  }
  if (platform() === "darwin") {
    const current = join(homedir(), "Library", "Application Support", "ContextWorkspace");
    const legacyCandidates = [
      join(homedir(), "Library", "Application Support", "SmartHumanAIManager"),
      join(homedir(), "Library", "Application Support", "CopilotSessionHub"),
      join(homedir(), ".copilot-session-hub")
    ];
    if (existsSync(join(current, "sessions.db"))) return current;
    return legacyCandidates.find((path) => existsSync(join(path, "sessions.db"))) || current;
  }
  const current = join(homedir(), ".context-workspace");
  const legacy = join(homedir(), ".copilot-session-hub");
  return existsSync(join(current, "sessions.db")) || !existsSync(join(legacy, "sessions.db")) ? current : legacy;
}

function environmentValue(primary, legacy) {
  return process.env[primary] ?? process.env[legacy];
}

function openEventStream(request, response) {
  response.writeHead(200, {
    ...antiFramingHeaders,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive"
  });
  response.write("event: connected\ndata: {}\n\n");
  clients.add(response);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20000);
  request.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: "Forbidden" });
  try {
    await access(filePath);
  } catch {
    return json(response, 404, { error: "Not found" });
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  response.writeHead(200, {
    ...antiFramingHeaders,
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-cache"
  });
  createReadStream(filePath).pipe(response);
}

async function replayPendingEvents() {
  const queuePath = join(dataDir, "pending-events.jsonl");
  if (!existsSync(queuePath)) return;
  const processingPath = `${queuePath}.processing`;
  await rename(queuePath, processingPath);
  try {
    const lines = (await readFile(processingPath, "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const fakeResponse = { writeHead() {}, end() {} };
        handleHook(entry.provider || "copilot", entry.eventName, entry.payload, fakeResponse);
      } catch (error) {
        console.error("Failed to replay queued event:", error.message);
      }
    }
  } finally {
    await unlink(processingPath).catch(() => {});
  }
}

function sessionRecord(row) {
  const provider = row.provider || "copilot";
  const externalId = row.external_id || row.id;
  return {
    id: row.id,
    externalId,
    provider,
    providerName: providerConfig(provider)?.name || provider,
    resumeCommand: providerConfig(provider)?.resumeCommand(externalId) || "",
    title: row.title,
    summary: row.summary,
    initialQuestion: row.initial_question,
    questions: parseArray(row.questions),
    lastAction: row.last_action,
    nextAction: row.next_action,
    unresolved: parseArray(row.unresolved),
    decisions: parseArray(row.decisions),
    cwd: row.cwd,
    repository: row.repository,
    branch: row.branch,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    needsReview: Boolean(row.needs_review),
    transcriptPath: row.transcript_path,
    compactedAt: row.compacted_at,
    checkpointSource: row.checkpoint_source || "",
    checkpointTrigger: row.checkpoint_trigger || "",
    checkpointedAt: row.checkpointed_at,
    autoCheckpointTrigger: row.auto_checkpoint_trigger || "",
    autoCheckpointedAt: row.auto_checkpointed_at,
    autoWrapMode: row.auto_wrap_mode || "inherit",
    autoWrapEnabled: row.auto_wrap_mode === "on" ||
      (row.auto_wrap_mode !== "off" && Boolean(row.project_id) && readAutoWrapSettings().enabled),
    imported: Boolean(row.imported),
    isProject: Boolean(row.is_project),
    projectId: row.project_id || "",
    metrics: {
      aiCredits: row.ai_credits,
      currentTokens: row.current_tokens,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      contextLimit: row.context_limit,
      model: row.model || "",
      contextTier: row.context_tier || "",
      capturedAt: row.metrics_at
    }
  };
}

function projectRecord(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.description || "",
    description: row.description || "",
    status: row.status,
    starred: Boolean(row.starred),
    ticketPrefix: row.ticket_prefix || deriveTicketPrefix(row.title),
    sharing: {
      enabled: Boolean(row.share_branch),
      remote: row.share_remote || "",
      branch: row.share_branch || "",
      path: row.share_path || "",
      sharedAt: row.shared_at || null,
      pushedAt: row.share_pushed_at || null,
      pulledAt: row.share_pulled_at || null,
      revision: Number(row.share_revision || 0)
    },
    isProject: true,
    repository: row.repository || "",
    cwd: row.cwd || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function taskRecord(row) {
  const agent = row.agent_owner || providerConfig(row.provider)?.name || "";
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id || "",
    ticketId: row.ticket_id || "",
    text: row.text,
    description: row.description || "",
    owner: row.owner || "",
    agent,
    completedBy: row.completed_by || "",
    completedWith: row.completed_with || "",
    recommendedModel: row.recommended_model || "",
    modelProvider: row.model_provider || "",
    reasoningEffort: row.reasoning_effort || "",
    modelReason: row.model_reason || "",
    completed: Boolean(row.completed),
    status: normalizeTaskStatus(row.status || (row.completed ? "done" : "next")),
    position: row.position,
    updatedAt: row.updated_at || row.created_at
  };
}

function sessionAttribution(session) {
  if (!session) return { human: "", agent: "" };
  return {
    human: gitUserName(session.cwd || session.repository),
    agent: providerConfig(session.provider)?.name || cleanText(session.provider, 120)
  };
}

function gitUserName(cwd) {
  if (!cwd || !existsSync(cwd)) return "";
  try {
    return cleanText(execFileSync("git", ["-C", cwd, "config", "user.name"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim(), 120);
  } catch {
    return "";
  }
}

function ensureProjectTicketIds(projectId) {
  const project = db.prepare("SELECT id, title, ticket_prefix FROM projects WHERE id = ?").get(projectId);
  if (!project) return;
  const prefix = project.ticket_prefix || deriveTicketPrefix(project.title);
  if (!project.ticket_prefix) db.prepare("UPDATE projects SET ticket_prefix = ? WHERE id = ?").run(prefix, projectId);
  const rows = db.prepare(`
    SELECT t.id, t.ticket_id
    FROM tasks t
    LEFT JOIN sessions s ON s.id = t.session_id
    WHERE t.project_id = ? OR (t.project_id = '' AND s.project_id = ? AND s.archived = 0)
    ORDER BY t.created_at, t.id
  `).all(projectId, projectId);
  let next = rows.reduce((maximum, row) => {
    const match = String(row.ticket_id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  const update = db.prepare("UPDATE tasks SET ticket_id = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      if (!row.ticket_id) update.run(`${prefix}-${next++}`, row.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function nextProjectTicketId(projectId) {
  ensureProjectTicketIds(projectId);
  const project = db.prepare("SELECT title, ticket_prefix FROM projects WHERE id = ?").get(projectId);
  const prefix = project?.ticket_prefix || deriveTicketPrefix(project?.title || "Task");
  const rows = db.prepare(`
    SELECT t.ticket_id
    FROM tasks t
    LEFT JOIN sessions s ON s.id = t.session_id
    WHERE t.project_id = ? OR (t.project_id = '' AND s.project_id = ? AND s.archived = 0)
  `).all(projectId, projectId);
  const next = rows.reduce((maximum, row) => {
    const match = String(row.ticket_id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  return `${prefix}-${next}`;
}

function normalizeTicketPrefix(value) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return normalized.length >= 2 ? normalized : "";
}

function deriveTicketPrefix(title) {
  const words = String(title || "").toUpperCase().match(/[A-Z0-9]+/g) || [];
  const initials = words.map((word) => word[0]).join("").slice(0, 5);
  if (initials.length >= 2) return initials;
  const compact = words.join("").slice(0, 4);
  return compact.length >= 2 ? compact : "TASK";
}

function workItemRecord(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id || "",
    workItemId: row.work_item_id,
    type: row.type,
    title: row.title,
    url: row.url,
    createdAt: row.created_at
  };
}

function fileHistoryRecord(session) {
  const rows = db.prepare(`
    SELECT file_path, tool_name, turn_index, first_seen_at
    FROM session_files
    WHERE session_id = ?
    ORDER BY COALESCE(turn_index, 2147483647), COALESCE(first_seen_at, 0), file_path
    LIMIT 101
  `).all(session.id);
  const truncated = rows.length > 100;
  return {
    files: rows.slice(0, 100).map((row) => fileRecord(row, session)),
    fileCount: Number(db.prepare("SELECT COUNT(*) AS count FROM session_files WHERE session_id = ?").get(session.id)?.count || 0),
    filesTruncated: truncated,
    fileHistoryStatus: normalizeFileStatus(session.files_status),
    fileHistorySyncedAt: session.files_synced_at
  };
}

function fileRecord(row, session) {
  const display = displayFilePath(row.file_path, session.repository || session.cwd);
  return {
    displayPath: display.path,
    outsideWorkspace: display.outsideWorkspace,
    toolName: row.tool_name,
    turnIndex: row.turn_index,
    firstSeenAt: row.first_seen_at
  };
}

function displayFilePath(filePath, workspace) {
  const path = slashPath(filePath);
  const base = slashPath(workspace).replace(/\/+$/, "");
  if (base && path.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return { path: path.slice(base.length + 1), outsideWorkspace: false };
  }
  return { path: path.split("/").filter(Boolean).at(-1) || "Unknown file", outsideWorkspace: true };
}

function gitContext(cwd) {
  if (!cwd || !existsSync(cwd)) return { repository: "", branch: "" };
  try {
    const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 1500, windowsHide: true }).trim();
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8", timeout: 1500, windowsHide: true }).trim();
    return { repository, branch };
  } catch {
    return { repository: "", branch: "" };
  }
}

function suggestedTitle(cwd, provider = "copilot") {
  if (!cwd) return provider === "copilot"
    ? "New Copilot session"
    : `New ${providerConfig(provider)?.name || "AI"} session`;
  return `${cwd.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace"} session`;
}

function eventDetail(eventName, payload) {
  if (eventName === "sessionStart") return payload.source === "resume" ? "Session resumed" : "Session started";
  if (eventName === "sessionEnd") return `Session ended: ${payload.reason || "unknown"}`;
  if (eventName === "preCompact") return `Context compacted: ${payload.trigger || "unknown"}`;
  if (eventName === "agentStop") return "AI assistant completed a turn";
  return eventName;
}

function addEvent(sessionId, type, detail, timestamp) {
  db.prepare("INSERT INTO events(session_id, type, detail, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, type, detail, timestamp);
}

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(message);
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanArray(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => cleanText(item, maxLength)).filter(Boolean) : [];
}

function cleanHistoryFile(row) {
  if (!row || typeof row.file_path !== "string") return null;
  const filePath = row.file_path.trim();
  if (!filePath || filePath.length > 1024 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/i.test(filePath)) {
    return null;
  }
  return {
    filePath,
    pathKey: slashPath(filePath).toLowerCase(),
    toolName: cleanText(row.tool_name, 64),
    turnIndex: Number.isInteger(row.turn_index) && row.turn_index >= 0 ? row.turn_index : null,
    firstSeenAt: parseHistoryTimestamp(row.first_seen_at)
  };
}

function slashPath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/\/+/g, "/") : "";
}

function parseArray(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    ...antiFramingHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function importHistory() {
  if (!existsSync(historyPath)) {
    markAllFileHistoryFailure("SOURCE_DB_UNAVAILABLE");
    return { imported: 0, skipped: 0, fileSessions: 0, available: false, error: "SOURCE_DB_UNAVAILABLE" };
  }
  let history;
  try {
    history = new DatabaseSync(historyPath, { readOnly: true });
    const tables = history.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    if (!tables.includes("sessions")) {
      markAllFileHistoryFailure("SOURCE_SCHEMA_UNSUPPORTED");
      return { imported: 0, skipped: 0, fileSessions: 0, available: false, error: "SOURCE_SCHEMA_UNSUPPORTED" };
    }
    const sourceSessions = history.prepare(`
      SELECT id, cwd, repository, branch, summary, created_at, updated_at
      FROM sessions
      WHERE host_type IS NULL
      ORDER BY updated_at DESC
      LIMIT 1000
    `).all();
    const latestCheckpoint = tables.includes("checkpoints")
      ? history.prepare(`
          SELECT title, overview, work_done, next_steps
          FROM checkpoints
          WHERE session_id = ?
          ORDER BY checkpoint_number DESC, created_at DESC
          LIMIT 1
        `)
      : null;
    const latestTurn = tables.includes("turns")
      ? history.prepare(`
          SELECT user_message, assistant_response
          FROM turns
          WHERE session_id = ?
          ORDER BY turn_index DESC
          LIMIT 1
        `)
      : null;
    const allTurns = tables.includes("turns")
      ? history.prepare(`
          SELECT user_message
          FROM turns
          WHERE session_id = ?
          ORDER BY turn_index
          LIMIT 100
        `)
      : null;
    const sourceFiles = tables.includes("session_files")
      ? history.prepare(`
          SELECT session_id, file_path, tool_name, turn_index, first_seen_at
          FROM session_files
          WHERE session_id = ?
          ORDER BY turn_index, first_seen_at, file_path
          LIMIT 10001
        `)
      : null;
    if (!sourceFiles) markAllFileHistoryFailure("SOURCE_SCHEMA_UNSUPPORTED");
    const insert = db.prepare(`
      INSERT OR IGNORE INTO sessions
      (id, external_id, provider, title, summary, initial_question, questions, last_action, next_action, cwd, repository, branch, source,
       status, started_at, updated_at, ended_at, end_reason, needs_review, imported)
      VALUES (?, ?, 'copilot', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'history-import', 'paused', ?, ?, ?, 'historical', 1, 1)
    `);
    const addImportEvent = db.prepare(`
      INSERT INTO events(session_id, type, detail, created_at)
      SELECT ?, 'history-import', 'Imported from existing Copilot CLI history', ?
      WHERE NOT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND type = 'history-import')
    `);
    let imported = 0;
    let skipped = 0;
    let fileSessions = 0;
    db.exec("BEGIN");
    try {
      for (const source of sourceSessions) {
        const fileRows = sourceFiles ? sourceFiles.all(source.id) : [];
        const hasFileEvidence = fileRows.some((row) => cleanHistoryFile(row));
        const checkpoint = latestCheckpoint?.get(source.id) || {};
        const turn = latestTurn?.get(source.id) || {};
        const questions = cleanSessionQuestions(allTurns?.all(source.id) || []);
        const initialQuestion = questions.find((question) => !isSkillAction(question)) || questions[0] || "";
        const rawTitle = checkpoint.title || source.summary || firstMeaningfulLine(turn.user_message);
        const summary = cleanText(checkpoint.overview, 3000) ||
          cleanText(source.summary && source.summary.length > 160 ? source.summary : "", 3000) ||
          cleanText(turn.assistant_response, 1200);
        const lastAction = cleanText(checkpoint.work_done, 1000) || cleanText(turn.assistant_response, 1000);
        const nextAction = cleanText(checkpoint.next_steps, 1000);
        const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(source.id);
        if (!existing && !cleanText(rawTitle, 500) && !summary && !lastAction && !source.cwd && !hasFileEvidence) {
          skipped++;
          continue;
        }
        const startedAt = parseTimestamp(source.created_at) || Date.now();
        const updatedAt = parseTimestamp(source.updated_at) || startedAt;
        if (!existing) {
          const title = historyTitle(rawTitle, source.cwd);
          const result = insert.run(
            source.id,
            source.id,
            title || suggestedTitle(source.cwd),
            summary,
            initialQuestion,
            JSON.stringify(questions),
            lastAction,
            nextAction,
            source.cwd || "",
            source.repository || "",
            source.branch || "",
            startedAt,
            updatedAt,
            updatedAt
          );
          if (result.changes) {
            imported++;
            addImportEvent.run(source.id, updatedAt, source.id);
            if (nextAction) {
              db.prepare(`
                INSERT INTO tasks(session_id, text, completed, position, created_at, status)
                VALUES (?, ?, 0, 0, ?, 'backlog')
              `).run(source.id, firstMeaningfulLine(nextAction).slice(0, 500), updatedAt);
            }
          }
        } else {
          skipped++;
          if (questions.length) {
            db.prepare("UPDATE sessions SET initial_question = ?, questions = ? WHERE id = ?")
              .run(initialQuestion, JSON.stringify(questions), source.id);
          }
        }
        if (sourceFiles) {
          if (replaceSessionFiles(source.id, fileRows, Date.now(), false)) fileSessions++;
        } else {
          markFileHistoryFailure(source.id, "SOURCE_SCHEMA_UNSUPPORTED");
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { imported, skipped, fileSessions, available: true, filesAvailable: Boolean(sourceFiles) };
  } catch (error) {
    console.error("Could not import Copilot history:", error.message);
    markAllFileHistoryFailure("SOURCE_DB_UNAVAILABLE");
    return { imported: 0, skipped: 0, fileSessions: 0, available: true, error: "SOURCE_DB_UNAVAILABLE" };
  } finally {
    history?.close();
  }
}

function syncSessionFiles(sessionId) {
  if (!existsSync(historyPath)) return markFileHistoryFailure(sessionId, "SOURCE_DB_UNAVAILABLE");
  let history;
  try {
    history = new DatabaseSync(historyPath, { readOnly: true });
    syncSessionQuestion(history, sessionId);
    const hasFiles = history.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_files'").get();
    if (!hasFiles) return markFileHistoryFailure(sessionId, "SOURCE_SCHEMA_UNSUPPORTED");
    const rows = history.prepare(`
      SELECT session_id, file_path, tool_name, turn_index, first_seen_at
      FROM session_files
      WHERE session_id = ?
      ORDER BY turn_index, first_seen_at, file_path
      LIMIT 10001
    `).all(sessionId);
    return replaceSessionFiles(sessionId, rows, Date.now());
  } catch {
    return markFileHistoryFailure(sessionId, "SOURCE_DB_UNAVAILABLE");
  } finally {
    history?.close();
  }
}

function syncSessionQuestion(history, sessionId) {
  const hasTurns = history.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turns'").get();
  if (!hasTurns) return;
  const rows = history.prepare(`
    SELECT user_message
    FROM turns
    WHERE session_id = ?
    ORDER BY turn_index
    LIMIT 100
  `).all(sessionId);
  const questions = cleanSessionQuestions(rows);
  if (questions.length) {
    const initialQuestion = questions.find((question) => !isSkillAction(question)) || questions[0];
    db.prepare("UPDATE sessions SET initial_question = ?, questions = ? WHERE id = ?")
      .run(initialQuestion, JSON.stringify(questions), sessionId);
  }
}

function cleanSessionQuestions(rows) {
  const seen = new Set();
  const questions = [];
  for (const row of rows) {
    const raw = typeof row?.user_message === "string" ? row.user_message : "";
    const skillMatch = raw.match(/<skill-context\s+name=["']([^"']+)["']/i);
    const skillAction = skillMatch ? `${humanizeSkillName(skillMatch[1])} skill was called.` : "";
    const withoutSystemContext = raw
      .replace(/<current_datetime>[\s\S]*?<\/current_datetime>/gi, "")
      .replace(/<system_reminder>[\s\S]*?<\/system_reminder>/gi, "")
      .replace(/<system_notification>[\s\S]*?<\/system_notification>/gi, "")
      .replace(/<skill-context[\s\S]*?<\/skill-context>/gi, "")
      .replace(/<working_directory_changed>[\s\S]*?<\/working_directory_changed>/gi, "");
    const text = skillAction || cleanText(withoutSystemContext, 2000);
    if (!text || text.startsWith("/")) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(text);
    if (questions.length >= 50) break;
  }
  return questions;
}

function humanizeSkillName(value) {
  return String(value || "")
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isSkillAction(value) {
  return String(value || "").endsWith(" skill was called.");
}

function replaceSessionFiles(sessionId, sourceRows, timestamp, useTransaction = true) {
  if (sourceRows.length > 10000) return markFileHistoryFailure(sessionId, "SOURCE_ROWS_TRUNCATED");
  const files = new Map();
  let invalidRows = 0;
  for (const row of sourceRows) {
    const file = cleanHistoryFile(row);
    if (!file) {
      invalidRows++;
      continue;
    }
    const existing = files.get(file.pathKey);
    if (!existing || (file.turnIndex ?? -1) >= (existing.turnIndex ?? -1)) files.set(file.pathKey, file);
  }
  if (invalidRows) return markFileHistoryFailure(sessionId, "SOURCE_ROWS_INVALID");
  const write = () => {
    db.prepare("DELETE FROM session_files WHERE session_id = ? AND source = 'history'").run(sessionId);
    const insert = db.prepare(`
      INSERT INTO session_files(session_id, file_path, path_key, tool_name, turn_index, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, 'history')
      ON CONFLICT(session_id, path_key) DO UPDATE SET
        file_path = excluded.file_path,
        tool_name = excluded.tool_name,
        turn_index = excluded.turn_index,
        first_seen_at = excluded.first_seen_at,
        source = CASE WHEN session_files.source = 'checkpoint' THEN 'checkpoint' ELSE 'history' END
    `);
    for (const file of files.values()) {
      insert.run(sessionId, file.filePath, file.pathKey, file.toolName, file.turnIndex, file.firstSeenAt);
    }
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM session_files WHERE session_id = ?").get(sessionId).count);
    db.prepare("UPDATE sessions SET files_status = ?, files_synced_at = ?, files_sync_error = '' WHERE id = ?")
      .run(count ? "current" : "empty", timestamp, sessionId);
  };
  if (!useTransaction) {
    write();
    return true;
  }
  db.exec("BEGIN");
  try {
    write();
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    markFileHistoryFailure(sessionId, "LOCAL_SYNC_FAILED");
    return false;
  }
}

function cleanCheckpointFiles(value, session) {
    if (!Array.isArray(value)) return null;
    const workspace = session.repository || session.cwd;
    const files = new Map();
    for (const item of value.slice(0, 100)) {
      const suppliedPath = typeof item === "string" ? item : item?.path;
      if (typeof suppliedPath !== "string" || !suppliedPath.trim()) continue;
      const filePath = !isAbsolute(suppliedPath) && workspace
        ? resolve(workspace, suppliedPath)
        : suppliedPath;
      const file = cleanHistoryFile({
        file_path: filePath,
        tool_name: typeof item === "object" ? item.toolName : "worked-on",
        turn_index: null,
        first_seen_at: Date.now()
      });
      if (file) files.set(file.pathKey, file);
    }
    return [...files.values()];
  }

function mergeCheckpointFiles(sessionId, files, timestamp) {
    const insert = db.prepare(`
      INSERT INTO session_files(session_id, file_path, path_key, tool_name, turn_index, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, 'checkpoint')
      ON CONFLICT(session_id, path_key) DO UPDATE SET
        file_path = excluded.file_path,
        tool_name = excluded.tool_name,
        first_seen_at = COALESCE(session_files.first_seen_at, excluded.first_seen_at),
        source = 'checkpoint'
    `);
    for (const file of files) {
      insert.run(sessionId, file.filePath, file.pathKey, file.toolName, file.turnIndex, file.firstSeenAt);
    }
    db.prepare("UPDATE sessions SET files_status = 'current', files_synced_at = ?, files_sync_error = '' WHERE id = ?")
      .run(timestamp, sessionId);
  }
function markFileHistoryFailure(sessionId, errorCode) {
  const files = db.prepare(`
    SELECT COUNT(*) AS count,
      SUM(CASE WHEN source = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoint_count
    FROM session_files WHERE session_id = ?
  `).get(sessionId);
  const count = Number(files?.count || 0);
  const checkpointCount = Number(files?.checkpoint_count || 0);
  db.prepare("UPDATE sessions SET files_status = ?, files_sync_error = ? WHERE id = ?")
    .run(checkpointCount ? "current" : count ? "stale" : "unavailable", errorCode, sessionId);
  return false;
}

function markAllFileHistoryFailure(errorCode) {
  db.prepare(`
    UPDATE sessions
    SET files_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM session_files sf WHERE sf.session_id = sessions.id AND sf.source = 'checkpoint'
      ) THEN 'current'
      WHEN EXISTS (SELECT 1 FROM session_files sf WHERE sf.session_id = sessions.id) THEN 'stale'
      ELSE 'unavailable'
    END,
    files_sync_error = ?
  `).run(errorCode);
}

function normalizeFileStatus(value) {
  return ["current", "empty", "stale", "unavailable"].includes(value) ? value : "unavailable";
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function historyTitle(value, cwd) {
  const text = cleanText(value, 500);
  if (!text) return suggestedTitle(cwd);
  const firstLine = firstMeaningfulLine(text);
  if (/^(Session File Path:|PromptRouter local preparation:|Environment:|Read [A-Z]:\\)/i.test(firstLine)) {
    return suggestedTitle(cwd);
  }
  return firstLine.slice(0, 120);
}

function firstMeaningfulLine(value) {
  if (typeof value !== "string") return "";
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function parseTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHistoryTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  return parseTimestamp(value);
}

function readSessionMetrics(sessionId, transcriptPath) {
  const eventsPath = transcriptPath && existsSync(transcriptPath)
    ? transcriptPath
    : join(homedir(), ".copilot", "session-state", sessionId, "events.jsonl");
  const empty = {
    aiCredits: null,
    currentTokens: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    contextLimit: null,
    model: "",
    contextTier: "",
    capturedAt: Date.now()
  };
  if (!existsSync(eventsPath)) return empty;
  try {
    let totalNanoAiu = null;
    let currentTokens = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let hasTokenUsage = false;
    let contextLimit = null;
    let model = "";
    let contextTier = "";
    for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "session.usage_checkpoint" && Number.isFinite(event.data?.totalNanoAiu)) {
        totalNanoAiu = event.data.totalNanoAiu;
      }
      if (event.type === "model.model_call_success" && event.data?.responseUsage) {
        const usage = event.data.responseUsage;
        const promptTokens = Number(usage.prompt_tokens);
        const completionTokens = Number(usage.completion_tokens);
        const callTotal = Number(usage.total_tokens);
        if (Number.isFinite(promptTokens) || Number.isFinite(completionTokens) || Number.isFinite(callTotal)) {
          if (Number.isFinite(promptTokens)) inputTokens += promptTokens;
          if (Number.isFinite(completionTokens)) outputTokens += completionTokens;
          totalTokens += Number.isFinite(callTotal)
            ? callTotal
            : (Number.isFinite(promptTokens) ? promptTokens : 0) + (Number.isFinite(completionTokens) ? completionTokens : 0);
          hasTokenUsage = true;
        }
      }
      if (event.type === "session.shutdown") {
        if (Number.isFinite(event.data?.totalNanoAiu)) totalNanoAiu = event.data.totalNanoAiu;
        if (Number.isFinite(event.data?.currentTokens)) currentTokens = event.data.currentTokens;
        if (event.data?.currentModel) model = event.data.currentModel;
      }
      if (event.type === "session.resume") {
        if (event.data?.selectedModel) model = event.data.selectedModel;
        if (event.data?.contextTier) contextTier = event.data.contextTier;
      }
      if (event.type === "session.model_change") {
        if (event.data?.newModel) model = event.data.newModel;
        if (event.data?.contextTier) contextTier = event.data.contextTier;
      }
      const limit = findNumericMetric(event.data, "responseTokenLimit");
      if (limit) contextLimit = limit;
    }
    return {
      aiCredits: totalNanoAiu === null ? null : totalNanoAiu / 1_000_000_000,
      currentTokens,
      inputTokens: hasTokenUsage ? inputTokens : null,
      outputTokens: hasTokenUsage ? outputTokens : null,
      totalTokens: hasTokenUsage ? totalTokens : null,
      contextLimit,
      model,
      contextTier,
      capturedAt: Date.now()
    };
  } catch (error) {
    console.error(`Could not read metrics for session ${sessionId}:`, error.message);
    return empty;
  }
}

function findNumericMetric(value, key) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value[key])) return value[key];
  for (const child of Object.values(value)) {
    const found = findNumericMetric(child, key);
    if (found !== null) return found;
  }
  return null;
}

function normalizeTaskStatus(value) {
  return ["backlog", "next", "in_progress", "blocked", "done"].includes(value) ? value : "next";
}

function emptyBoardCounts() {
  return { backlog: 0, next: 0, in_progress: 0, blocked: 0, done: 0 };
}

function normalizeWorkItemType(value) {
  return ["Epic", "Feature", "PBI", "Task", "Bug"].includes(value) ? value : "PBI";
}

function parseAdoWorkItemUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const match = url.pathname.match(/\/_workitems\/edit\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return { id: Number(match[1]), url: url.toString() };
  } catch {
    return null;
  }
}

function isAllowedRequest(request) {
  const host = request.headers.host || "";
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`, "i").test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === baseUrl || origin === `http://localhost:${port}`;
}

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
