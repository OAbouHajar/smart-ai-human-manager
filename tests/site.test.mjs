import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("landing page presents the project and AI-first installation path", async () => {
  const [html, script, workflow] = await Promise.all([
    readFile(new URL("../site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/app.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8")
  ]);

  assert.match(html, /Local-first context for AI-assisted work/);
  assert.match(html, /Where AI sessions become shared work/);
  assert.match(html, /tasks, decisions, progress, evidence/);
  assert.match(html, /Your AI chat is not the project/);
  assert.match(html, /One board/);
  assert.match(html, /See what the result really took/);
  assert.match(html, /Stop anywhere/);
  assert.match(html, /Let your AI set it up/);
  assert.match(html, /id="copyHeroPrompt"/);
  assert.match(html, /Install with AI/);
  assert.match(html, /Watch the 2-minute demo/);
  assert.match(html, /id="demo"/);
  assert.match(html, /assets\/context-workspace-demo\.mp4/);
  assert.match(html, /assets\/context-workspace-demo-poster\.jpg/);
  assert.match(html, /id="installPrompt"/);
  assert.match(html, /Copilot/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Google Gemini/);
  assert.match(html, /screenshots\/board-screenshot\.png/);
  assert.match(html, /assets\/context-workspace-logo\.png/);
  assert.match(html, /Existing `\/sham:\*` commands remain available/);
  assert.match(script, /copyHeroPrompt/);
  assert.match(script, /copyPrompt/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /questions-screenshot\.png/);
  assert.match(workflow, /board-screenshot\.png/);
  assert.match(workflow, /context-workspace-logo\.png/);
  assert.match(workflow, /cp -R site\/assets\/\. _site\/assets\//);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});

test("dashboard exposes shared project and ticket UI", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="projectShareStatus"/);
  assert.match(script, /\/cw:project-share/);
  assert.match(script, /\/cw:project-push/);
  assert.match(script, /\/cw:project-pull/);
  assert.match(script, /task\.ticketId/);
  assert.match(script, /task\.description/);
  assert.match(script, /project\.sharing/);
});
