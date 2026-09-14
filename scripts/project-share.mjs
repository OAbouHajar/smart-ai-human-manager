import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const options = parseArguments(process.argv.slice(2));
const action = options._[0];
const baseUrl = String(options["base-url"] || "http://127.0.0.1:43120").replace(/\/$/, "");
const sessionId = String(options["session-id"] || "");
const cwd = String(options.cwd || process.cwd());
const remote = String(options.remote || "origin");
const defaultBranch = "context-workspace/shared-projects";
const legacyBranch = "sham/shared-projects";
let branch = String(options.branch || defaultBranch);
const branchExplicit = Boolean(options.branch);

if (!["push", "pull", "list"].includes(action)) {
  fail("Usage: project-share.mjs <push|pull|list> --session-id <id> [--project-id <id>]");
}
if (!/^[A-Za-z0-9._-]+$/.test(remote)) fail("Invalid Git remote name");
if (!validBranch(branch)) fail("Invalid Git branch name");

const repository = git(cwd, ["rev-parse", "--show-toplevel"]);

if (action === "push") {
  if (!sessionId) fail("--session-id is required for push");
  const session = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!session.projectId) fail("The current session is not linked to a Context Workspace project");
  const snapshot = await api(`/api/projects/${encodeURIComponent(session.projectId)}/share`);
  const relativePath = `projects/${snapshot.project.id}/project.json`;
  await publishSnapshot(snapshot, relativePath);
  await api(`/api/projects/${encodeURIComponent(snapshot.project.id)}/share`, {
    method: "PATCH",
    body: {
      remote,
      branch,
      path: relativePath,
      pushedAt: Date.now(),
      revision: snapshot.revision
    }
  });
  console.log(JSON.stringify({
    ok: true,
    action: "push",
    projectId: snapshot.project.id,
    projectTitle: snapshot.project.title,
    branch,
    path: relativePath,
    ticketCount: snapshot.tickets.length
  }));
}

if (action === "list") {
  const projects = await listSharedProjects();
  console.log(JSON.stringify({ ok: true, action: "list", branch, projects }));
}

if (action === "pull") {
  if (!sessionId) fail("--session-id is required for pull");
  const session = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const projectId = String(options["project-id"] || session.projectId || "");
  if (!projectId) {
    const projects = await listSharedProjects();
    console.log(JSON.stringify({ ok: false, selectionRequired: true, branch, projects }));
    process.exit(2);
  }
  const found = await findSharedProject(projectId);
  const entry = found?.entry;
  if (found) branch = found.branch;
  if (!entry) fail(`Project ${projectId} is not present on ${remote}/${branch}`);
  if (!/^[A-Za-z0-9._-]+$/.test(projectId) || projectId.includes("..")) fail("Invalid shared project ID");
  if (session.projectId && session.projectId !== projectId) {
    fail(`The current session is already linked to project ${session.projectId}`);
  }
  const relativePath = `projects/${projectId}/project.json`;
  const snapshot = JSON.parse(git(repository, [
    "show",
    `refs/remotes/${remote}/${branch}:${relativePath}`
  ]));
  const imported = await api("/api/shared-projects/import", {
    method: "POST",
    body: { snapshot, remote, branch, path: relativePath }
  });
  if (!session.projectId) {
    await api(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
      method: "POST",
      body: { sessionId, autoWrap: false, requireUnassigned: true }
    });
  }
  console.log(JSON.stringify({
    ok: true,
    action: "pull",
    projectId,
    projectTitle: imported.project.title,
    branch,
    ticketCount: snapshot.tickets.length
  }));
}

async function publishSnapshot(snapshot, relativePath) {
  const temporaryPath = await mkdtemp(join(tmpdir(), "context-workspace-share-"));
  let worktreeAdded = false;
  let temporaryBranch = "";
  const remoteExists = hasRemoteBranch();
  try {
    if (remoteExists) {
      fetchSharedBranch();
      git(repository, ["worktree", "add", "--detach", temporaryPath, `refs/remotes/${remote}/${branch}`]);
      worktreeAdded = true;
    } else {
      git(repository, ["worktree", "add", "--detach", temporaryPath, "HEAD"]);
      worktreeAdded = true;
      temporaryBranch = `context-workspace-share-${Date.now()}`;
      git(temporaryPath, ["switch", "--orphan", temporaryBranch]);
      git(temporaryPath, ["rm", "-r", "-f", "--ignore-unmatch", "."]);
    }
    const indexPath = join(temporaryPath, "index.json");
    let index = { schemaVersion: 1, projects: [] };
    try {
      index = JSON.parse(await readFile(indexPath, "utf8"));
    } catch {
    }
    const entry = {
      id: snapshot.project.id,
      title: snapshot.project.title,
      status: snapshot.project.status,
      path: relativePath,
      revision: snapshot.revision
    };
    index.projects = [
      ...(Array.isArray(index.projects) ? index.projects : []).filter((project) => project.id !== entry.id),
      entry
    ].sort((left, right) => left.title.localeCompare(right.title));
    await mkdir(join(temporaryPath, "projects", snapshot.project.id), { recursive: true });
    await writeFile(
      join(temporaryPath, ...relativePath.split("/")),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8"
    );
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    git(temporaryPath, ["add", "index.json", relativePath]);
    if (!hasStagedChanges(temporaryPath)) return;
    requireGitIdentity(temporaryPath);
    git(temporaryPath, ["commit", "-m", `Update shared project ${snapshot.project.id}`]);
    git(temporaryPath, ["push", remote, `HEAD:refs/heads/${branch}`]);
  } finally {
    if (worktreeAdded) {
      try {
        git(repository, ["worktree", "remove", "--force", temporaryPath]);
      } catch {
      }
    }
    if (temporaryBranch) {
      try {
        git(repository, ["branch", "-D", temporaryBranch]);
      } catch {
      }
    }
  }
}

async function listSharedProjects() {
  if (branchExplicit) {
    const index = await readSharedIndex(branch);
    return sharedProjects(index, branch);
  }
  const [current, legacy] = await Promise.all([
    readSharedIndex(defaultBranch),
    readSharedIndex(legacyBranch)
  ]);
  const projects = new Map();
  for (const project of sharedProjects(legacy, legacyBranch)) projects.set(project.id, project);
  for (const project of sharedProjects(current, defaultBranch)) projects.set(project.id, project);
  return [...projects.values()].sort((left, right) => left.title.localeCompare(right.title));
}

async function findSharedProject(projectId) {
  const branches = branchExplicit ? [branch] : [defaultBranch, legacyBranch];
  for (const candidate of branches) {
    const index = await readSharedIndex(candidate);
    const entry = (index.projects || []).find((project) => project.id === projectId);
    if (entry) return { branch: candidate, entry };
  }
  return null;
}

async function readSharedIndex(targetBranch) {
  if (!hasRemoteBranch(targetBranch)) return { schemaVersion: 1, projects: [] };
  fetchSharedBranch(targetBranch);
  return JSON.parse(git(repository, ["show", `refs/remotes/${remote}/${targetBranch}:index.json`]));
}

function sharedProjects(index, sourceBranch) {
  return (Array.isArray(index.projects) ? index.projects : []).map((project) => ({
    ...project,
    sourceBranch
  }));
}

function hasRemoteBranch(targetBranch = branch) {
  const result = spawnSync("git", [
    "-C", repository, "ls-remote", "--exit-code", "--heads", remote, `refs/heads/${targetBranch}`
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(result.stderr.trim() || `Could not access Git remote ${remote}`);
}

function fetchSharedBranch(targetBranch = branch) {
  git(repository, [
    "fetch",
    "--no-tags",
    remote,
    `+refs/heads/${targetBranch}:refs/remotes/${remote}/${targetBranch}`
  ]);
}

function hasStagedChanges(directory) {
  try {
    git(directory, ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

function requireGitIdentity(directory) {
  const name = git(directory, ["config", "user.name"]);
  const email = git(directory, ["config", "user.email"]);
  if (!name || !email) fail("Configure git user.name and user.email before sharing a project");
}

async function api(path, request = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: request.method || "GET",
    headers: request.body ? { "content-type": "application/json" } : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Context Workspace API returned ${response.status}`);
  return result;
}

function git(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}

function parseArguments(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}

function validBranch(value) {
  return Boolean(value) &&
    !value.startsWith("-") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !/[\s~^:?*\[]/.test(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
