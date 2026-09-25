import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("landing page presents the AI project value and installation path", async () => {
  const [html, script, workflow, styles, demoHtml, demoScript] = await Promise.all([
    readFile(new URL("../site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/app.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../site/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../site/dashboard-demo.html", import.meta.url), "utf8"),
    readFile(new URL("../site/dashboard-demo.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /Where AI work/);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /become shared projects/);
  assert.doesNotMatch(html, /Private conversations\. Shared project context\. Human control\./);
  assert.match(html, /people and agents can share, manage, and measure/);
  assert.match(html, /assets\/before-after\.png/);
  assert.match(html, /Use fewer tokens/);
  assert.match(html, /Share context safely/);
  assert.match(html, /Keep the team aligned/);
  assert.match(html, /class="supported-marks"/);
  assert.match(html, /class="working-with">Working with/);
  assert.doesNotMatch(html, /class="product-name"/);
  assert.match(html, /Turn every AI session into work humans can see and steer/);
  assert.match(html, /Scrum masters and project leads/);
  assert.match(html, /assets\/project-kanban\.png/);
  assert.match(html, /id="openKanbanImage"/);
  assert.match(html, /id="kanbanImageDialog"/);
  assert.match(html, /id="openDemoVideo"/);
  assert.match(html, /id="demoVideoDialog"/);
  assert.match(html, /dashboard-demo\.html/);
  assert.match(html, /Workflow status/);
  assert.match(html, /Human and agent ownership/);
  assert.match(html, /Model recommendations/);
  assert.match(html, /Ticket details and evidence/);
  assert.match(html, /Project visibility/);
  assert.doesNotMatch(html, /2nd place|Hackathon project/);
  assert.match(html, /id="copyHeroPrompt"/);
  assert.match(html, /Install with the AI agent you already use/);
  assert.match(html, /assets\/context-workspace-demo\.mp4/);
  assert.match(html, /id="installPrompt"/);
  assert.match(html, /id="themeToggle"/);
  assert.match(html, /data-agent="copilot"/);
  assert.match(html, /data-agent="scout"/);
  assert.match(html, /data-agent="claude"/);
  assert.match(html, /data-agent="codex"/);
  assert.match(html, /data-agent="gemini"/);
  assert.match(html, /Copilot/);
  assert.match(html, /Scout/);
  assert.match(html, /Claude/);
  assert.match(html, /Codex/);
  assert.match(html, /Gemini/);
  assert.match(html, /assets\/context-workspace-logo\.png/);
  assert.match(html, /assets\/providers\/github-copilot\.svg/);
  assert.match(html, /assets\/providers\/microsoft-scout\.png/);
  assert.match(html, /assets\/providers\/anthropic\.svg/);
  assert.match(html, /assets\/providers\/openai\.svg/);
  assert.match(html, /assets\/providers\/google-gemini\.svg/);
  assert.match(script, /copyHeroPrompt/);
  assert.match(script, /copyPrompt/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /agentPrompts/);
  assert.match(script, /showModal/);
  assert.match(script, /demoVideo\.pause/);
  assert.match(script, /context-workspace-theme/);
  assert.match(script, /updateThemeToggle/);
  assert.match(script, /selectAgent/);
  assert.match(script, /Managed Scout skill/);
  assert.match(script, /ArrowRight/);
  assert.match(styles, /--green:/);
  assert.match(styles, /data-theme="dark"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /background-clip:\s*text/);
  assert.doesNotMatch(styles, /border-left:\s*[2-9]/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /questions-screenshot\.png/);
  assert.match(workflow, /board-screenshot\.png/);
  assert.match(workflow, /context-workspace-logo\.png/);
  assert.match(workflow, /cp -R site\/assets\/\. _site\/assets\//);
  assert.match(workflow, /cp site\/\*\.html site\/\*\.css site\/\*\.js _site\//);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
  assert.match(demoHtml, /Interactive product demo/);
  assert.match(demoHtml, /Backlog/);
  assert.match(demoHtml, /In progress/);
  assert.match(demoHtml, /Project insights/);
  assert.match(demoHtml, /Start guided tour/);
  assert.match(demoHtml, /class="demo-sidebar"/);
  assert.match(demoHtml, /Shared projects/);
  assert.match(demoHtml, /Private projects/);
  assert.match(demoHtml, /Session inbox/);
  assert.match(demoHtml, /Local session history/);
  assert.match(demoScript, /taskData/);
  assert.match(demoScript, /tourSteps/);
  assert.match(demoScript, /showTourStep/);
  assert.match(demoScript, /showView/);
  assert.match(demoScript, /projectFilters/);
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
