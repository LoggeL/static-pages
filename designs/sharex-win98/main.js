import sharexLogoUrl from "./assets/sharex-logo.svg";

const desktop = document.querySelector("#desktop");
const windows = new Map([...document.querySelectorAll("[data-window]")].map((windowElement) => [windowElement.dataset.window, windowElement]));
const taskButtons = document.querySelector("#task-buttons");
const startButton = document.querySelector("#start-button");
const startMenu = document.querySelector("#start-menu");
const contextMenu = document.querySelector("#desktop-context");
const liveRegion = document.querySelector("#live-region");
const taskbarClock = document.querySelector("#taskbar-clock");
const trayBalloon = document.querySelector("#tray-balloon");
const compactQuery = window.matchMedia("(max-width: 900px)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let topZ = 30;
let activeWindowId = "sharex";
let lastLauncher = null;
let uploadTimer = null;

function announce(message) {
  liveRegion.textContent = "";
  window.setTimeout(() => { liveRegion.textContent = message; }, 20);
}

function getWindowIcon(id) {
  if (id === "sharex") return `<img src="${sharexLogoUrl}" alt="" width="18" height="18">`;
  const icons = { "upload-queue": "⇧", tip: "💡", "capture-wizard": "📷", annotation: "🎨", about: "ⓘ", "download-dialog": "💾", properties: "🖥", "recycle-dialog": "🗑", "system-dialog": "ⓘ" };
  return `<span aria-hidden="true">${icons[id] || "▣"}</span>`;
}

function updateTaskbar() {
  taskButtons.innerHTML = "";
  windows.forEach((windowElement, id) => {
    if (!windowElement.classList.contains("is-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-button";
    if (id === activeWindowId && !windowElement.classList.contains("is-minimized")) button.classList.add("is-active");
    button.dataset.taskWindow = id;
    button.setAttribute("aria-label", `${windowElement.classList.contains("is-minimized") ? "Restore" : "Focus"} ${windowElement.dataset.taskLabel}`);
    button.innerHTML = `${getWindowIcon(id)}<b>${windowElement.dataset.taskLabel}</b>`;
    button.addEventListener("click", () => {
      if (windowElement.classList.contains("is-minimized")) {
        windowElement.classList.remove("is-minimized");
        focusWindow(windowElement);
      } else if (id === activeWindowId) {
        minimizeWindow(windowElement);
      } else {
        focusWindow(windowElement);
      }
    });
    taskButtons.append(button);
  });
}

function focusWindow(windowElement) {
  if (!windowElement || !windowElement.classList.contains("is-open")) return;
  document.querySelectorAll(".window.is-active").forEach((element) => element.classList.remove("is-active"));
  windowElement.classList.remove("is-minimized");
  windowElement.classList.add("is-active");
  windowElement.style.zIndex = String(++topZ);
  activeWindowId = windowElement.dataset.window;
  updateTaskbar();
}

function openWindow(id, launcher = null) {
  const windowElement = windows.get(id);
  if (!windowElement) return;
  if (launcher) lastLauncher = launcher;
  windowElement.classList.add("is-open");
  windowElement.classList.remove("is-minimized");
  windowElement.setAttribute("aria-hidden", "false");
  if (!windowElement.dataset.hasPositioned && !compactQuery.matches && !["sharex", "upload-queue", "tip"].includes(id)) {
    const width = windowElement.offsetWidth || 500;
    const height = windowElement.offsetHeight || 400;
    windowElement.style.left = `${Math.max(8, Math.round((window.innerWidth - width) / 2))}px`;
    windowElement.style.top = `${Math.max(8, Math.round((window.innerHeight - height - 38) / 2))}px`;
    windowElement.dataset.hasPositioned = "true";
  }
  focusWindow(windowElement);
  closeStartMenu();
  closeContextMenu();
  const focusTarget = windowElement.querySelector("button:not([disabled]), a, input:not([disabled])");
  if (focusTarget && windowElement.getAttribute("role")?.includes("dialog")) window.setTimeout(() => focusTarget.focus(), 0);
  announce(`${windowElement.dataset.taskLabel} opened.`);
}

function minimizeWindow(windowElement) {
  windowElement.classList.add("is-minimized");
  windowElement.classList.remove("is-active");
  if (activeWindowId === windowElement.dataset.window) activeWindowId = "";
  const remaining = [...document.querySelectorAll(".window.is-open:not(.is-minimized)")].sort((a, b) => Number(b.style.zIndex || 10) - Number(a.style.zIndex || 10))[0];
  if (remaining) focusWindow(remaining); else updateTaskbar();
}

function closeWindow(windowElement) {
  const label = windowElement.dataset.taskLabel;
  windowElement.classList.remove("is-open", "is-minimized", "is-active");
  windowElement.setAttribute("aria-hidden", "true");
  if (activeWindowId === windowElement.dataset.window) activeWindowId = "";
  const remaining = [...document.querySelectorAll(".window.is-open:not(.is-minimized)")].sort((a, b) => Number(b.style.zIndex || 10) - Number(a.style.zIndex || 10))[0];
  if (remaining) focusWindow(remaining); else updateTaskbar();
  if (lastLauncher?.isConnected) lastLauncher.focus();
  announce(`${label} closed.`);
}

function toggleMaximize(windowElement) {
  if (compactQuery.matches) return;
  windowElement.classList.toggle("is-maximized");
  focusWindow(windowElement);
}

function closeStartMenu() {
  startMenu.hidden = true;
  startMenu.setAttribute("aria-hidden", "true");
  startButton.setAttribute("aria-expanded", "false");
}

function toggleStartMenu() {
  const willOpen = startMenu.hidden;
  startMenu.hidden = !willOpen;
  startMenu.setAttribute("aria-hidden", String(!willOpen));
  startButton.setAttribute("aria-expanded", String(willOpen));
  closeContextMenu();
  if (willOpen) startMenu.querySelector("button")?.focus();
}

function closeContextMenu() {
  contextMenu.hidden = true;
}

function closeAppMenus(except = null) {
  document.querySelectorAll(".menu-button").forEach((button) => {
    if (button === except) return;
    button.setAttribute("aria-expanded", "false");
    button.nextElementSibling.hidden = true;
  });
}

function switchView(viewId) {
  const sharex = windows.get("sharex");
  openWindow("sharex");
  sharex.querySelectorAll("[data-app-view]").forEach((view) => view.classList.toggle("is-visible", view.dataset.appView === viewId));
  sharex.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-selected", button.dataset.view === viewId));
  const visibleView = sharex.querySelector(`[data-app-view="${viewId}"]`);
  visibleView?.scrollTo?.(0, 0);
  closeAppMenus();
}

document.addEventListener("pointerdown", (event) => {
  const windowElement = event.target.closest(".window");
  if (windowElement) focusWindow(windowElement);
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-window-action]");
  if (action) {
    const windowElement = action.closest(".window");
    const command = action.dataset.windowAction;
    if (command === "minimize") minimizeWindow(windowElement);
    if (command === "maximize") toggleMaximize(windowElement);
    if (command === "close") closeWindow(windowElement);
    return;
  }

  if (event.target.closest("[data-window-action-external='minimize']")) {
    minimizeWindow(windows.get("sharex"));
    closeAppMenus();
    return;
  }

  const openTrigger = event.target.closest("[data-open]");
  if (openTrigger && !openTrigger.classList.contains("desktop-icon")) {
    openWindow(openTrigger.dataset.open, openTrigger);
    if (openTrigger.dataset.viewTarget) switchView(openTrigger.dataset.viewTarget);
  }

  const viewTrigger = event.target.closest("[data-view], [data-view-target]");
  if (viewTrigger && !viewTrigger.classList.contains("desktop-icon")) {
    switchView(viewTrigger.dataset.view || viewTrigger.dataset.viewTarget);
  }

  const messageTrigger = event.target.closest("[data-system-message]");
  if (messageTrigger) {
    document.querySelector("#system-message").textContent = messageTrigger.dataset.systemMessage;
    openWindow("system-dialog", messageTrigger);
  }

  if (!event.target.closest(".menu-group")) closeAppMenus();
  if (!event.target.closest("#start-menu") && !event.target.closest("#start-button")) closeStartMenu();
  if (!event.target.closest("#desktop-context")) closeContextMenu();
});

startButton.addEventListener("click", toggleStartMenu);

document.querySelectorAll(".menu-button").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = button.getAttribute("aria-expanded") === "true";
    closeAppMenus(button);
    button.setAttribute("aria-expanded", String(!isOpen));
    button.nextElementSibling.hidden = isOpen;
  });
});

document.querySelectorAll(".desktop-icon").forEach((icon) => {
  icon.addEventListener("click", () => {
    document.querySelectorAll(".desktop-icon.is-selected").forEach((item) => item.classList.remove("is-selected"));
    icon.classList.add("is-selected");
    if (compactQuery.matches || window.matchMedia("(pointer: coarse)").matches) {
      openWindow(icon.dataset.open, icon);
      if (icon.dataset.viewTarget) switchView(icon.dataset.viewTarget);
    }
  });
  icon.addEventListener("dblclick", () => {
    openWindow(icon.dataset.open, icon);
    if (icon.dataset.viewTarget) switchView(icon.dataset.viewTarget);
  });
  icon.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      openWindow(icon.dataset.open, icon);
      if (icon.dataset.viewTarget) switchView(icon.dataset.viewTarget);
    }
  });
});

desktop.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".window, .taskbar, .start-menu")) return;
  event.preventDefault();
  contextMenu.hidden = false;
  const maxX = window.innerWidth - 198;
  const maxY = window.innerHeight - 190 - 38;
  contextMenu.style.left = `${Math.max(3, Math.min(event.clientX, maxX))}px`;
  contextMenu.style.top = `${Math.max(3, Math.min(event.clientY, maxY))}px`;
  contextMenu.querySelector("button")?.focus();
});

document.querySelector("[data-context-refresh]").addEventListener("click", () => {
  desktop.classList.remove("desktop-refresh");
  void desktop.offsetWidth;
  desktop.classList.add("desktop-refresh");
  announce("Desktop refreshed.");
});
document.querySelector("[data-context-arrange]").addEventListener("click", () => {
  document.querySelector(".desktop-icons").classList.toggle("is-reversed");
  announce("Desktop icons arranged.");
});

function wireWindowDragging(windowElement) {
  const handle = windowElement.querySelector("[data-drag-handle]");
  if (!handle) return;
  handle.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button")) toggleMaximize(windowElement);
  });
  handle.addEventListener("pointerdown", (event) => {
    if (compactQuery.matches || event.button !== 0 || event.target.closest("button") || windowElement.classList.contains("is-maximized")) return;
    event.preventDefault();
    focusWindow(windowElement);
    const rect = windowElement.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-dragging");
    const onMove = (moveEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - 110);
      const maxTop = Math.max(0, window.innerHeight - 38 - 25);
      windowElement.style.left = `${Math.max(0, Math.min(moveEvent.clientX - offsetX, maxLeft))}px`;
      windowElement.style.top = `${Math.max(0, Math.min(moveEvent.clientY - offsetY, maxTop))}px`;
      windowElement.style.right = "auto";
      windowElement.style.bottom = "auto";
    };
    const onUp = () => {
      handle.releasePointerCapture?.(event.pointerId);
      document.body.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function wireWindowResize(windowElement) {
  const grip = windowElement.querySelector("[data-resize-handle]");
  if (!grip) return;
  grip.addEventListener("pointerdown", (event) => {
    if (compactQuery.matches || windowElement.classList.contains("is-maximized")) return;
    event.preventDefault();
    const rect = windowElement.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    grip.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => {
      windowElement.style.width = `${Math.max(720, rect.width + moveEvent.clientX - startX)}px`;
      windowElement.style.height = `${Math.max(520, rect.height + moveEvent.clientY - startY)}px`;
    };
    const onUp = () => {
      grip.releasePointerCapture?.(event.pointerId);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });
}

windows.forEach((windowElement) => { wireWindowDragging(windowElement); wireWindowResize(windowElement); });

document.querySelectorAll("[data-capture-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-capture-mode]").forEach((item) => item.classList.remove("is-picked"));
    button.classList.add("is-picked");
  });
});

document.querySelectorAll(".destination-list button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".destination-list button").forEach((item) => { item.classList.remove("is-selected"); item.setAttribute("aria-selected", "false"); });
    button.classList.add("is-selected");
    button.setAttribute("aria-selected", "true");
    document.querySelector("#destination-name").textContent = button.querySelector("b").textContent;
    document.querySelector("#destination-copy").textContent = button.querySelector("small").textContent + ". ShareX will route finished captures here automatically.";
  });
});

let wizardStep = 0;
const wizardPages = [...document.querySelectorAll("[data-wizard-page]")];
const wizardNext = document.querySelector("#wizard-next");
const wizardBack = document.querySelector("#wizard-back");
const wizardHeadings = ["Choose what to capture", "Choose after-capture tasks", "Confirm your capture"];
function renderWizard() {
  wizardPages.forEach((page, index) => page.classList.toggle("is-visible", index === wizardStep));
  document.querySelector("#wizard-heading").textContent = wizardHeadings[wizardStep];
  document.querySelector("#wizard-subtitle").textContent = `Step ${wizardStep + 1} of 3`;
  wizardBack.disabled = wizardStep === 0;
  wizardNext.textContent = wizardStep === 2 ? "Begin Capture" : "Next >";
  document.querySelector("#wizard-summary-mode").textContent = document.querySelector("input[name='wizard-mode']:checked")?.value || "Region";
}
wizardNext.addEventListener("click", () => {
  if (wizardStep < 2) { wizardStep += 1; renderWizard(); }
  else { wizardStep = 0; renderWizard(); closeWindow(windows.get("capture-wizard")); beginRegionCapture(); }
});
wizardBack.addEventListener("click", () => { if (wizardStep > 0) { wizardStep -= 1; renderWizard(); } });
document.querySelector("#wizard-cancel").addEventListener("click", () => { wizardStep = 0; renderWizard(); closeWindow(windows.get("capture-wizard")); });
document.querySelectorAll("input[name='wizard-mode']").forEach((radio) => radio.addEventListener("change", () => {
  document.querySelectorAll(".wizard-options label").forEach((label) => label.classList.toggle("is-picked", label.contains(document.querySelector("input[name='wizard-mode']:checked"))));
}));

const regionOverlay = document.querySelector("#region-overlay");
const regionSelection = document.querySelector("#region-selection");
const regionDimensions = document.querySelector("#region-dimensions");
const crosshair = document.querySelector("#crosshair");
const magnifier = document.querySelector("#magnifier");
let selectionOrigin = null;
let selectionComplete = false;

function beginRegionCapture() {
  closeStartMenu();
  closeAppMenus();
  regionOverlay.hidden = false;
  regionSelection.hidden = true;
  selectionOrigin = null;
  selectionComplete = false;
  regionOverlay.focus();
  announce("Region capture started. Drag to select an area, or press Enter for a demo selection.");
}

function cancelRegionCapture() {
  regionOverlay.hidden = true;
  selectionOrigin = null;
  announce("Region capture canceled.");
}

function completeRegionCapture() {
  if (selectionComplete) return;
  selectionComplete = true;
  regionOverlay.hidden = true;
  openWindow("annotation");
  announce("Capture complete. Annotation editor opened.");
}

document.querySelectorAll("[data-capture-direct]").forEach((button) => button.addEventListener("click", beginRegionCapture));
document.querySelector("#region-cancel").addEventListener("click", (event) => { event.stopPropagation(); cancelRegionCapture(); });
regionOverlay.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  selectionOrigin = { x: event.clientX, y: event.clientY };
  regionSelection.hidden = false;
  regionSelection.style.left = `${event.clientX}px`;
  regionSelection.style.top = `${event.clientY}px`;
  regionSelection.style.width = "1px";
  regionSelection.style.height = "1px";
  regionOverlay.setPointerCapture(event.pointerId);
});
regionOverlay.addEventListener("pointermove", (event) => {
  crosshair.style.left = `${event.clientX}px`;
  crosshair.style.top = `${event.clientY}px`;
  magnifier.style.left = `${Math.min(window.innerWidth - 105, event.clientX + 24)}px`;
  magnifier.style.top = `${Math.min(window.innerHeight - 85, event.clientY + 24)}px`;
  document.querySelector("#cursor-coordinates").textContent = `${Math.round(event.clientX)}, ${Math.round(event.clientY)}`;
  if (!selectionOrigin) return;
  const left = Math.min(selectionOrigin.x, event.clientX);
  const top = Math.min(selectionOrigin.y, event.clientY);
  const width = Math.abs(event.clientX - selectionOrigin.x);
  const height = Math.abs(event.clientY - selectionOrigin.y);
  Object.assign(regionSelection.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  regionDimensions.textContent = `${Math.round(width)} × ${Math.round(height)}`;
});
regionOverlay.addEventListener("pointerup", (event) => {
  if (!selectionOrigin) return;
  const width = Math.abs(event.clientX - selectionOrigin.x);
  const height = Math.abs(event.clientY - selectionOrigin.y);
  selectionOrigin = null;
  if (width > 24 && height > 24) window.setTimeout(completeRegionCapture, reducedMotionQuery.matches ? 0 : 180);
});
regionOverlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancelRegionCapture();
  if (event.key === "Enter") {
    regionSelection.hidden = false;
    Object.assign(regionSelection.style, { left: "18%", top: "20%", width: "64%", height: "56%" });
    regionDimensions.textContent = `${Math.round(innerWidth * .64)} × ${Math.round(innerHeight * .56)}`;
    window.setTimeout(completeRegionCapture, reducedMotionQuery.matches ? 0 : 180);
  }
});

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tool]").forEach((item) => { item.classList.remove("is-selected"); item.setAttribute("aria-pressed", "false"); });
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    document.querySelector("#editor-tool-status").textContent = `${button.dataset.tool} tool · 1280 × 720`;
    document.querySelector("#mock-capture").dataset.tool = button.dataset.tool;
  });
});
document.querySelectorAll(".palette button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".palette button").forEach((item) => item.classList.remove("is-selected"));
  button.classList.add("is-selected");
}));

function startUpload() {
  openWindow("upload-queue");
  const list = document.querySelector("#upload-list");
  const item = document.createElement("div");
  item.className = "upload-item current-upload";
  item.innerHTML = '<span class="upload-thumb" aria-hidden="true"></span><div><b>capture-001.png</b><small>Imgur · preparing...</small><div class="progress"><i style="width:4%"></i></div></div><strong>4%</strong>';
  list.prepend(item);
  document.querySelector("#queue-count").textContent = String(list.children.length);
  let progress = 4;
  clearInterval(uploadTimer);
  uploadTimer = window.setInterval(() => {
    progress = Math.min(100, progress + Math.ceil(Math.random() * 13));
    item.querySelector(".progress i").style.width = `${progress}%`;
    item.querySelector("strong").textContent = progress < 100 ? `${progress}%` : "✓";
    item.querySelector("small").textContent = progress < 100 ? `Imgur · uploading ${progress}%` : "Imgur · URL copied";
    if (progress >= 100) {
      clearInterval(uploadTimer);
      item.classList.add("is-complete");
      trayBalloon.hidden = false;
      document.querySelector("#history-new-row").innerHTML = '<div class="history-row is-new" role="row"><span role="cell"><i class="file-thumb pink" aria-hidden="true"></i> capture-001.png</span><span role="cell">1.2 MB</span><span role="cell">Imgur</span><span role="cell">Just now</span></div>';
      announce("Upload complete. URL copied to the clipboard and capture added to History.");
      window.setTimeout(() => { if (!trayBalloon.matches(":hover")) trayBalloon.hidden = true; }, 7000);
    }
  }, reducedMotionQuery.matches ? 30 : 180);
}
document.querySelector("#editor-done").addEventListener("click", () => { closeWindow(windows.get("annotation")); startUpload(); });
trayBalloon.querySelector("button").addEventListener("click", () => { trayBalloon.hidden = true; });
document.querySelector("#tray-sharex").addEventListener("click", () => { trayBalloon.hidden = !trayBalloon.hidden; });

const tips = [
  "You can chain capture, annotation, upload, and URL copying into one hotkey?",
  "The scrolling capture tool can stitch an entire webpage automatically?",
  "Custom uploaders let you connect almost any service with an API?",
  "ShareX has more workflow settings than this computer has shades of gray?",
];
let tipIndex = 0;
document.querySelector("#next-tip").addEventListener("click", () => {
  tipIndex = (tipIndex + 1) % tips.length;
  document.querySelector("#tip-text").textContent = tips[tipIndex];
  document.querySelector("#tip-number").textContent = `Tip ${tipIndex + 1} of ${tips.length}`;
});

let pendingWallpaper = "teal";
document.querySelectorAll("input[name='wallpaper']").forEach((radio) => radio.addEventListener("change", () => {
  pendingWallpaper = radio.value;
  const preview = document.querySelector("#wallpaper-preview");
  preview.className = `preview-${radio.value}`;
}));
document.querySelector("[data-property-apply]").addEventListener("click", () => {
  document.body.dataset.wallpaper = pendingWallpaper;
  closeWindow(windows.get("properties"));
  announce(`Wallpaper changed to ${pendingWallpaper}.`);
});

const soundToggle = document.querySelector("#sound-toggle");
soundToggle.addEventListener("click", () => {
  const muted = soundToggle.getAttribute("aria-pressed") !== "true";
  soundToggle.setAttribute("aria-pressed", String(muted));
  soundToggle.title = muted ? "Sound is muted" : "Sound is on";
  soundToggle.querySelector("span").textContent = muted ? "🔇" : "🔊";
  announce(muted ? "Interface sounds muted." : "Interface sounds on.");
});

function updateClock() {
  const now = new Date();
  taskbarClock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  taskbarClock.dateTime = now.toISOString();
  taskbarClock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
updateClock();
window.setInterval(updateClock, 15000);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!regionOverlay.hidden) { cancelRegionCapture(); return; }
    if (!contextMenu.hidden) { closeContextMenu(); return; }
    if (!startMenu.hidden) { closeStartMenu(); startButton.focus(); return; }
    const active = windows.get(activeWindowId);
    if (active && active.getAttribute("role")?.includes("dialog")) closeWindow(active);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openWindow("capture-wizard");
  }
});

function handleCompactMode(event = compactQuery) {
  if (event.matches) {
    ["upload-queue", "tip"].forEach((id) => windows.get(id)?.classList.remove("is-open", "is-active"));
    windows.get("sharex").classList.add("is-open");
    focusWindow(windows.get("sharex"));
    closeStartMenu();
  }
  updateTaskbar();
}
compactQuery.addEventListener("change", handleCompactMode);

const bootScreen = document.querySelector("#boot-screen");
let bootFinished = false;
function finishBoot() {
  if (bootFinished) return;
  bootFinished = true;
  bootScreen.classList.add("is-gone");
  window.setTimeout(() => { bootScreen.hidden = true; }, 260);
  if (!compactQuery.matches) {
    window.setTimeout(() => {
      startMenu.hidden = false;
      startMenu.setAttribute("aria-hidden", "false");
      startButton.setAttribute("aria-expanded", "true");
    }, reducedMotionQuery.matches ? 0 : 180);
  }
}
document.querySelector("#boot-skip").addEventListener("click", finishBoot);
window.setTimeout(finishBoot, reducedMotionQuery.matches ? 0 : 1450);

if (compactQuery.matches) handleCompactMode();
else {
  focusWindow(windows.get("sharex"));
  windows.get("upload-queue").style.zIndex = "31";
  windows.get("tip").style.zIndex = "32";
  topZ = 32;
  updateTaskbar();
}
