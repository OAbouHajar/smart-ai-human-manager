const taskData = {
  "BCPWA-1": { title: "Build the core calculator", description: "Implemented arithmetic, decimals, parentheses, reset, and keyboard input.", owner: "Osama", agent: "GitHub Copilot CLI", model: "GPT-5.6 Sol Fast", status: "Done", evidence: "6 files, 18 tests, checkpoint approved" },
  "BCPWA-2": { title: "Implement scientific mode", description: "Support powers, roots, trigonometric functions, logarithms, constants, and angle selection.", owner: "Osama", agent: "GitHub Copilot CLI", model: "GPT-5.6 Sol", status: "Next", evidence: "Task refined, acceptance criteria saved, 3 related files" },
  "BCPWA-3": { title: "Complete export and local persistence", description: "Add calculation history, memory controls, result copying, and durable local state.", owner: "Unassigned", agent: "GitHub Copilot CLI", model: "GPT-5.6 Sol Fast", status: "Backlog", evidence: "2 decisions, no implementation yet" },
  "BCPWA-4": { title: "Harden quality and accessibility", description: "Add automated checks, keyboard navigation, and screen-reader labels.", owner: "Maya", agent: "Microsoft Scout", model: "GPT-5.6 Sol", status: "Backlog", evidence: "Accessibility review and 5 affected files" },
  "BCPWA-5": { title: "Prepare the public release", description: "Finalize documentation, screenshots, release notes, and package validation.", owner: "Jack", agent: "Claude Code", model: "GPT-5.6 Sol", status: "Backlog", evidence: "Release checklist and public documentation draft" },
  "BCPWA-6": { title: "Publish signed Windows package", description: "Waiting for the signing identity and final trust verification.", owner: "Jack", agent: "Claude Code", model: "GPT-5.6 Sol", status: "Blocked", evidence: "Signing blocker and package logs recorded" },
  "BCPWA-7": { title: "Validate installer upgrade path", description: "Confirm data preservation and provider refresh across Windows and macOS.", owner: "Osama", agent: "GitHub Copilot CLI", model: "GPT-5.6 Sol Fast", status: "In progress", evidence: "Windows validation active, macOS pending" },
  "BCPWA-8": { title: "Review error handling", description: "Verified invalid expressions and division-by-zero behavior.", owner: "Jack", agent: "Claude Code", model: "Claude Sonnet", status: "Done", evidence: "Review complete, 8 edge cases verified" },
  "BCPWA-9": { title: "Define visual theme tokens", description: "Delivered accessible light and dark themes with persistent preference.", owner: "Maya", agent: "Microsoft Scout", model: "GPT-5.5", status: "Done", evidence: "Theme tokens, contrast checks, and UI screenshots" },
};

const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll("[data-view-panel]")];
const drawer = document.querySelector("#taskDrawer");
const closeDrawer = document.querySelector("#closeTaskDrawer");

function showView(view) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
}

tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));

document.querySelectorAll(".task-card").forEach((card) => {
  card.addEventListener("click", () => {
    const task = taskData[card.dataset.task];
    document.querySelector("#drawerTicket").textContent = card.dataset.task;
    document.querySelector("#drawerTitle").textContent = task.title;
    document.querySelector("#drawerDescription").textContent = task.description;
    document.querySelector("#drawerOwner").textContent = task.owner;
    document.querySelector("#drawerAgent").textContent = task.agent;
    document.querySelector("#drawerModel").textContent = task.model;
    document.querySelector("#drawerStatus").textContent = task.status;
    document.querySelector("#drawerEvidence").textContent = task.evidence;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  });
});
closeDrawer.addEventListener("click", () => {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
});

const tourSteps = [
  { view: "project", selector: "#tourTabs", title: "Move through the project", text: "Project, Sessions, and Insights connect delivery state to the AI sessions and effort behind it." },
  { view: "project", selector: "#tourBoard", title: "Manage work as a Kanban", text: "AI-assisted work becomes tickets that move through Backlog, Next, In progress, Blocked, and Done." },
  { view: "project", selector: '[data-task="BCPWA-2"]', title: "Keep every decision with the ticket", text: "Each card carries the task, human owner, AI agent, recommended model, status, and evidence." },
  { view: "project", selector: "#tourCounts", title: "Supervise delivery at a glance", text: "A Scrum master or project lead can see open, active, blocked, and completed work without reading private chats." },
  { view: "insights", selector: "#insightsView .insight-grid", title: "Measure the real effort", text: "Insights summarize progress, time, AI usage, evidence, and contribution across people and agents." },
];

const overlay = document.querySelector("#tourOverlay");
const tooltip = document.querySelector("#tourTooltip");
const tourCount = document.querySelector("#tourCount");
const tourTitle = document.querySelector("#tourTitle");
const tourText = document.querySelector("#tourText");
const tourNext = document.querySelector("#tourNext");
let tourIndex = -1;
let highlighted;

function positionTooltip(target) {
  const rect = target.getBoundingClientRect();
  const tooltipWidth = Math.min(336, window.innerWidth - 32);
  let left = Math.min(window.innerWidth - tooltipWidth - 16, Math.max(16, rect.left));
  let top = rect.bottom + 18;
  if (top + 220 > window.innerHeight) top = Math.max(16, rect.top - 210);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTourStep(index) {
  if (highlighted) highlighted.classList.remove("tour-highlight");
  tourIndex = index;
  const step = tourSteps[index];
  showView(step.view);
  requestAnimationFrame(() => {
    const target = document.querySelector(step.selector);
    highlighted = target;
    target.classList.add("tour-highlight");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    tourCount.textContent = `${index + 1} of ${tourSteps.length}`;
    tourTitle.textContent = step.title;
    tourText.textContent = step.text;
    tourNext.textContent = index === tourSteps.length - 1 ? "Finish" : "Next";
    overlay.hidden = false;
    tooltip.hidden = false;
    positionTooltip(target);
  });
}

function endTour() {
  if (highlighted) highlighted.classList.remove("tour-highlight");
  overlay.hidden = true;
  tooltip.hidden = true;
  tourIndex = -1;
  showView("project");
  localStorage.setItem("context-workspace-demo-tour-seen", "1");
}

document.querySelector("#startTour").addEventListener("click", () => showTourStep(0));
document.querySelector("#tourExit").addEventListener("click", endTour);
tourNext.addEventListener("click", () => {
  if (tourIndex >= tourSteps.length - 1) endTour();
  else showTourStep(tourIndex + 1);
});
window.addEventListener("resize", () => {
  if (highlighted && !tooltip.hidden) positionTooltip(highlighted);
});

if (!localStorage.getItem("context-workspace-demo-tour-seen")) {
  window.setTimeout(() => showTourStep(0), 700);
}
