const fullBoardProjectId = new URLSearchParams(window.location.search).get("board") || "";
const storedProjectTab = localStorage.getItem("sessionHub.projectTab");
const storedSidebarWidth = Number(localStorage.getItem("sessionHub.sidebarWidth.v2"));
if (Number.isFinite(storedSidebarWidth)) {
  document.documentElement.style.setProperty("--sidebar-width", `${Math.min(480, Math.max(280, storedSidebarWidth))}px`);
}
const state = {
  sessions: [],
  selectedId: localStorage.getItem("sessionHub.selectedId"),
  selected: null,
  filter: "wrapped",
  query: "",
  editField: null,
  view: fullBoardProjectId ? "board" : (localStorage.getItem("sessionHub.projectFirstView") || "board"),
  projectTab: ["sessions", "insights"].includes(storedProjectTab) ? storedProjectTab : "overview",
  projectFilter: localStorage.getItem("sessionHub.projectFilter") || "active",
  projects: [],
  selectedProjectId: fullBoardProjectId || localStorage.getItem("sessionHub.projectId"),
  fullBoard: Boolean(fullBoardProjectId),
  board: null,
  projectDialogSessionId: "",
  projectSessionDialogProjectId: "",
  projectSessionDialogRequest: 0,
  workItemTarget: "session",
  unassignedCount: 0,
  commandIndex: 0,
  update: null,
  updateJob: null,
  info: null,
  settings: null
};
let modalReturnFocus = null;

const sessionHubCommands = [
  {
    command: "/cw:wrap",
    title: "Wrap this session",
    description: "Update the project outcome, completed work, unfinished tasks, and recommended next action."
  },
  {
    command: "/cw:handoff",
    title: "Wrap with a todo list",
    description: "Save the session plus an explicit list of what you want to do next time."
  },
  {
    command: "/cw:reopen",
    title: "Remove from Wrapped",
    description: "Mark the session as needing wrap again without deleting its saved continuity data."
  },
  {
    command: "/cw:update",
    title: "Update Context Workspace automatically",
    description: "Download and verify the latest stable release, then install it automatically after this AI CLI exits."
  },
  {
    command: "/cw:project",
    title: "Manage this session's project",
    description: "Create, link, switch, inspect, unlink, or complete an explicit goal-based project."
  },
  {
    command: "/cw:project-share",
    title: "Share this project's board",
    description: "Publish the sanitized Kanban board to a dedicated Git branch without sharing AI conversations."
  },
  {
    command: "/cw:project-push",
    title: "Push shared project updates",
    description: "Publish the latest local tickets, descriptions, owners, and statuses to the shared Git branch."
  },
  {
    command: "/cw:project-pull",
    title: "Pull shared project updates",
    description: "Import a teammate's shared board and link this local AI session to the project."
  },
  {
    command: "/cw:archive",
    title: "Archive or restore a project",
    description: "Remove a project from active views without deleting its sessions, tasks, evidence, or history."
  },
  {
    command: "/cw:auto-wrap",
    title: "Control auto-wrap for this session",
    description: "Use on, off, status, or default to manage automatic continuity checkpoints."
  },
  {
    command: "/cw:refine",
    title: "Refine the backlog",
    description: "Clarify, split, prioritize, and prepare upcoming project tasks with explicit acceptance outcomes."
  },
  {
    command: "/cw:plan",
    title: "Generate an execution plan",
    description: "Analyze unfinished chat work, order it, and populate the project board."
  },
  {
    command: "/cw:work",
    title: "Execute the next task",
    description: "Choose the best actionable card, move it to In Progress, execute it, and update the board."
  },
  {
    command: "/cw:sync",
    title: "Synchronize board progress",
    description: "Move completed, blocked, and discovered work based on actual conversation evidence."
  },
  {
    command: "/cw:review",
    title: "Review delivered outcomes",
    description: "Validate completed work against its intended result and actual implementation evidence."
  },
  {
    command: "/cw:retro",
    title: "Run a project retrospective",
    description: "Turn evidence from completed work, blockers, and rework into concrete improvements."
  },
  {
    command: "/context",
    title: "Inspect context window",
    description: "Show current context-window usage and visualization."
  },
  {
    command: "/usage",
    title: "Inspect AI usage",
    description: "Show session usage metrics and AI credit information."
  },
  {
    command: "/compact",
    title: "Compact conversation context",
    description: "Summarize history to free context while preserving the important work state."
  },
  {
    command: "/share",
    title: "Share this session",
    description: "Export the session as Markdown, HTML, a gist, or a shareable GitHub link."
  },
  {
    command: "/fork",
    title: "Fork this session",
    description: "Create a new session from the current context without losing this one."
  }
];
const boardStatusLabels = {
  backlog: "Backlog",
  next: "Next",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done"
};

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);

await Promise.all([refresh(), refreshUpdateStatus(), refreshSettings()]);
connectEvents();
bindEvents();
applyView();
syncSidebarAccessibility();
window.matchMedia("(max-width: 900px)").addEventListener("change", syncSidebarAccessibility);

async function refresh({ preserveSelection = true } = {}) {
  const [sessions, stats] = await Promise.all([
    api(`/api/sessions?filter=${encodeURIComponent(state.filter)}&q=${encodeURIComponent(state.query)}`),
    api("/api/stats")
  ]);
  state.sessions = sessions;
  elements.wrappedCount.textContent = stats.wrapped || 0;
  elements.activeCount.textContent = stats.active || 0;
  elements.pausedCount.textContent = stats.paused || 0;
  elements.unassignedCount.textContent = stats.unassigned || 0;
  elements.projectInboxCount.textContent = stats.unassigned || 0;
  state.unassignedCount = stats.unassigned || 0;
  renderSessionList();
  const hasSelected = preserveSelection && sessions.some((session) => session.id === state.selectedId);
  const nextId = hasSelected ? state.selectedId : sessions[0]?.id;
  if (nextId) await selectSession(nextId);
  else renderEmpty();
  if (state.view === "board") await refreshBoard();
  applyView();
}

async function toggleInfoPanel() {
  const opening = elements.infoPanel.classList.contains("hidden");
  if (!opening) return closeInfoPanel();
  elements.infoPanel.classList.remove("hidden");
  elements.infoButton.setAttribute("aria-expanded", "true");
  if (!state.info) {
    state.info = await api("/api/info");
    renderApplicationInfo();
  }
  await refreshInfoUpdate(false);
}

function closeInfoPanel() {
  elements.infoPanel.classList.add("hidden");
  elements.infoButton.setAttribute("aria-expanded", "false");
}

function renderApplicationInfo() {
  elements.infoVersion.textContent = `Version ${state.info.version}`;
  elements.infoRepositoryLink.href = state.info.repositoryUrl;
  elements.infoReleaseLink.href = state.info.releasesUrl;
  elements.infoProviders.replaceChildren();
  for (const provider of state.info.providers) {
    const row = element("div", "info-provider");
    row.append(
      element("span", "", provider.name),
      element("span", `info-provider-state ${provider.configured ? "configured" : provider.detected ? "detected" : "missing"}`,
        provider.configured ? "Configured" : provider.detected ? "Detected" : "Not installed")
    );
    elements.infoProviders.append(row);
  }
  elements.autoWrapToggle.checked = state.settings?.autoWrap?.enabled === true;
}

async function refreshSettings() {
  state.settings = await api("/api/settings");
  elements.autoWrapToggle.checked = state.settings.autoWrap.enabled;
  elements.autoWrapPrompt.classList.toggle("hidden", state.settings.autoWrap.consented);
}

async function setAutoWrap(enabled) {
  state.settings = await api("/api/settings", {
    method: "PATCH",
    body: { autoWrapEnabled: enabled }
  });
  elements.autoWrapToggle.checked = enabled;
  elements.autoWrapPrompt.classList.add("hidden");
  toast(enabled ? "Automatic session wrapping enabled" : "Automatic session wrapping disabled");
}

async function refreshInfoUpdate(force) {
  const status = await api(`/api/update${force ? "?refresh=1" : ""}`);
  state.update = status;
  if (status.error) {
    elements.infoUpdateTitle.textContent = "Update check unavailable";
    elements.infoUpdateDetail.textContent = status.error;
  } else if (status.updateAvailable) {
    elements.infoUpdateTitle.textContent = `Version ${status.latestVersion} is available`;
    elements.infoUpdateDetail.textContent = `Installed: ${status.currentVersion}`;
    elements.infoReleaseLink.href = status.releaseUrl || state.info?.releasesUrl || elements.infoReleaseLink.href;
  } else {
    elements.infoUpdateTitle.textContent = "You are up to date";
    elements.infoUpdateDetail.textContent = `Installed: ${status.currentVersion}`;
  }
}

function isDialogOpen() {
  return [...document.querySelectorAll(".dialog-backdrop")].some((dialog) => !dialog.classList.contains("hidden"));
}

function trapDialogFocus(event, dialog) {
  const focusable = [...dialog.querySelectorAll("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]")]
    .filter((element) => !element.classList.contains("hidden"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindEvents() {
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelector(".filter.active")?.classList.remove("active");
      document.querySelectorAll(".filter").forEach((item) => item.setAttribute("aria-pressed", "false"));
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      state.filter = button.dataset.filter;
      await refresh({ preserveSelection: false });
    });
  });
  elements.searchInput.addEventListener("input", debounce(async (event) => {
    state.query = event.target.value;
    if (state.view === "board") renderProjectList();
    else await refresh({ preserveSelection: false });
  }, 180));
  elements.refreshButton.addEventListener("click", () => refresh());
  elements.copyUpdateCommand.addEventListener("click", () => copyCommand("/cw:update"));
  elements.dismissUpdate.addEventListener("click", dismissUpdate);
  elements.resumeMainButton.addEventListener("click", resumeSelected);
  elements.openCopilotButton.addEventListener("click", resumeSelected);
  elements.repoChip.addEventListener("click", () => action("folder"));
  elements.sessionIdChip.addEventListener("click", copyResumeCommand);
  elements.moreButton.addEventListener("click", () => elements.moreMenu.classList.toggle("hidden"));
  elements.moreMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    elements.moreMenu.classList.add("hidden");
    await action(button.dataset.action);
  });
  elements.emptyState.querySelector("[data-action]")?.addEventListener("click", async (event) => {
    await action(event.currentTarget.dataset.action);
  });
  document.addEventListener("click", (event) => {
    if (!elements.moreButton.contains(event.target) && !elements.moreMenu.contains(event.target)) {
      elements.moreMenu.classList.add("hidden");
    }
    if (!elements.projectMoreButton.contains(event.target) && !elements.projectMoreMenu.contains(event.target)) {
      elements.projectMoreMenu.classList.add("hidden");
      elements.projectMoreButton.setAttribute("aria-expanded", "false");
    }
    if (!elements.infoButton.contains(event.target) && !elements.infoPanel.contains(event.target)) {
      closeInfoPanel();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !elements.projectSessionDialog.classList.contains("hidden")) {
      trapDialogFocus(event, elements.projectSessionDialog);
    }
    if (event.key === "/" && !isDialogOpen() && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !isDialogOpen()) {
      event.preventDefault();
      openCommandPalette();
    }
    if (!elements.commandPalette.classList.contains("hidden")) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCommandSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCommandSelection(-1);
      } else if (event.key === "Enter" && document.activeElement === elements.commandSearch) {
        event.preventDefault();
        copySelectedCommand();
      }
    }
    if (event.key === "Escape") {
      closeDialog();
      closeWorkItemDialog();
      closeProjectDialog();
      closeProjectSessionDialog();
      closeCommandPalette();
      closeInfoPanel();
      closeSidebar();
    }
  });
  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openDialog(button.dataset.edit));
  });
  elements.editForm.addEventListener("submit", saveEdit);
  elements.cancelEdit.addEventListener("click", closeDialog);
  elements.editDialog.addEventListener("click", (event) => {
    if (event.target === elements.editDialog) closeDialog();
  });
  elements.taskForm.addEventListener("submit", addTask);
  elements.workItemForm.addEventListener("submit", addWorkItem);
  elements.linkWorkItemButton.addEventListener("click", () => openWorkItemDialog("session"));
  elements.linkProjectWorkItemButton.addEventListener("click", () => openWorkItemDialog("project"));
  elements.closeWorkItemDialog.addEventListener("click", closeWorkItemDialog);
  elements.workItemDialog.addEventListener("click", (event) => {
    if (event.target === elements.workItemDialog) closeWorkItemDialog();
  });
  elements.trackProjectButton.addEventListener("click", openSelectedProject);
  elements.mobileMenu.addEventListener("click", openSidebar);
  elements.closeSidebar.addEventListener("click", closeSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);
  elements.sidebarResizeHandle.addEventListener("pointerdown", startSidebarResize);
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.infoButton.addEventListener("click", toggleInfoPanel);
  elements.closeInfo.addEventListener("click", closeInfoPanel);
  elements.refreshInfoUpdate.addEventListener("click", () => refreshInfoUpdate(true));
  elements.autoWrapToggle.addEventListener("change", () => setAutoWrap(elements.autoWrapToggle.checked));
  elements.enableAutoWrap.addEventListener("click", () => setAutoWrap(true));
  elements.declineAutoWrap.addEventListener("click", () => setAutoWrap(false));
  elements.commandPaletteButton.addEventListener("click", openCommandPalette);
  elements.commandSearch.addEventListener("input", () => {
    state.commandIndex = 0;
    renderCommandPalette();
  });
  elements.commandPalette.addEventListener("click", (event) => {
    if (event.target === elements.commandPalette) closeCommandPalette();
  });
  elements.openProjectButton.addEventListener("click", async () => {
    const sessionId = state.board?.projectState?.id || state.board?.sessions?.[0]?.id;
    if (!sessionId) return;
    state.view = "sessions";
    localStorage.setItem("sessionHub.projectFirstView", "sessions");
    await selectSession(sessionId);
    applyView();
  });
  elements.createProjectButton.addEventListener("click", () => openProjectDialog());
  elements.addProjectSessionButton.addEventListener("click", openProjectSessionDialog);
  elements.projectSharedFilterButton.addEventListener("click", async () => {
    state.projectFilter = state.projectFilter === "shared" ? "active" : "shared";
    localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
    state.selectedProjectId = "";
    await refreshBoard();
  });
  elements.projectArchiveFilterButton.addEventListener("click", async () => {
    state.projectFilter = state.projectFilter === "archived" ? "active" : "archived";
    localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
    state.selectedProjectId = "";
    await refreshBoard();
  });
  elements.projectMoreButton.addEventListener("click", () => {
    const opening = elements.projectMoreMenu.classList.contains("hidden");
    elements.projectMoreMenu.classList.toggle("hidden", !opening);
    elements.projectMoreButton.setAttribute("aria-expanded", opening ? "true" : "false");
  });
  elements.projectArchiveButton.addEventListener("click", async () => {
    elements.projectMoreMenu.classList.add("hidden");
    elements.projectMoreButton.setAttribute("aria-expanded", "false");
    await toggleProjectArchive();
  });
  elements.projectShareButton.addEventListener("click", async () => {
    elements.projectMoreMenu.classList.add("hidden");
    elements.projectMoreButton.setAttribute("aria-expanded", "false");
    await copyCommand(state.board?.project?.sharing?.enabled ? "/cw:project-push" : "/cw:project-share");
  });
  elements.projectInboxButton.addEventListener("click", openUnassignedSessions);
  elements.closeProjectDialog.addEventListener("click", closeProjectDialog);
  elements.projectDialog.addEventListener("click", (event) => {
    if (event.target === elements.projectDialog) closeProjectDialog();
  });
  elements.createProjectForm.addEventListener("submit", createProjectFromDialog);
  elements.linkProjectButton.addEventListener("click", linkProjectFromDialog);
  elements.unlinkProjectButton.addEventListener("click", unlinkProjectFromDialog);
  elements.projectSessionForm.addEventListener("submit", linkSelectedProjectSession);
  elements.closeProjectSessionDialog.addEventListener("click", closeProjectSessionDialog);
  elements.cancelProjectSessionDialog.addEventListener("click", closeProjectSessionDialog);
  elements.projectSessionDialog.addEventListener("click", (event) => {
    if (event.target === elements.projectSessionDialog) closeProjectSessionDialog();
  });
  document.querySelectorAll("[data-project-filter]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.projectFilter = button.dataset.projectFilter;
      localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
      state.selectedProjectId = "";
      await refreshBoard();
    });
  });
  elements.startProjectAction.addEventListener("click", openProjectNextSession);
  elements.openLatestProjectSession.addEventListener("click", openProjectLatestSession);
  elements.openFullBoardButton.addEventListener("click", openFullBoard);
  elements.closeFullBoardButton.addEventListener("click", closeFullBoard);
  document.querySelectorAll("[data-project-tab]").forEach((button) => {
    button.addEventListener("click", () => setProjectTab(button.dataset.projectTab));
  });
  document.querySelectorAll("[data-show-project-tab]").forEach((button) => {
    button.addEventListener("click", () => setProjectTab(button.dataset.showProjectTab));
  });
  document.querySelectorAll("[data-add-board-task]").forEach((button) => {
    button.addEventListener("click", () => openBoardTaskForm(button.dataset.addBoardTask, button));
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      localStorage.setItem("sessionHub.projectFirstView", state.view);
      if (state.view === "board") {
        state.query = "";
        elements.searchInput.value = "";
        await refreshBoard();
        applyView();
      } else {
        state.query = "";
        elements.searchInput.value = "";
        await refresh();
      }

    });
  });
  bindBoardDropzones();
}

function startSidebarResize(event) {
  if (window.matchMedia("(max-width: 900px)").matches) return;
  event.preventDefault();
  const handle = elements.sidebarResizeHandle;
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-sidebar");

  const resize = (moveEvent) => {
    const width = Math.min(480, Math.max(280, moveEvent.clientX));
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  };
  const finish = () => {
    handle.removeEventListener("pointermove", resize);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    document.body.classList.remove("resizing-sidebar");
    const width = Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);
    localStorage.setItem("sessionHub.sidebarWidth.v2", String(width));
  };

  handle.addEventListener("pointermove", resize);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

function openCommandPalette() {
  modalReturnFocus = document.activeElement;
  state.commandIndex = 0;
  elements.commandSearch.value = "";
  elements.commandPalette.classList.remove("hidden");
  renderCommandPalette();
  elements.commandSearch.focus();
}

function closeCommandPalette() {
  const wasOpen = !elements.commandPalette.classList.contains("hidden");
  elements.commandPalette.classList.add("hidden");
  if (wasOpen) modalReturnFocus?.focus();
}

function filteredCommands() {
  const query = elements.commandSearch.value.trim().toLowerCase();
  return sessionHubCommands.filter((item) =>
    !query || [item.command, item.title, item.description].some((value) => value.toLowerCase().includes(query))
  );
}

function renderCommandPalette() {
  const commands = filteredCommands();
  state.commandIndex = Math.max(0, Math.min(state.commandIndex, Math.max(0, commands.length - 1)));
  elements.commandList.replaceChildren();
  commands.forEach((item, index) => {
    const row = element("button", `command-item${index === state.commandIndex ? " selected" : ""}`);
    const command = element("code", "", item.command);
    const copy = element("span", "command-copy");
    copy.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 7V3h13v13h-4v5H3V7h5Zm2 0h7v7h2V5h-9v2Zm5 2H5v10h10V9Z"/></svg>Copy';
    const details = element("div");
    details.append(element("strong", "", item.title), element("span", "", item.description));
    row.append(command, details, copy);
    row.addEventListener("mouseenter", () => {
      state.commandIndex = index;
      renderCommandSelection();
    });
    row.addEventListener("click", () => copyCommand(item.command));
    elements.commandList.append(row);
  });
  if (!commands.length) elements.commandList.append(element("p", "board-empty", "No matching commands"));
}

function moveCommandSelection(direction) {
  const commands = filteredCommands();
  if (!commands.length) return;
  state.commandIndex = (state.commandIndex + direction + commands.length) % commands.length;
  renderCommandSelection();
}

function renderCommandSelection() {
  [...elements.commandList.querySelectorAll(".command-item")].forEach((item, index) => {
    item.classList.toggle("selected", index === state.commandIndex);
  });
  elements.commandList.querySelector(".command-item.selected")?.scrollIntoView({ block: "nearest" });
}

function copySelectedCommand() {
  const command = filteredCommands()[state.commandIndex];
  if (command) copyCommand(command.command);
}

async function copyCommand(command) {
  try {
    await navigator.clipboard.writeText(command);
    closeCommandPalette();
    toast(`${command} copied. Paste it into Copilot CLI`);
  } catch {
    toast(`Copy failed. Type ${command} in Copilot CLI.`, true);
  }
}

function connectEvents() {
  const stream = new EventSource("/api/events");
  stream.addEventListener("sessions-changed", () => state.view === "board" ? refreshBoard() : refresh());
  stream.addEventListener("update-changed", refreshUpdateStatus);
  stream.addEventListener("settings-changed", refreshSettings);
}

async function refreshUpdateStatus() {
  let status;
  let job;
  try {
    [status, job] = await Promise.all([api("/api/update"), api("/api/update/job")]);
  } catch {
    setTimeout(refreshUpdateStatus, 2000);
    return;
  }
  state.update = status;
  state.updateJob = job;
  const activeJob = ["preparing", "waiting_for_exit", "installing"].includes(job.state);
  if (activeJob) {
    elements.updateBanner.classList.remove("hidden");
    elements.updateReleaseLink.classList.add("hidden");
    elements.copyUpdateCommand.classList.add("hidden");
    elements.dismissUpdate.classList.add("hidden");
    const messages = {
      preparing: [`Preparing Context Workspace ${job.toVersion}`, "Downloading and verifying the stable release."],
      waiting_for_exit: [`Context Workspace ${job.toVersion} is ready`, "Exit active AI CLI sessions. Installation will finish automatically."],
      installing: [`Installing Context Workspace ${job.toVersion}`, "The dashboard will restart automatically."]
    };
    [elements.updateTitle.textContent, elements.updateDetail.textContent] = messages[job.state];
    setTimeout(refreshUpdateStatus, 2000);
    return;
  }
  const terminalJob = ["succeeded", "succeeded_with_warnings", "failed"].includes(job.state) &&
    localStorage.getItem("sessionHub.dismissedUpdateJob") !== job.id;
  if (terminalJob) {
    elements.updateBanner.classList.remove("hidden");
    const succeeded = ["succeeded", "succeeded_with_warnings"].includes(job.state);
    elements.updateReleaseLink.classList.toggle("hidden", job.state === "failed");
    elements.copyUpdateCommand.classList.toggle("hidden", succeeded);
    elements.dismissUpdate.classList.remove("hidden");
    elements.updateTitle.textContent = succeeded
      ? `Updated to Context Workspace ${job.toVersion}`
      : `Context Workspace ${job.toVersion} could not be installed`;
    elements.updateDetail.textContent = succeeded
      ? (job.state === "succeeded_with_warnings"
        ? job.warning || "The app updated, but one or more integrations need attention."
        : `Previous version: ${job.fromVersion}`)
      : job.error || "Run /cw:update to try again.";
    elements.updateReleaseLink.href = job.releaseUrl || "https://github.com/OAbouHajar/smart-ai-human-manager/releases";
    return;
  }
  elements.updateReleaseLink.classList.remove("hidden");
  elements.copyUpdateCommand.classList.remove("hidden");
  elements.dismissUpdate.classList.remove("hidden");
  const dismissedVersion = localStorage.getItem("sessionHub.dismissedUpdate");
  const visible = status.updateAvailable && dismissedVersion !== status.latestVersion;
  elements.updateBanner.classList.toggle("hidden", !visible);
  if (!visible) return;
  elements.updateTitle.textContent = `Context Workspace ${status.latestVersion} is available`;
  elements.updateDetail.textContent = `Installed version: ${status.currentVersion}`;
  elements.updateReleaseLink.href = status.releaseUrl || "https://github.com/OAbouHajar/smart-ai-human-manager/releases";
}

function dismissUpdate() {
  if (state.updateJob?.id && ["succeeded", "succeeded_with_warnings", "failed"].includes(state.updateJob.state)) {
    localStorage.setItem("sessionHub.dismissedUpdateJob", state.updateJob.id);
  }
  if (state.update?.latestVersion) {
    localStorage.setItem("sessionHub.dismissedUpdate", state.update.latestVersion);
  }
  elements.updateBanner.classList.add("hidden");
}

function renderSessionList() {
  elements.sessionList.replaceChildren();
  for (const session of state.sessions) {
    const row = element("div", `session-entry${session.pinned ? " starred" : ""}`);
    const button = document.createElement("button");
    button.className = `session-item${session.id === state.selectedId ? " selected" : ""}`;
    button.dataset.id = session.id;
    button.setAttribute("aria-current", session.id === state.selectedId ? "true" : "false");
    const copy = element("span", "session-copy");
    const title = element("strong", "", session.title);
    const workspace = session.repository ? basename(session.repository) : basename(session.cwd) || "No workspace";
    const provider = session.providerName || "GitHub Copilot CLI";
    const context = element(
      "span",
      "session-context-line",
      `${session.projectId ? "Project session" : "Unassigned"} · ${provider} · ${workspace}`
    );
    const visibleMatch = session.searchMatch && session.searchMatch.type !== "title";
    const previewText = visibleMatch
      ? `Matched ${session.searchMatch.type}: ${session.searchMatch.text}`
      : session.summary || session.lastAction || session.nextAction || "No checkpoint summary yet";
    const preview = element("span", `session-preview${visibleMatch ? " matched" : ""}`, previewText);
    const time = element("span", "session-time", relativeTime(session.updatedAt));
    const meta = element("span", "session-meta-row");
    meta.append(context, time);
    copy.append(title, meta, preview);
    button.append(copy);
    button.addEventListener("click", async () => {
      await selectSession(session.id);
      closeSidebar();
    });
    const star = createStarButton(session.pinned, "session", async () => {
      await api(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        body: { pinned: !session.pinned }
      });
      toast(session.pinned ? "Session unstarred" : "Session starred");
      await refresh();
    });
    row.append(button, star);
    elements.sessionList.append(row);
  }
  if (!state.sessions.length) {
    elements.sessionList.append(element("p", "empty-copy", "No sessions match this view."));
  }
}

async function selectSession(id) {
  state.selectedId = id;
  localStorage.setItem("sessionHub.selectedId", id);
  state.selected = await api(`/api/sessions/${encodeURIComponent(id)}`);
  document.querySelectorAll(".session-item").forEach((item) => {
    const selected = item.dataset.id === id;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-current", selected ? "true" : "false");
  });
  renderDetail();
}

function renderDetail() {
  const session = state.selected;
  elements.emptyState.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  elements.sessionTitle.textContent = session.title;
  elements.sessionSummary.textContent = session.summary || "No AI checkpoint yet. Use /cw:wrap before leaving this session.";
  elements.statusBadge.textContent = session.status;
  elements.statusBadge.className = `badge ${session.status}`;
  elements.providerBadge.textContent = session.providerName || "AI CLI";
  elements.providerBadge.dataset.provider = session.provider || "";
  elements.updatedLabel.textContent = `Updated ${relativeTime(session.updatedAt)}`;
  elements.projectBadge.classList.remove("hidden");
  elements.projectBadge.textContent = session.project ? `Project: ${session.project.title}` : "Unassigned";
  elements.importedBadge.classList.toggle("hidden", !session.imported);
  elements.reviewBadge.classList.toggle("hidden", !session.needsReview);
  elements.checkpointBadge.classList.toggle("hidden", !session.checkpointSource || session.needsReview);
  elements.checkpointBadge.textContent = session.checkpointSource === "automatic" ? "Auto-wrapped" : "Manually wrapped";
  elements.checkpointBadge.title = session.checkpointedAt
    ? `${session.checkpointSource === "automatic" ? "Automatic" : "Manual"} checkpoint ${relativeTime(session.checkpointedAt)}`
    : "";
  elements.nextAction.textContent = session.nextAction || "Run /cw:wrap to create a recommended next step.";
  elements.lastAction.textContent = session.lastAction || "No checkpoint has been saved yet.";
  elements.repoChip.querySelector("span").textContent = basename(session.repository) || basename(session.cwd) || "Workspace";
  elements.repoChip.title = session.cwd || "No working directory";
  elements.branchChip.querySelector("span").textContent = session.branch || "No branch";
  elements.sessionIdChip.querySelector("span").textContent = `Session ID: ${shortSessionId(session.externalId || session.id)}`;
  elements.sessionIdChip.title = `Copy ${session.resumeCommand}`;
  elements.sessionIdChip.setAttribute("aria-label", `Copy ${session.providerName || "AI CLI"} resume command`);
  elements.sessionDuration.textContent = formatDuration(session.startedAt, session.endedAt || Date.now());
  renderSessionMetrics(session.metrics);
  elements.trackProjectButton.classList.toggle("tracked", Boolean(session.project));
  elements.trackProjectButton.querySelector("span").textContent = session.project ? "Open project workspace" : "Add to project";
  renderFiles();
  renderTasks();
  renderWorkItems();
  renderTimeline();
  const pinButton = elements.moreMenu.querySelector('[data-action="pin"]');
  pinButton.textContent = session.pinned ? "Unstar session" : "Star session";
  const archiveButton = elements.moreMenu.querySelector('[data-action="archive"]');
  archiveButton.textContent = session.archived ? "Restore session" : "Archive session";
  const autoWrapButton = elements.moreMenu.querySelector('[data-action="auto-wrap"]');
  autoWrapButton.textContent = session.autoWrapEnabled ? "Disable auto-wrap" : "Enable auto-wrap";
}

function renderFiles() {
  const files = state.selected.files || [];
  elements.filesSection.classList.toggle("hidden", !files.length);
  if (!files.length) return;
  const status = state.selected.fileHistoryStatus || "unavailable";
  const messages = {
    current: `${state.selected.fileCount || files.length} recorded`,
    empty: "No files recorded",
    stale: state.selected.fileHistorySyncedAt
      ? `Last updated ${relativeTime(state.selected.fileHistorySyncedAt)}`
      : "Showing last-known files",
    unavailable: "File history unavailable"
  };
  elements.fileHistoryMessage.textContent = messages[status] || messages.unavailable;
  elements.fileHistoryMessage.className = `file-history-status ${status}`;
  elements.fileList.replaceChildren();
  for (const file of files) {
    const item = element("li", "file-item");
    item.append(
      element("span", "file-path", file.displayPath),
      element("small", "", file.outsideWorkspace ? "Outside workspace" : formatToolName(file.toolName))
    );
    elements.fileList.append(item);
  }
  if (state.selected.filesTruncated) {
    elements.fileList.append(element("li", "empty-copy", `Showing the first ${files.length} files.`));
  }
}

function renderTasks() {
  const tasks = (state.selected.tasks || []).filter((task) => !task.completed);
  elements.taskProgress.textContent = `${tasks.length} open`;
  elements.taskList.replaceChildren();
  for (const task of tasks) {
    const row = element("div", `task-item${task.completed ? " completed" : ""}`);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", async () => {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { completed: checkbox.checked } });
      await selectSession(state.selectedId);
    });
    const text = element("p", "", task.text);
    const remove = element("button", "delete-task");
    remove.setAttribute("aria-label", "Delete task");
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h10l-1 14H8L7 7Zm2-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>';
    remove.addEventListener("click", async () => {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      await selectSession(state.selectedId);
    });
    row.append(checkbox, text, remove);
    elements.taskList.append(row);
  }
  if (!tasks.length) elements.taskList.append(element("p", "empty-copy", "No unfinished checklist items detected."));
}

function renderWorkItems() {
  const workItems = state.selected.workItems || [];
  elements.headerWorkItems.replaceChildren();
  for (const item of workItems) {
    const headerLink = element("a", "header-work-item", `${item.type} #${item.workItemId}`);
    headerLink.href = item.url;
    headerLink.target = "_blank";
    headerLink.rel = "noreferrer";
    headerLink.title = item.title || `Work item ${item.workItemId}`;
    elements.headerWorkItems.append(headerLink);
  }
  if (state.workItemTarget === "session" || elements.workItemDialog.classList.contains("hidden")) {
    renderWorkItemDialog(workItems);
  }
}

function renderProjectWorkItems(workItems) {
  elements.projectWorkItems.replaceChildren();
  for (const item of workItems) {
    const link = element("a", "project-work-item", `${item.type} #${item.workItemId}`);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = item.title || `Work item ${item.workItemId}`;
    elements.projectWorkItems.append(link);
  }
}

function renderWorkItemDialog(workItems) {
  elements.workItemList.replaceChildren();
  for (const item of workItems) {
    const row = element("div", "work-item");
    row.append(element("span", "work-item-type", item.type));
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title ? `${item.title} · #${item.workItemId}` : `Work item #${item.workItemId}`;
    const remove = element("button");
    remove.setAttribute("aria-label", `Unlink work item ${item.workItemId}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h10l-1 14H8L7 7Zm2-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>';
    remove.addEventListener("click", async () => {
      await api(`/api/work-items/${item.id}`, { method: "DELETE" });
      if (state.workItemTarget === "project") {
        await refreshBoard();
        renderWorkItemDialog(state.board?.workItems || []);
      } else {
        await selectSession(state.selectedId);
      }
    });
    row.append(link, remove);
    elements.workItemList.append(row);
  }
  if (!workItems.length) {
    elements.workItemList.append(element("p", "empty-copy", "No work items linked yet."));
  }
}

function openWorkItemDialog(target) {
  if (target === "project" ? !state.selectedProjectId : !state.selected) return;
  state.workItemTarget = target;
  elements.workItemDialogTitle.textContent = target === "project" ? "Project work items" : "Linked work items";
  renderWorkItemDialog(target === "project" ? state.board?.workItems || [] : state.selected.workItems || []);
  modalReturnFocus = document.activeElement;
  elements.workItemDialog.classList.remove("hidden");
  elements.workItemUrl.focus();
}

function closeWorkItemDialog() {
  const wasOpen = !elements.workItemDialog.classList.contains("hidden");
  elements.workItemDialog.classList.add("hidden");
  if (wasOpen) modalReturnFocus?.focus();
}

function renderTimeline() {
  elements.timeline.replaceChildren();
  const questions = state.selected.questions?.length
    ? state.selected.questions
    : state.selected.initialQuestion ? [state.selected.initialQuestion] : [];
  elements.questionCount.textContent = `${questions.length} ${questions.length === 1 ? "item" : "items"}`;
  elements.sessionQuestions.replaceChildren();
  for (const question of questions) {
    const className = question.endsWith(" skill was called.") ? "skill-call" : "";
    elements.sessionQuestions.append(element("li", className, question));
  }
  if (!questions.length) {
    elements.sessionQuestions.append(element("li", "", "The questions were not recorded for this session."));
  }
  elements.sessionQuestions.closest(".session-question").classList.toggle("empty", !questions.length);
  const events = state.selected.events || [];
  events.slice(0, 8).forEach((event) => {
    const item = element("div", "timeline-item");
    const timestamp = new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.append(
      element("time", "", timestamp),
      element("span", `log-level ${logLevel(event.type)}`, event.type.replaceAll("-", " ")),
      element("p", "", event.detail),
      element("small", "", relativeTime(event.created_at))
    );
    elements.timeline.append(item);
  });
  if (!events.length) elements.timeline.append(element("p", "empty-copy", "No activity recorded."));
}

function renderEmpty() {
  state.selected = null;
  elements.detailContent.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  if (state.query.trim()) {
    elements.emptyTitle.textContent = "No sessions match that search";
    elements.emptyCopy.textContent = "Try another task, project, folder, action, or file name.";
    elements.emptyAction.textContent = "Clear search";
    elements.emptyAction.dataset.action = "clear-search";
  } else if (state.filter === "wrapped") {
    elements.emptyTitle.textContent = "No wrapped sessions yet";
    elements.emptyCopy.textContent = "Run /cw:wrap in a Copilot session to save its summary, stopping point, and next action.";
    elements.emptyAction.textContent = "Show active sessions";
    elements.emptyAction.dataset.action = "show-active";
  } else {
    elements.emptyTitle.textContent = `No ${state.filter} sessions`;
    elements.emptyCopy.textContent = "Choose another status or return to your wrapped sessions.";
    elements.emptyAction.textContent = "Show wrapped sessions";
    elements.emptyAction.dataset.action = "show-wrapped";
  }
}

function applyView() {
  const boardActive = state.view === "board";
  const searching = Boolean(state.query.trim());
  document.body.classList.toggle("board-focus-mode", state.fullBoard);
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  elements.boardView.classList.toggle("hidden", !boardActive);
  elements.topActions.classList.remove("hidden");
  elements.moreButton.classList.toggle("hidden", boardActive);
  if (boardActive) elements.moreMenu.classList.add("hidden");
  elements.topbarLabel.textContent = boardActive ? "Project workspace" : "Session details";
  elements.topbarDetail.textContent = boardActive ? "Shared project context, private AI conversations" : "The work behind this project";
  document.querySelector(".sidebar").classList.toggle("board-mode", boardActive);
  elements.projectInboxButton.classList.toggle("hidden", !boardActive || !state.unassignedCount);
  elements.sidebarHeadingLabel.textContent = boardActive ? "Projects" : "Project sessions";
  elements.searchInput.placeholder = boardActive ? "Search projects" : "Task, project, folder, or file";
  elements.statusFilters.classList.toggle("hidden", boardActive || searching);
  elements.projectFilters.classList.toggle("hidden", !boardActive || searching);
  if (searching && !boardActive) elements.sidebarHeadingLabel.textContent = "Search results across all history";
  if (boardActive) {
    renderProjectList();
    elements.detailContent.classList.add("hidden");
    elements.emptyState.classList.add("hidden");
  } else if (state.selected) {
    elements.detailContent.classList.remove("hidden");
    elements.emptyState.classList.add("hidden");
  } else {
    elements.detailContent.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
  }
}

async function refreshBoard() {
  const apiFilter = state.fullBoard ? "all" : state.projectFilter === "private" ? "active" : state.projectFilter;
  state.projects = await api(`/api/projects?filter=${encodeURIComponent(apiFilter)}`);
  const visibleProjects = state.projects.filter(projectMatchesVisibility);
  const preferred = visibleProjects.some((project) => project.id === state.selectedProjectId)
    ? state.selectedProjectId
    : (state.selected?.projectId && visibleProjects.some((project) => project.id === state.selected.projectId)
      ? state.selected.projectId
      : visibleProjects[0]?.id);
  state.selectedProjectId = preferred || "";
  if (state.selectedProjectId) localStorage.setItem("sessionHub.projectId", state.selectedProjectId);
  renderProjectList();
  const hasProject = Boolean(state.selectedProjectId);
  elements.noProjects.classList.toggle("hidden", hasProject);
  elements.projectTabs.classList.toggle("hidden", !hasProject);
  elements.projectWorkspaceTitle.textContent = hasProject ? "Loading project…" : "Your projects";
  elements.projectWorkspaceSummary.textContent = hasProject
    ? "Collecting the latest wrapped session state."
    : "Create an explicit goal here or run /cw:project from an AI session.";
  elements.openProjectButton.disabled = !hasProject;
  elements.openFullBoardButton.disabled = !hasProject;
  elements.linkProjectWorkItemButton.disabled = !hasProject;
  elements.projectArchiveButton.disabled = !hasProject;
  elements.projectShareButton.disabled = !hasProject;
  const showingShared = state.projectFilter === "shared";
  const showingArchived = state.projectFilter === "archived";
  elements.projectSharedFilterButton.classList.toggle("active", showingShared);
  elements.projectSharedFilterButton.title = showingShared ? "Show active projects" : "Show shared projects";
  elements.projectSharedFilterButton.setAttribute("aria-label", elements.projectSharedFilterButton.title);
  elements.projectSharedFilterButton.setAttribute("aria-pressed", showingShared ? "true" : "false");
  elements.projectArchiveFilterButton.classList.toggle("active", showingArchived);
  elements.projectArchiveFilterButton.title = showingArchived ? "Show active projects" : "Show archived projects";
  elements.projectArchiveFilterButton.setAttribute("aria-label", elements.projectArchiveFilterButton.title);
  elements.projectArchiveFilterButton.setAttribute("aria-pressed", showingArchived ? "true" : "false");
  elements.projectMoreButton.disabled = !hasProject;
  document.querySelectorAll("[data-project-filter]").forEach((button) => {
    const active = button.dataset.projectFilter === state.projectFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  elements.projectWorkItems.replaceChildren();
  if (!hasProject) {
    state.board = null;
    document.querySelectorAll(".project-panel").forEach((panel) => panel.classList.add("hidden"));
    return;
  }

  const board = await api(`/api/board?projectId=${encodeURIComponent(state.selectedProjectId)}`);
  state.board = board;
  renderProjectWorkspace(board);
  elements.coachStrip.classList.add("hidden");
  elements.coachNextAction.textContent = board.projectState?.nextAction || board.project.nextAction || "Run /cw:plan to generate an ordered execution plan.";
  elements.boardOpenCount.textContent = board.total - (board.counts.done || 0);
  elements.boardProgressCount.textContent = board.counts.in_progress || 0;
  elements.boardBlockedCount.textContent = board.counts.blocked || 0;
  elements.boardDoneCount.textContent = board.counts.done || 0;
  for (const status of ["backlog", "next", "in_progress", "blocked", "done"]) {
    const count = board.counts[status] || 0;
    document.querySelector(`[data-count="${status}"]`).textContent = count;
    const container = document.querySelector(`[data-dropzone="${status}"]`);
    container.replaceChildren();
    const tasks = board.tasks.filter((task) => task.status === status);
    tasks.forEach((task) => container.append(renderBoardCard(task)));
    if (!tasks.length) container.append(element("p", "board-empty", "Drop an item here"));
  }
  applyProjectTab();
}

function setProjectTab(tab) {
  if (!["overview", "sessions", "insights"].includes(tab)) return;
  state.projectTab = tab;
  localStorage.setItem("sessionHub.projectTab", tab);
  applyProjectTab();
}

function applyProjectTab() {
  if (!state.board) return;
  document.querySelectorAll("[data-project-tab]").forEach((button) => {
    const active = button.dataset.projectTab === state.projectTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const panels = {
    overview: elements.projectOverviewPanel,
    sessions: elements.projectSessionsPanel,
    insights: elements.projectInsightsPanel
  };
  Object.entries(panels).forEach(([name, panel]) => panel.classList.toggle("hidden", name !== state.projectTab));
}

function renderProjectWorkspace(board) {
  const project = board.project;
  const projectState = board.projectState || project;
  const sessions = board.sessions || [project];
  const completed = board.tasks.filter((task) => task.status === "done");
  const inProgress = board.tasks.find((task) => task.status === "in_progress");
  const blocked = board.tasks.find((task) => task.status === "blocked");
  const nextTasks = board.tasks.filter((task) => ["next", "in_progress"].includes(task.status)).slice(0, 4);
  const progress = board.total ? Math.round(((board.counts.done || 0) / board.total) * 100) : 0;
  const latestSession = projectState;
  const duration = sessions.reduce((total, session) => total + sessionDurationMs(session), 0);
  const credits = sessions.reduce((total, session) => total + Number(session.metrics?.aiCredits || 0), 0);
  const fileCount = sessions.reduce((total, session) => total + Number(session.fileCount || 0), 0);

  elements.projectWorkspaceTitle.textContent = projectName(project);
  elements.projectWorkspaceSummary.textContent = project.summary || "Add a clear success outcome for this project.";
  elements.projectUpdatedLabel.textContent = `Updated ${relativeTime(projectState?.updatedAt || project.updatedAt)}`;
  elements.projectWorkspaceMeta.replaceChildren(
    projectMetaChip("sessions", `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`),
    projectMetaChip("branch", projectState?.branch || "No branch"),
    projectMetaChip("folder", basename(project.repository) || basename(project.cwd) || "Local workspace")
  );
  renderProjectWorkItems(board.workItems || []);
  elements.projectStatusLabel.textContent = board.counts.blocked
    ? "Needs attention"
    : project.status === "complete" || (board.total > 0 && board.counts.done === board.total)
      ? "Complete"
      : "In progress";
  if (project.status === "archived") elements.projectStatusLabel.textContent = "Archived";
  elements.projectShareStatus.textContent = project.sharing?.enabled
    ? "Shared workspace"
    : "Private workspace";
  elements.projectShareStatus.classList.toggle("shared", Boolean(project.sharing?.enabled));
  elements.projectPrivacyNotice.classList.toggle("shared", Boolean(project.sharing?.enabled));
  elements.projectPrivacyIcon.textContent = project.sharing?.enabled ? "↗" : "●";
  elements.projectPrivacyTitle.textContent = project.sharing?.enabled
    ? "This project shares work context with your team"
    : "This project is private to this machine";
  elements.projectPrivacyDetail.textContent = project.sharing?.enabled
    ? "Tickets, status, ownership, and project summaries synchronize through Git. Prompts, responses, source code, local paths, and full conversations stay private."
    : "Nothing is published until you explicitly share it. Your prompts, responses, source code, local paths, and conversation history remain private.";
  elements.projectPrivacyLabel.textContent = project.sharing?.enabled ? "Shared context" : "Private context";
  elements.projectBoardBoundary.textContent = project.sharing?.enabled
    ? "This board synchronizes with teammates. Session conversations and local file contents stay private."
    : "This board is private until you explicitly share the project.";
  elements.projectShareButton.textContent = project.sharing?.enabled ? "Sync shared project" : "Share project";
  elements.projectBoardTitle.textContent = state.fullBoard ? `${projectName(project)} board` : "All work in one place";
  elements.openFullBoardButton.classList.toggle("hidden", state.fullBoard);
  elements.closeFullBoardButton.classList.toggle("hidden", !state.fullBoard);
  elements.projectArchiveButton.textContent = project.status === "archived" ? "Restore project" : "Archive project";
  elements.addProjectSessionButton.disabled = project.status === "archived";
  elements.linkProjectWorkItemButton.disabled = project.status === "archived";
  document.querySelectorAll("[data-add-board-task]").forEach((button) => {
    button.disabled = project.status === "archived";
  });
  elements.openProjectButton.disabled = !sessions.length;
  elements.startProjectAction.disabled = !sessions.length;
  elements.projectNextAction.textContent = projectState?.nextAction || nextTasks[0]?.text || "No pending action. This project is complete.";
  elements.projectNextContext.textContent = projectState
    ? `From ${projectState.title} · ${relativeTime(projectState.updatedAt)}`
    : "Run /cw:wrap to establish the next project action.";
  elements.projectLastCompleted.textContent = completed[0]?.text || projectState?.lastAction || "No completed work recorded yet.";
  elements.projectCurrentWork.textContent = inProgress?.text || nextTasks[0]?.text || "No task is in progress.";
  elements.projectBlockedWork.textContent = blocked?.text || projectState?.unresolved?.[0] || "No blockers recorded.";
  elements.projectNextTasks.replaceChildren();
  nextTasks.forEach((task) => {
    const row = element("button", "project-next-task");
    row.type = "button";
    row.append(
      element("span", `project-task-status ${task.status}`, boardStatusLabels[task.status]),
      element("strong", "", task.text),
      element("small", "", task.sessionTitle)
    );
    row.addEventListener("click", showProjectBoard);
    elements.projectNextTasks.append(row);
  });
  if (!nextTasks.length) {
    const empty = element("div", "project-empty-tasks");
    empty.append(
      element("span", "project-empty-icon", "✓"),
      element("strong", "", "No open next tasks"),
      element("small", "", "Run /cw:wrap when new work is discovered.")
    );
    elements.projectNextTasks.append(empty);
  }

  elements.projectProgressLabel.textContent = `${progress}%`;
  elements.projectProgressValue.textContent = `${progress}%`;
  elements.projectProgressDetail.textContent = board.total ? `${board.counts.done || 0} of ${board.total} tasks` : "No tasks yet";
  elements.projectProgressRing.style.setProperty("--progress", progress);
  elements.projectProgressBar.style.width = `${progress}%`;
  elements.projectProgressLegend.textContent = `${board.counts.done || 0} done · ${board.total - (board.counts.done || 0)} open`;
  elements.projectEffortTime.textContent = duration ? formatMilliseconds(duration) : "—";
  elements.projectEffortCredits.textContent = credits ? formatCredits(credits) : "—";
  elements.projectEffortSessions.textContent = sessions.length;
  elements.projectEffortFiles.textContent = fileCount;
  elements.projectLatestSessionTitle.textContent = latestSession?.title || "No wrapped session yet";
  elements.projectLatestSessionSummary.textContent = latestSession?.summary || "Run /cw:wrap to connect session outcomes to this project.";
  elements.projectBoardTabCount.textContent = board.total;
  elements.projectSessionTabCount.textContent = sessions.length;
  renderProjectSessions(sessions);
  renderProjectInsights({ sessions, duration, credits, files: fileCount, board, progress });
}

function renderProjectSessions(sessions) {
  elements.projectSessionList.replaceChildren();
  sessions.forEach((session) => {
    const row = element("button", "project-session-row");
    row.type = "button";
    row.append(
      element("strong", "", session.title),
      element("span", "", session.summary || session.lastAction || "No checkpoint summary"),
      element("span", "", formatDuration(session.startedAt, session.endedAt || session.updatedAt)),
      element(
        "em",
        session.needsReview ? "needs-wrap" : "",
        session.needsReview ? "Needs wrap" : session.checkpointSource === "automatic" ? "Auto-wrapped" : "Wrapped"
      )
    );
    row.addEventListener("click", async () => {
      state.view = "sessions";
      localStorage.setItem("sessionHub.projectFirstView", "sessions");
      await selectSession(session.id);
      applyView();
    });
    elements.projectSessionList.append(row);
  });
  if (!sessions.length) {
    elements.projectSessionList.append(element("p", "board-empty", "No sessions are linked to this project yet."));
  }
}

function renderProjectInsights({ sessions, duration, credits, files, board, progress }) {
  elements.projectInsightsGrid.replaceChildren();
  const metrics = [
    ["Total effort", duration ? formatMilliseconds(duration) : "—", `Across ${sessions.length} sessions`],
    ["Completion", `${progress}%`, `${board.counts.done || 0} of ${board.total} tasks`],
    ["Average session", duration && sessions.length ? formatMilliseconds(duration / sessions.length) : "—", "Focused project time"],
    ["AI credits", credits ? formatCredits(credits) : "—", `${files} files recorded`]
  ];
  metrics.forEach(([label, value, detail]) => {
    const card = element("article", "project-insight");
    card.append(element("span", "", label), element("strong", "", value), element("small", "", detail));
    elements.projectInsightsGrid.append(card);
  });
}

async function openProjectNextSession() {
  const task = state.board?.tasks.find((item) => ["in_progress", "next"].includes(item.status));
  const sessionId = task?.sessionId || state.board?.projectState?.id || state.selectedProjectId;
  if (!sessionId) return;
  state.view = "sessions";
  localStorage.setItem("sessionHub.projectFirstView", "sessions");
  await selectSession(sessionId);
  applyView();
}

async function openProjectLatestSession() {
  const sessionId = state.board?.sessions?.[0]?.id || state.selectedProjectId;
  if (!sessionId) return;
  state.view = "sessions";
  localStorage.setItem("sessionHub.projectFirstView", "sessions");
  await selectSession(sessionId);
  applyView();
}

async function toggleProjectStar(projectId = state.selectedProjectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const starred = !project.starred;
  await api(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: "PATCH",
    body: { starred }
  });
  await refreshBoard();
  toast(starred ? "Project starred" : "Project unstarred");
}

async function toggleProjectArchive() {
  const project = state.board?.project;
  if (!project) return;
  const restoring = project.status === "archived";
  const openTaskCount = state.board.total - (state.board.counts.done || 0);
  const detail = restoring
    ? `Restore "${project.title}" to active projects?`
    : `Archive "${project.title}"? ${openTaskCount} unfinished ${openTaskCount === 1 ? "task" : "tasks"} will be preserved.`;
  if (!window.confirm(detail)) return;
  await api(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: "PATCH",
    body: restoring
      ? { status: "active" }
      : { status: "archived", confirmArchive: true }
  });
  toast(restoring ? "Project restored" : "Project archived");
  state.selectedProjectId = "";
  await refreshBoard();
}

function logLevel(type) {
  if (type.includes("error") || type.includes("failure")) return "error";
  if (type.includes("checkpoint") || type.includes("resume")) return "success";
  if (type.includes("end")) return "warning";
  return "info";
}

function renderProjectList() {
  if (state.view !== "board") return;
  const query = state.query.trim().toLowerCase();
  const projects = state.projects.filter(projectMatchesVisibility).filter((project) => {
    if (!query) return true;
    return [
      project.title,
      project.summary,
      project.repository,
      project.cwd,
      ...(project.files || []).map((file) => file.displayPath)
    ]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  elements.sessionList.replaceChildren();
  const groups = state.projectFilter === "active"
    ? [
        ["Shared projects", projects.filter((project) => project.sharing?.enabled)],
        ["Private projects", projects.filter((project) => !project.sharing?.enabled)]
      ]
    : [[state.projectFilter === "shared" ? "Shared projects" : state.projectFilter === "private" ? "Private projects" : "Archived projects", projects]];
  for (const [label, groupProjects] of groups) {
    if (!groupProjects.length) continue;
    const heading = element("div", "project-list-group");
    heading.append(element("span", "", label), element("b", "", String(groupProjects.length)));
    elements.sessionList.append(heading);
    for (const project of groupProjects) {
      const row = element("div", `session-entry${project.starred ? " starred" : ""}`);
      const button = document.createElement("button");
      button.className = `session-item${project.id === state.selectedProjectId ? " selected" : ""}`;
      button.dataset.id = project.id;
      const copy = element("span", "session-copy");
      const time = element("span", "session-time", relativeTime(project.updatedAt));
      const context = element(
        "span",
        project.sharing?.enabled ? "shared-context" : "private-context",
        `${project.sharing?.enabled ? "Shared context" : "Private context"} · ${project.sessionCount || 0} ${project.sessionCount === 1 ? "session" : "sessions"} · ${project.openTaskCount} open`
      );
      const meta = element("span", "session-meta-row");
      meta.append(context, time);
      copy.append(element("strong", "", projectName(project)), meta);
      button.append(copy);
      button.addEventListener("click", async () => {
        state.selectedProjectId = project.id;
        localStorage.setItem("sessionHub.projectId", project.id);
        await refreshBoard();
        document.querySelector(".sidebar").classList.remove("open");
      });
      const star = createStarButton(project.starred, "project", () => toggleProjectStar(project.id));
      row.append(button, star);
      elements.sessionList.append(row);
    }
  }
  if (!projects.length && !state.unassignedCount) {
    const emptyText = state.projectFilter === "archived"
      ? "No archived projects."
      : state.projectFilter === "shared"
        ? "No shared projects yet. Open a project and choose Share project."
        : state.projectFilter === "private"
          ? "No private projects. Shared projects are available from the Shared filter."
        : "No sessions are tracked as projects yet.";
    elements.sessionList.append(element("p", "empty-copy", state.projects.length ? "No projects match your search." : emptyText));
  }
}

function projectMatchesVisibility(project) {
  if (state.fullBoard) return project.id === fullBoardProjectId;
  if (state.projectFilter === "shared") return Boolean(project.sharing?.enabled);
  if (state.projectFilter === "private") return !project.sharing?.enabled;
  return true;
}

function showProjectBoard() {
  setProjectTab("overview");
  requestAnimationFrame(() => elements.projectBoardPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function openFullBoard() {
  const projectId = state.board?.project?.id || state.selectedProjectId;
  if (!projectId) return;
  window.open(`${window.location.origin}/?board=${encodeURIComponent(projectId)}`, "_blank", "noopener");
}

function closeFullBoard() {
  window.close();
  window.setTimeout(() => {
    if (!window.closed) window.location.assign(window.location.origin);
  }, 100);
}

async function openUnassignedSessions() {
  state.view = "sessions";
  state.filter = "unassigned";
  localStorage.setItem("sessionHub.projectFirstView", "sessions");
  document.querySelectorAll(".filter").forEach((button) => {
    const active = button.dataset.filter === "unassigned";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  await refresh({ preserveSelection: false });
  closeSidebar();
}

function createStarButton(starred, target, onClick) {
  const button = element("button", `session-star${starred ? " starred" : ""}`, starred ? "★" : "☆");
  button.type = "button";
  button.setAttribute("aria-label", `${starred ? "Unstar" : "Star"} ${target}`);
  button.setAttribute("aria-pressed", starred ? "true" : "false");
  button.title = `${starred ? "Unstar" : "Star"} ${target}`;
  button.addEventListener("click", onClick);
  return button;
}

function renderBoardCard(task) {
  const archived = state.board?.project?.status === "archived";
  const card = element("article", `kanban-card${task.status === "done" ? " done-card" : ""}`);
  card.draggable = !archived;
  card.dataset.taskId = task.id;
  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", String(task.id));
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const session = element("div", "card-session");
  session.append(element("span", "", task.sessionTitle));
  const open = element("button");
  open.title = "Open session";
  open.setAttribute("aria-label", `Open ${task.sessionTitle}`);
  open.innerHTML = '<svg viewBox="0 0 24 24"><path d="m13 5 7 7-7 7-1.4-1.4 4.6-4.6H4v-2h12.2l-4.6-4.6L13 5Z"/></svg>';
  open.addEventListener("click", async () => {
    state.view = "sessions";
    localStorage.setItem("sessionHub.projectFirstView", "sessions");
    await selectSession(task.sessionId);
    applyView();
  });
  session.append(open);

  const heading = element("div", "card-heading");
  if (task.ticketId) heading.append(element("span", "ticket-id", task.ticketId));
  heading.append(element("p", "card-text", task.text));
  const description = task.description ? element("p", "card-description", task.description) : null;
  const meta = element("div", "card-meta");
  meta.append(element(
    "span",
    "",
    task.owner || basename(task.repository) || basename(task.cwd) || "Unassigned"
  ));
  const select = document.createElement("select");
  select.className = "card-status";
  select.disabled = archived;
  Object.entries(boardStatusLabels).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = task.status === value;
    select.append(option);
  });
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", async () => {
    await moveTask(task.id, select.value);
  });
  meta.append(select);
  card.append(session, heading);
  if (description) card.append(description);
  card.append(meta);
  return card;
}

function openBoardTaskForm(status, trigger) {
  if (!state.selectedProjectId || !boardStatusLabels[status]) return;
  const container = document.querySelector(`[data-dropzone="${status}"]`);
  const existing = container.querySelector(".board-task-form");
  if (existing) {
    existing.querySelector("input").focus();
    return;
  }
  document.querySelectorAll(".board-task-form").forEach((form) => form.remove());
  const form = element("form", "board-task-form");
  const input = document.createElement("input");
  input.placeholder = `Short ticket title`;
  input.setAttribute("aria-label", `Ticket title for ${boardStatusLabels[status]}`);
  input.maxLength = 500;
  input.required = true;
  const description = document.createElement("textarea");
  description.placeholder = "Short description";
  description.setAttribute("aria-label", "Ticket description");
  description.maxLength = 1000;
  description.rows = 2;
  const actions = element("div", "board-task-actions");
  const cancel = element("button", "button secondary", "Cancel");
  cancel.type = "button";
  const submit = element("button", "button primary", "Add");
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(input, description, actions);
  container.prepend(form);
  cancel.addEventListener("click", () => {
    form.remove();
    trigger.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      form.remove();
      trigger.focus();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    await api(`/api/projects/${encodeURIComponent(state.selectedProjectId)}/tasks`, {
      method: "POST",
      body: { text, description: description.value.trim(), status }
    });
    await refreshBoard();
    toast(`Task added to ${boardStatusLabels[status]}`);
  });
  input.focus();
}

function bindBoardDropzones() {
  document.querySelectorAll("[data-dropzone]").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.classList.remove("drag-over");
      const taskId = Number(event.dataTransfer.getData("text/plain"));
      if (taskId) await moveTask(taskId, zone.dataset.dropzone);
    });
  });
}

async function moveTask(taskId, status) {
  await api(`/api/tasks/${taskId}`, { method: "PATCH", body: { status } });
  await refreshBoard();
}

async function action(name) {
  if (name === "clear-search") {
    state.query = "";
    elements.searchInput.value = "";
    await refresh({ preserveSelection: false });
    elements.searchInput.focus();
    return;
  }
  if (name === "show-wrapped" || name === "show-active") {
    const nextFilter = name === "show-active" ? "active" : "wrapped";
    state.filter = nextFilter;
    document.querySelectorAll(".filter").forEach((button) => {
      const active = button.dataset.filter === nextFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    await refresh({ preserveSelection: false });
    return;
  }
  if (name === "import-history") {
    const result = await api("/api/import-history", { method: "POST" });
    if (result.error === "SOURCE_DB_UNAVAILABLE") toast("Copilot session history is unavailable on this machine", true);
    else if (result.error === "SOURCE_SCHEMA_UNSUPPORTED" || result.filesAvailable === false) toast("This Copilot history format does not include worked-on files", true);
    else if (result.imported) toast(`Imported ${result.imported} old sessions`);
    else if (result.fileSessions) toast(`Updated file history for ${result.fileSessions} sessions`);
    else toast("Session history is already up to date");
    await refresh({ preserveSelection: true });
    return;
  }
  if (!state.selected) return;
  if (name === "track-project") {
    await openSelectedProject();
  } else if (name === "pin") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, { method: "PATCH", body: { pinned: !state.selected.pinned } });
    toast(state.selected.pinned ? "Session unstarred" : "Session starred");
    await refresh();
  } else if (name === "archive") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, { method: "PATCH", body: { archived: !state.selected.archived } });
    toast(state.selected.archived ? "Session restored" : "Session archived");
    await refresh({ preserveSelection: false });
  } else if (name === "auto-wrap") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, {
      method: "PATCH",
      body: { autoWrap: !state.selected.autoWrapEnabled }
    });
    toast(state.selected.autoWrapEnabled ? "Auto-wrap disabled for this session" : "Auto-wrap enabled for this session");
    await selectSession(state.selected.id);
  } else if (name === "folder") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/folder`, { method: "POST" });
    toast("Opened working directory");
  }
}

async function openSelectedProject() {
  if (!state.selected) return;
  if (!state.selected.projectId) {
    await openProjectDialog(state.selected.id);
    return;
  }
  state.projectFilter = state.selected.project?.status === "archived" ? "archived" : "active";
  localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
  state.selectedProjectId = state.selected.projectId;
  localStorage.setItem("sessionHub.projectId", state.selected.projectId);
  state.view = "board";
  localStorage.setItem("sessionHub.projectFirstView", "board");
  await refreshBoard();
  applyView();
}

async function openProjectDialog(sessionId = "") {
  modalReturnFocus = document.activeElement;
  state.projectDialogSessionId = sessionId;
  const session = sessionId
    ? (state.selected?.id === sessionId ? state.selected : await api(`/api/sessions/${encodeURIComponent(sessionId)}`))
    : null;
  const projects = session
    ? await api(`/api/project-suggestions?sessionId=${encodeURIComponent(session.id)}`)
    : await api("/api/projects");
  elements.projectDialogTitle.textContent = session ? "Choose a project" : "Create a project";
  elements.projectDialogContext.textContent = session
    ? `${session.title} can belong to one goal-based project. Choosing another project moves it.`
    : "Create a goal-based workstream. You can add sessions afterward.";
  document.querySelector(".project-link-controls").classList.toggle("hidden", !session);
  elements.projectLinkSelect.replaceChildren();
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = `${project.suggested ? `${project.suggestionReason} · ` : ""}${project.title}`;
    option.selected = project.id === session?.projectId;
    elements.projectLinkSelect.append(option);
  });
  elements.projectLinkSelect.disabled = !projects.length;
  elements.linkProjectButton.disabled = !projects.length;
  elements.linkProjectButton.textContent = session?.projectId ? "Move session" : "Link session";
  elements.unlinkProjectButton.classList.toggle("hidden", !session?.projectId);
  elements.projectAutoWrapChoice.checked = session?.autoWrapMode === "inherit"
    ? state.settings?.autoWrap?.enabled === true
    : Boolean(session?.autoWrapEnabled);
  elements.projectAutoWrapChoice.closest("label").classList.toggle("hidden", !session);
  elements.newProjectTitle.value = "";
  elements.newProjectDescription.value = "";
  elements.projectDialog.classList.remove("hidden");
  (session && projects.length ? elements.projectLinkSelect : elements.newProjectTitle).focus();
}

function closeProjectDialog() {
  const wasOpen = !elements.projectDialog.classList.contains("hidden");
  elements.projectDialog.classList.add("hidden");
  state.projectDialogSessionId = "";
  if (wasOpen) modalReturnFocus?.focus();
}

async function createProjectFromDialog(event) {
  event.preventDefault();
  const project = await api("/api/projects", {
    method: "POST",
    body: {
      title: elements.newProjectTitle.value,
      description: elements.newProjectDescription.value,
      sessionId: state.projectDialogSessionId || undefined,
      autoWrap: state.projectDialogSessionId ? elements.projectAutoWrapChoice.checked : undefined
    }
  });
  state.projectFilter = "active";
  localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
  state.selectedProjectId = project.id;
  localStorage.setItem("sessionHub.projectId", project.id);
  closeProjectDialog();
  state.view = "board";
  localStorage.setItem("sessionHub.projectFirstView", "board");
  await refreshBoard();
  applyView();
  toast(`Created ${project.title}`);
}

async function linkProjectFromDialog() {
  const projectId = elements.projectLinkSelect.value;
  const sessionId = state.projectDialogSessionId;
  if (!projectId || !sessionId) return;
  await api(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: "POST",
    body: { sessionId, autoWrap: elements.projectAutoWrapChoice.checked }
  });
  state.projectFilter = "active";
  localStorage.setItem("sessionHub.projectFilter", state.projectFilter);
  state.selectedProjectId = projectId;
  localStorage.setItem("sessionHub.projectId", projectId);
  closeProjectDialog();
  state.view = "board";
  localStorage.setItem("sessionHub.projectFirstView", "board");
  await refreshBoard();
  applyView();
  toast("Session linked to project");
}

async function unlinkProjectFromDialog() {
  const sessionId = state.projectDialogSessionId;
  const projectId = state.selected?.id === sessionId ? state.selected.projectId : "";
  if (!sessionId || !projectId) return;
  await api(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
  closeProjectDialog();
  await refresh({ preserveSelection: true });
  toast("Session moved to Unassigned");
}

async function openProjectSessionDialog() {
  if (!state.selectedProjectId || state.board?.project?.status === "archived") return;
  modalReturnFocus = document.activeElement;
  const projectId = state.selectedProjectId;
  const projectTitle = projectName(state.board.project);
  const requestId = ++state.projectSessionDialogRequest;
  state.projectSessionDialogProjectId = projectId;
  const sessions = await api("/api/sessions?filter=unassigned");
  if (requestId !== state.projectSessionDialogRequest) return;
  if (state.selectedProjectId !== projectId || state.board?.project?.id !== projectId || state.board.project.status === "archived") {
    state.projectSessionDialogProjectId = "";
    toast("The selected project changed. Open Add session again.", true);
    return;
  }
  elements.projectSessionDialogTitle.textContent = `Add a session to ${projectTitle}`;
  elements.projectSessionSelect.replaceChildren();
  sessions.forEach((session) => {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `${session.title} · ${session.providerName || "AI CLI"} · ${basename(session.repository) || basename(session.cwd) || "No workspace"}`;
    elements.projectSessionSelect.append(option);
  });
  const hasSessions = sessions.length > 0;
  elements.projectSessionSelect.classList.toggle("hidden", !hasSessions);
  elements.projectSessionEmpty.classList.toggle("hidden", hasSessions);
  elements.linkSelectedProjectSession.disabled = !hasSessions;
  elements.projectSessionAutoWrap.checked = state.settings?.autoWrap?.enabled === true;
  elements.projectSessionAutoWrap.closest("label").classList.toggle("hidden", !hasSessions);
  elements.projectSessionDialog.classList.remove("hidden");
  (hasSessions ? elements.projectSessionSelect : elements.closeProjectSessionDialog).focus();
}

function closeProjectSessionDialog() {
  const wasOpen = !elements.projectSessionDialog.classList.contains("hidden");
  elements.projectSessionDialog.classList.add("hidden");
  state.projectSessionDialogRequest += 1;
  state.projectSessionDialogProjectId = "";
  if (wasOpen) modalReturnFocus?.focus();
}

async function linkSelectedProjectSession(event) {
  event.preventDefault();
  const sessionId = elements.projectSessionSelect.value;
  const projectId = state.projectSessionDialogProjectId;
  if (!sessionId || !projectId) return;
  if (projectId !== state.selectedProjectId || state.board?.project?.id !== projectId || state.board.project.status === "archived") {
    closeProjectSessionDialog();
    toast("The selected project changed. Open Add session again.", true);
    return;
  }
  elements.linkSelectedProjectSession.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
      method: "POST",
      body: { sessionId, autoWrap: elements.projectSessionAutoWrap.checked, requireUnassigned: true }
    });
    closeProjectSessionDialog();
    await refreshBoard();
    setProjectTab("sessions");
    toast("Session added to project");
  } finally {
    elements.linkSelectedProjectSession.disabled = false;
  }
}

async function resumeSelected() {
  if (!state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/resume`, { method: "POST" });
  toast(`${state.selected.providerName || "AI CLI"} resume launched in a new terminal`);
}

async function copyResumeCommand() {
  if (!state.selected) return;
  const command = state.selected.resumeCommand;
  try {
    await navigator.clipboard.writeText(command);
    toast("Resume command copied");
  } catch {
    toast(`Copy failed. Use: ${command}`, true);
  }
}

function openSidebar() {
  document.querySelector(".sidebar").classList.add("open");
  document.querySelector(".sidebar").removeAttribute("inert");
  elements.sidebarBackdrop.classList.remove("hidden");
  elements.mobileMenu.setAttribute("aria-expanded", "true");
  elements.closeSidebar.focus();
}

function closeSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar.classList.contains("open")) return;
  sidebar.classList.remove("open");
  elements.sidebarBackdrop.classList.add("hidden");
  elements.mobileMenu.setAttribute("aria-expanded", "false");
  elements.mobileMenu.focus();
  syncSidebarAccessibility();
}

function syncSidebarAccessibility() {
  const sidebar = document.querySelector(".sidebar");
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  if (mobile && !sidebar.classList.contains("open")) sidebar.setAttribute("inert", "");
  else sidebar.removeAttribute("inert");
}

function openDialog(field) {
  if (!state.selected) return;
  modalReturnFocus = document.activeElement;
  const labels = { title: "Session title", summary: "Session summary", lastAction: "Last completed action", nextAction: "Recommended next action" };
  state.editField = field;
  elements.editTitle.textContent = labels[field];
  elements.editInput.value = state.selected[field] || "";
  elements.editDialog.classList.remove("hidden");
  elements.editInput.focus();
}

function closeDialog() {
  const wasOpen = !elements.editDialog.classList.contains("hidden");
  elements.editDialog.classList.add("hidden");
  state.editField = null;
  if (wasOpen) modalReturnFocus?.focus();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!state.editField || !state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, {
    method: "PATCH",
    body: { [state.editField]: elements.editInput.value }
  });
  closeDialog();
  await selectSession(state.selectedId);
  toast("Checkpoint updated");
}

async function addTask(event) {
  event.preventDefault();
  const text = elements.taskInput.value.trim();
  if (!text || !state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/tasks`, { method: "POST", body: { text } });
  elements.taskInput.value = "";
  await selectSession(state.selectedId);
}

async function addWorkItem(event) {
  event.preventDefault();
  const projectTarget = state.workItemTarget === "project";
  if (projectTarget ? !state.selectedProjectId : !state.selected) return;
  const endpoint = projectTarget
    ? `/api/projects/${encodeURIComponent(state.selectedProjectId)}/work-items`
    : `/api/sessions/${encodeURIComponent(state.selected.id)}/work-items`;
  await api(endpoint, {
    method: "POST",
    body: {
      type: elements.workItemType.value,
      url: elements.workItemUrl.value,
      title: elements.workItemTitle.value
    }
  });
  elements.workItemUrl.value = "";
  elements.workItemTitle.value = "";
  if (projectTarget) await refreshBoard();
  else await selectSession(state.selected.id);
  closeWorkItemDialog();
  toast(projectTarget ? "Work item linked to project" : "Work item linked");
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("sessionHub.theme", next);
}

const savedTheme = localStorage.getItem("sessionHub.theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(result.error || "Request failed", true);
    throw new Error(result.error || `Request failed: ${response.status}`);
  }
  return result;
}

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? "var(--cp-danger)" : "var(--cp-accent)";
  elements.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.add("hidden"), 2800);
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function projectMetaChip(kind, text) {
  const icons = {
    sessions: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v13H7l-3 3V4Zm2 2v9.17L6.17 15H18V6H6Z"/></svg>',
    branch: '<svg aria-hidden="true" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 8c2 3 6 3 8 0"/></svg>',
    folder: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5h7l2 2h9v12H3V5Zm2 4v8h14V9H5Z"/></svg>'
  };
  const chip = element("span", `project-meta-chip ${kind}`);
  chip.innerHTML = icons[kind];
  chip.append(document.createTextNode(text));
  return chip;
}

function relativeTime(timestamp) {
  if (!timestamp) return "never";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function formatDuration(start, end) {
  if (!start) return "Unknown";
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function sessionDurationMs(session) {
  if (!session.startedAt) return 0;
  return Math.max(0, (session.endedAt || session.updatedAt || session.startedAt) - session.startedAt);
}

function formatMilliseconds(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatCredits(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function renderSessionMetrics(metrics = {}) {
  const tokens = metrics.currentTokens;
  const limit = metrics.contextLimit;
  if (Number.isFinite(tokens)) {
    const percentage = Number.isFinite(limit) && limit > 0 ? Math.round(tokens / limit * 100) : null;
    elements.contextMetric.textContent = percentage === null
      ? formatNumber(tokens)
      : `${percentage}%`;
    elements.contextDetail.textContent = Number.isFinite(limit)
      ? `${formatNumber(tokens)} / ${formatNumber(limit)} tokens`
      : `${formatNumber(tokens)} tokens`;
  } else {
    elements.contextMetric.textContent = "Unavailable";
    elements.contextDetail.textContent = "Wrap to capture";
  }
  if (Number.isFinite(metrics.aiCredits)) {
    elements.creditMetric.textContent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metrics.aiCredits);
    elements.creditDetail.textContent = "AI credits used";
  } else {
    elements.creditMetric.textContent = "Unavailable";
    elements.creditDetail.textContent = "Wrap to capture";
  }
  elements.modelMetric.textContent = metrics.model || "Unavailable";
  elements.tierMetric.textContent = metrics.contextTier
    ? metrics.contextTier.replaceAll("_", " ")
    : "At last wrap";
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function basename(path = "") {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function projectName(project) {
  return project.title || basename(project.repository) || basename(project.cwd) || "Untitled project";
}

function shortSessionId(value = "") {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "Session ID";
}

function formatToolName(value = "") {
  return value ? value.replaceAll("_", " ").replaceAll("-", " ") : "Worked on";
}

function debounce(fn, milliseconds) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), milliseconds);
  };
}
