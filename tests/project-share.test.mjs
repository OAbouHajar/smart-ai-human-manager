import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("pushes and pulls sanitized project state through a dedicated Git branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-workspace-share-test-"));
  const repository = join(root, "source");
  const remote = join(root, "remote.git");
  git(root, ["init", repository]);
  git(repository, ["config", "user.name", "Context Workspace Test"]);
  git(repository, ["config", "user.email", "context-workspace-test@example.invalid"]);
  await writeFile(join(repository, "README.md"), "test\n", "utf8");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-m", "Initial commit"]);
  git(root, ["init", "--bare", remote]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "HEAD:main"]);

  const snapshot = {
    schemaVersion: 1,
    revision: 42,
    project: {
      id: "project-1",
      title: "Shared project",
      description: "Share work, not conversations.",
      status: "active",
      ticketPrefix: "SP"
    },
    tickets: [{
      ticketId: "SP-1",
      title: "Publish the board",
      description: "Write only approved fields.",
      status: "in_progress",
      owner: "Osama",
      updatedAt: 42
    }]
  };
  let imported = null;
  let linked = null;
  let sharing = null;
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    if (request.method === "GET" && request.url === "/api/sessions/source-session") {
      return send(response, 200, { projectId: "project-1" });
    }
    if (request.method === "GET" && request.url === "/api/sessions/target-session") {
      return send(response, 200, { projectId: "" });
    }
    if (request.method === "GET" && request.url === "/api/sessions/legacy-session") {
      return send(response, 200, { projectId: "" });
    }
    if (request.method === "GET" && request.url === "/api/projects/project-1/share") {
      return send(response, 200, snapshot);
    }
    if (request.method === "PATCH" && request.url === "/api/projects/project-1/share") {
      sharing = body;
      return send(response, 200, { sharing: { enabled: true } });
    }
    if (request.method === "POST" && request.url === "/api/shared-projects/import") {
      imported = body;
      return send(response, 201, { project: { title: snapshot.project.title } });
    }
    if (request.method === "POST" && /^\/api\/projects\/[^/]+\/sessions$/.test(request.url)) {
      linked = body;
      return send(response, 200, { ok: true });
    }
    return send(response, 404, { error: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const script = fileURLToPath(new URL("../scripts/project-share.mjs", import.meta.url));

  try {
    const pushedResult = await execFileAsync(process.execPath, [
      script, "push",
      "--base-url", baseUrl,
      "--session-id", "source-session",
      "--cwd", repository
    ], { encoding: "utf8" });
    const pushed = JSON.parse(pushedResult.stdout);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.branch, "context-workspace/shared-projects");
    assert.equal(sharing.path, "projects/project-1/project.json");
    const stored = JSON.parse(git(root, [
      `--git-dir=${remote}`,
      "show",
      "refs/heads/context-workspace/shared-projects:projects/project-1/project.json"
    ]));
    assert.deepEqual(stored, snapshot);
    assert.equal(git(root, [
      `--git-dir=${remote}`,
      "show",
      "refs/heads/context-workspace/shared-projects:README.md"
    ], true), "");
    assert.equal(git(repository, ["branch", "--list", "context-workspace-share-*"]), "");

    const pulledResult = await execFileAsync(process.execPath, [
      script, "pull",
      "--base-url", baseUrl,
      "--session-id", "target-session",
      "--project-id", "project-1",
      "--cwd", repository
    ], { encoding: "utf8" });
    const pulled = JSON.parse(pulledResult.stdout);
    assert.equal(pulled.ok, true);
    assert.deepEqual(imported.snapshot, snapshot);
    assert.deepEqual(linked, {
      sessionId: "target-session",
      autoWrap: false,
      requireUnassigned: true
    });

    const legacySnapshot = {
      ...snapshot,
      revision: 7,
      project: { ...snapshot.project, id: "legacy-project", title: "Legacy shared project" },
      tickets: [{ ...snapshot.tickets[0], ticketId: "LP-1" }]
    };
    git(repository, ["switch", "--orphan", "legacy-share-test"]);
    git(repository, ["rm", "-r", "-f", "--ignore-unmatch", "."]);
    await mkdir(join(repository, "projects", "legacy-project"), { recursive: true });
    await writeFile(join(repository, "projects", "legacy-project", "project.json"), `${JSON.stringify(legacySnapshot)}\n`);
    await writeFile(join(repository, "index.json"), `${JSON.stringify({
      schemaVersion: 1,
      projects: [{
        id: "legacy-project",
        title: "Legacy shared project",
        status: "active",
        path: "projects/legacy-project/project.json",
        revision: 7
      }]
    })}\n`);
    git(repository, ["add", "index.json", "projects/legacy-project/project.json"]);
    git(repository, ["commit", "-m", "Add legacy shared project"]);
    git(repository, ["push", "origin", "HEAD:refs/heads/sham/shared-projects"]);
    git(repository, ["switch", "main"]);

    const listedResult = await execFileAsync(process.execPath, [
      script, "list",
      "--base-url", baseUrl,
      "--cwd", repository
    ], { encoding: "utf8" });
    const listed = JSON.parse(listedResult.stdout);
    assert.deepEqual(listed.projects.map(({ id, sourceBranch }) => ({ id, sourceBranch })), [
      { id: "legacy-project", sourceBranch: "sham/shared-projects" },
      { id: "project-1", sourceBranch: "context-workspace/shared-projects" }
    ]);

    const legacyPullResult = await execFileAsync(process.execPath, [
      script, "pull",
      "--base-url", baseUrl,
      "--session-id", "legacy-session",
      "--project-id", "legacy-project",
      "--cwd", repository
    ], { encoding: "utf8" });
    const legacyPull = JSON.parse(legacyPullResult.stdout);
    assert.equal(legacyPull.branch, "sham/shared-projects");
    assert.deepEqual(imported, {
      snapshot: legacySnapshot,
      remote: "origin",
      branch: "sham/shared-projects",
      path: "projects/legacy-project/project.json"
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function git(directory, args, allowFailure = false) {
  try {
    return execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
