import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

const providers = new Set(["copilot", "claude", "codex", "gemini"]);
const provider = providers.has(process.argv[2]) ? process.argv[2] : "copilot";
const eventName = providers.has(process.argv[2]) ? process.argv[3] : process.argv[2];
const input = await readStdin();
const rawPayload = input ? JSON.parse(input) : {};
const payload = normalizePayload(rawPayload);
const url = process.env.COPILOT_SESSION_HUB_URL || "http://127.0.0.1:43120";

let response = await postEvent();
if (!response && !updateIsInstalling()) {
  startServer();
  await delay(700);
  response = await postEvent();
}

if (!response) {
  await queueEvent();
  process.stdout.write("{}");
  process.exit(0);
}

if (eventName === "sessionStart") {
  const body = await response.json();
  const updateNotice = body.update?.updateAvailable
    ? ` AI Session Hub ${body.update.latestVersion} is available (installed: ${body.update.currentVersion}). ` +
      `Mention this once at a natural stopping point. Copilot users can run /sam-update. ` +
      `For a natural-language update request, confirm with the user, then POST ${url}/api/update/install with ` +
      `{"sessionId":${JSON.stringify(body.sessionId)}} and poll ${url}/api/update/job until waiting_for_exit or failed. ` +
      `Never run or show a separate installer command.`
    : "";
  const updateResult = ["succeeded", "succeeded_with_warnings"].includes(body.updateJob?.state)
    ? ` AI Session Hub updated successfully from ${body.updateJob.fromVersion} to ${body.updateJob.toVersion}. ` +
      `${body.updateJob.state === "succeeded_with_warnings" ? `Some integrations need attention: ${body.updateJob.error} ` : ""}Tell the user once.`
    : body.updateJob?.state === "failed"
      ? ` The scheduled AI Session Hub update failed: ${body.updateJob.error} Tell the user once and direct them to the dashboard.`
      : "";
  const projectContext = body.project
    ? `This session belongs to the "${body.project.title}" project. Make the checkpoint describe how this session changed that project. `
    : "This session is unassigned. Save its checkpoint independently and do not attach it to a project automatically. The user can run /sam-project to create or choose one. ";
  const context =
    `AI Session Hub is tracking this ${providerName(provider)} session. Session ID: ${body.sessionId}. ` +
    `Checkpoint endpoint: ${url}/api/sessions/${encodeURIComponent(body.sessionId)}/checkpoint. ` +
    `Dashboard: ${url}. When the user asks to wrap, checkpoint, pause, or hand off, save a structured checkpoint there. ` +
    projectContext +
    `Include unfinished work in tasks, verified completed work in completedTasks, ` +
    `and a files array of {path,toolName} entries for files actually viewed, created, or edited.` +
    updateNotice +
    updateResult;
  process.stdout.write(JSON.stringify(sessionStartOutput(context)));
} else {
  process.stdout.write("{}");
}

async function postEvent() {
  try {
    const response = await fetch(`${url}/api/hooks/${provider}/${eventName}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500)
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

function startServer() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(process.execPath, [join(root, "server", "server.mjs")], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
}

function updateIsInstalling() {
  try {
    const statusPath = join(defaultDataDir(), "update", "status.json");
    return JSON.parse(readFileSync(statusPath, "utf8")).state === "installing";
  } catch {
    return false;
  }
}

async function queueEvent() {
  const dataDir = defaultDataDir();
  const queuePath = join(dataDir, "pending-events.jsonl");
  await mkdir(dataDir, { recursive: true });
  await appendFile(queuePath, `${JSON.stringify({ provider, eventName, payload })}\n`, "utf8");
}

function defaultDataDir() {
  if (process.env.COPILOT_SESSION_HUB_DATA) return process.env.COPILOT_SESSION_HUB_DATA;
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "CopilotSessionHub");
  if (platform() === "darwin") {
    const current = join(homedir(), "Library", "Application Support", "CopilotSessionHub");
    const legacy = join(homedir(), ".copilot-session-hub");
    return existsSync(join(legacy, "sessions.db")) && !existsSync(join(current, "sessions.db"))
      ? legacy
      : current;
  }
  return join(homedir(), ".copilot-session-hub");
}

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizePayload(value) {
  const timestamp = typeof value.timestamp === "string"
    ? Date.parse(value.timestamp)
    : Number(value.timestamp);
  return {
    ...value,
    sessionId: value.sessionId || value.session_id,
    transcriptPath: value.transcriptPath || value.transcript_path || "",
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now()
  };
}

function sessionStartOutput(context) {
  if (provider === "copilot") return { additionalContext: context };
  return {
    hookSpecificOutput: {
      hookEventName: rawPayload.hook_event_name || "SessionStart",
      additionalContext: context
    }
  };
}

function providerName(value) {
  return {
    copilot: "GitHub Copilot CLI",
    claude: "Claude Code",
    codex: "Codex CLI",
    gemini: "Gemini CLI"
  }[value] || value;
}
