const installPrompt = document.querySelector("#installPrompt");
const promptAgentName = document.querySelector("#promptAgentName");
const promptAgentDetail = document.querySelector("#promptAgentDetail");
const agentChoices = [...document.querySelectorAll(".agent-choice")];
const kanbanImageDialog = document.querySelector("#kanbanImageDialog");
const openKanbanImage = document.querySelector("#openKanbanImage");
const closeKanbanImage = document.querySelector("#closeKanbanImage");
const themeToggle = document.querySelector("#themeToggle");
const demoVideoDialog = document.querySelector("#demoVideoDialog");
const openDemoVideo = document.querySelector("#openDemoVideo");
const closeDemoVideo = document.querySelector("#closeDemoVideo");
const demoVideo = document.querySelector("#demoVideo");
const interactiveDemoDialog = document.querySelector("#interactiveDemoDialog");
const openInteractiveDemo = document.querySelector("#openInteractiveDemo");
const closeInteractiveDemo = document.querySelector("#closeInteractiveDemo");
const copyButtons = [
  document.querySelector("#copyHeroPrompt"),
  document.querySelector("#copyPrompt"),
].filter(Boolean);

openKanbanImage.addEventListener("click", () => kanbanImageDialog.showModal());
closeKanbanImage.addEventListener("click", () => kanbanImageDialog.close());
kanbanImageDialog.addEventListener("click", (event) => {
  if (event.target === kanbanImageDialog) kanbanImageDialog.close();
});

function updateThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.querySelector("strong").textContent = dark ? "Light" : "Dark";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#10231d" : "#faf9f6";
}

themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("context-workspace-theme", nextTheme);
  updateThemeToggle();

  openDemoVideo.addEventListener("click", () => demoVideoDialog.showModal());
  closeDemoVideo.addEventListener("click", () => {
    demoVideo.pause();
    demoVideoDialog.close();
  });
  demoVideoDialog.addEventListener("click", (event) => {
    if (event.target !== demoVideoDialog) return;
    demoVideo.pause();
    demoVideoDialog.close();
  });
  demoVideoDialog.addEventListener("close", () => demoVideo.pause());

  openInteractiveDemo.addEventListener("click", () => interactiveDemoDialog.showModal());
  closeInteractiveDemo.addEventListener("click", () => interactiveDemoDialog.close());
  interactiveDemoDialog.addEventListener("click", (event) => {
    if (event.target === interactiveDemoDialog) interactiveDemoDialog.close();
  });
});
updateThemeToggle();

const agentPrompts = {
  copilot: {
    name: "GitHub Copilot installation prompt",
    detail: "Plugin and lifecycle hooks",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine for GitHub Copilot CLI.

Detect the operating system and verify git, Node.js 22.13+, GitHub Copilot CLI, and PowerShell 7 on Windows. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data and unrelated Copilot settings. Configure the local Copilot plugin and lifecycle hooks. Verify http://127.0.0.1:43120/api/health returns ok: true, confirm GitHub Copilot is shown as configured, open the dashboard, and tell me whether Copilot must be restarted.`,
  },
  scout: {
    name: "Microsoft Scout installation prompt",
    detail: "Managed Scout skill",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine for Microsoft Scout.

Detect the operating system and verify git, Node.js 22.13+, Microsoft Scout, and PowerShell 7 on Windows. Detect Scout from PATH or its installed application location. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data, Scout conversations, memories, skills, and unrelated Copilot settings. Install only the managed Context Workspace Scout skill under ~/.copilot/skills/context-workspace-scout. Verify the local health endpoint returns ok: true, confirm Microsoft Scout is shown as configured, open the dashboard, and tell me to start a new Scout conversation and say "Track this conversation with Context Workspace."`,
  },
  claude: {
    name: "Claude Code installation prompt",
    detail: "Claude lifecycle hooks",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine for Claude Code.

Detect the operating system and verify git, Node.js 22.13+, Claude Code, and PowerShell 7 on Windows. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data and unrelated Claude settings and hooks. Merge Context Workspace lifecycle handlers into Claude's settings without replacing existing entries. Verify the local health endpoint returns ok: true, confirm Claude Code is shown as configured, open the dashboard, and tell me to restart Claude Code so the hooks load.`,
  },
  codex: {
    name: "OpenAI Codex installation prompt",
    detail: "Codex lifecycle hooks",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine for OpenAI Codex CLI.

Detect the operating system and verify git, Node.js 22.13+, Codex CLI, and PowerShell 7 on Windows. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data and unrelated Codex configuration and hooks. Merge Context Workspace lifecycle handlers into the Codex hooks configuration without replacing existing entries. Verify the local health endpoint returns ok: true, confirm Codex CLI is shown as configured, open the dashboard, and tell me to restart Codex so the hooks load.`,
  },
  gemini: {
    name: "Google Gemini installation prompt",
    detail: "Gemini lifecycle hooks",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine for Google Gemini CLI.

Detect the operating system and verify git, Node.js 22.13+, Gemini CLI, and PowerShell 7 on Windows. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data and unrelated Gemini settings and hooks. Merge Context Workspace lifecycle handlers into Gemini's settings without replacing existing entries. Verify the local health endpoint returns ok: true, confirm Gemini CLI is shown as configured, open the dashboard, and tell me to restart Gemini so the hooks load.`,
  },
  generic: {
    name: "General AI agent installation prompt",
    detail: "Detect every supported provider",
    prompt: `Install Context Workspace from https://github.com/OAbouHajar/smart-ai-human-manager on this machine.

Detect the operating system and verify git, Node.js 22.13+, at least one supported AI agent, and PowerShell 7 on Windows. Clone the latest main branch into a temporary directory, read the README and matching installer, then run the installer with its no-open option.

Preserve existing Context Workspace data and unrelated AI agent settings. Configure every detected supported provider without replacing existing hooks, skills, or settings. Verify http://127.0.0.1:43120/api/health returns ok: true, report every configured provider, open the dashboard, and list any restart or trust action still required.`,
  },
};

agentChoices.forEach((choice, index) => {
  choice.addEventListener("click", () => selectAgent(choice.dataset.agent));
  choice.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? agentChoices.length - 1
        : (index + direction + agentChoices.length) % agentChoices.length;
    agentChoices[nextIndex].focus();
    selectAgent(agentChoices[nextIndex].dataset.agent);
  });
});

function selectAgent(agent) {
  const content = agentPrompts[agent];
  if (!content) return;
  agentChoices.forEach((choice) => {
    const selected = choice.dataset.agent === agent;
    choice.classList.toggle("selected", selected);
    choice.setAttribute("aria-selected", String(selected));
  });
  promptAgentName.textContent = content.name;
  promptAgentDetail.textContent = content.detail;
  installPrompt.textContent = content.prompt;
}

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const label = button.querySelector(".copy-label");
    const original = label.textContent;
    try {
      await navigator.clipboard.writeText(installPrompt.textContent.trim());
      label.textContent = "Copied";
    } catch {
      label.textContent = "Select prompt below";
      installPrompt.closest(".prompt").scrollIntoView({ behavior: "smooth" });
    }
    window.setTimeout(() => {
      label.textContent = original;
    }, 1800);
  });
});
