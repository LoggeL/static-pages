import * as THREE from "three";
import "./style.css";

document.documentElement.classList.add("js");

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const safeStorage = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* storage can be unavailable */ }
  },
};

let motionPaused = safeStorage.get("afterimage-motion") === "paused" || reducedMotion.matches;
let motionWasChosen = safeStorage.get("afterimage-motion") !== null;

const motionToggle = $("#motion-toggle");
const applyMotionState = () => {
  document.documentElement.classList.toggle("motion-paused", motionPaused);
  if (!motionToggle) return;
  motionToggle.setAttribute("aria-pressed", String(motionPaused));
  const label = $("b", motionToggle);
  if (label) label.textContent = motionPaused ? "Motion off" : "Motion on";
};

applyMotionState();
motionToggle?.addEventListener("click", () => {
  motionPaused = !motionPaused;
  motionWasChosen = true;
  safeStorage.set("afterimage-motion", motionPaused ? "paused" : "running");
  applyMotionState();
});

reducedMotion.addEventListener?.("change", (event) => {
  if (motionWasChosen) return;
  motionPaused = event.matches;
  applyMotionState();
});

// Header and mobile navigation.
const header = $("#lab-header");
const menuToggle = $("#menu-toggle");
const primaryNav = $("#primary-nav");
const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const closeMenu = () => {
  menuToggle?.setAttribute("aria-expanded", "false");
  primaryNav?.classList.remove("is-open");
};

menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  primaryNav?.classList.toggle("is-open", open);
});
$$('a', primaryNav || document.createElement("nav")).forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

// Reveal only after JS is confirmed. Content remains visible without JS.
const reveals = $$(".reveal");
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
  reveals.forEach((element) => revealObserver.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

// Hero sampling lens, parallax, and specimen captures.
const hero = $("#top");
const heroArt = $("#hero-art");
const sampleLens = $("#sample-lens");
let heroFrame = 0;

hero?.addEventListener("pointermove", (event) => {
  if (motionPaused || event.pointerType === "touch") return;
  const rect = hero.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (sampleLens) {
    sampleLens.style.left = `${x}px`;
    sampleLens.style.top = `${y}px`;
  }
  cancelAnimationFrame(heroFrame);
  heroFrame = requestAnimationFrame(() => {
    if (!heroArt) return;
    const nx = x / rect.width - 0.5;
    const ny = y / rect.height - 0.5;
    heroArt.style.transform = `translate3d(${nx * 15}px, ${ny * 10}px, 0)`;
  });
});

hero?.addEventListener("pointerleave", () => {
  if (heroArt) heroArt.style.transform = "translate3d(0,0,0)";
});

const heroCapture = $("#hero-capture");
const heroStatus = $("#hero-status");
const specimenCount = $("#specimen-count");
const specimenPins = $("#specimen-pins");
const pinPositions = [
  { left: "70%", top: "23%" },
  { left: "81%", top: "64%" },
  { left: "57%", top: "72%" },
  { left: "87%", top: "38%" },
];
let captures = 0;

heroCapture?.addEventListener("click", () => {
  captures += 1;
  hero?.classList.remove("is-capturing");
  requestAnimationFrame(() => hero?.classList.add("is-capturing"));
  window.setTimeout(() => hero?.classList.remove("is-capturing"), motionPaused ? 20 : 460);

  if (specimenCount) specimenCount.textContent = String(captures).padStart(2, "0");
  if (heroStatus) heroStatus.textContent = `Capture specimen ${captures} pinned to the lab.`;
  if (!specimenPins) return;

  const pin = document.createElement("span");
  pin.className = "specimen-pin";
  const position = pinPositions[(captures - 1) % pinPositions.length];
  pin.style.left = position.left;
  pin.style.top = position.top;
  pin.innerHTML = `<span>CAPTURE_${String(captures).padStart(2, "0")}.PNG</span>`;
  specimenPins.append(pin);
  while (specimenPins.children.length > 4) specimenPins.firstElementChild?.remove();
});

// Lightweight Three.js afterimage field. Generated art remains the fallback poster.
const canvas = $("#afterimage-canvas");
let threeCleanup = () => {};
let threePulse = () => {};

if (canvas && !reducedMotion.matches) {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.z = 6.2;
    const field = new THREE.Group();
    field.position.set(1.75, 0.15, 0);
    scene.add(field);

    const knotGeometry = new THREE.TorusKnotGeometry(1.45, 0.34, 180, 14, 2, 3);
    const knotPoints = new THREE.Points(knotGeometry, new THREE.PointsMaterial({
      color: 0xc8f000,
      size: 0.025,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    field.add(knotPoints);

    const orbitGeometry = new THREE.TorusGeometry(2.1, 0.008, 5, 180);
    const orbit = new THREE.LineSegments(
      new THREE.WireframeGeometry(orbitGeometry),
      new THREE.LineBasicMaterial({ color: 0x7c3cff, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending }),
    );
    orbit.rotation.set(0.7, 0.2, -0.3);
    field.add(orbit);

    const particleCount = window.innerWidth < 700 ? 220 : 620;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const radius = 1.8 + Math.random() * 2.8;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 4.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius * 0.45 + (Math.random() - 0.5);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      color: 0x28d7e7,
      size: 0.018,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    field.add(dust);

    let pointerX = 0;
    let pointerY = 0;
    let pulse = 0;
    let running = true;
    let raf = 0;
    const clock = new THREE.Clock();

    const resize = () => {
      const width = Math.max(1, hero?.clientWidth || window.innerWidth);
      const height = Math.max(1, hero?.clientHeight || window.innerHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      field.position.x = width < 900 ? 0.6 : 1.75;
      field.scale.setScalar(width < 700 ? 0.72 : 1);
    };

    const render = () => {
      raf = requestAnimationFrame(render);
      if (!running || document.hidden) return;
      const elapsed = clock.getElapsedTime();
      if (!motionPaused) {
        field.rotation.y += (pointerX * 0.18 - field.rotation.y) * 0.035;
        field.rotation.x += (pointerY * 0.12 - field.rotation.x) * 0.035;
        knotPoints.rotation.z = elapsed * 0.045;
        orbit.rotation.z = -elapsed * 0.035;
        dust.rotation.y = elapsed * 0.018;
        pulse *= 0.91;
        const scale = 1 + pulse * 0.12 + Math.sin(elapsed * 0.7) * 0.012;
        knotPoints.scale.setScalar(scale);
      }
      renderer.render(scene, camera);
    };

    const onPointer = (event) => {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    hero?.addEventListener("pointermove", onPointer, { passive: true });
    heroCapture?.addEventListener("click", () => { pulse = 1; });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", () => { running = !document.hidden; });
    resize();
    render();

    threePulse = () => { pulse = 1; };
    threeCleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      hero?.removeEventListener("pointermove", onPointer);
      knotGeometry.dispose();
      orbitGeometry.dispose();
      dustGeometry.dispose();
      knotPoints.material.dispose();
      orbit.material.dispose();
      dust.material.dispose();
      renderer.dispose();
    };
  } catch {
    canvas.hidden = true;
  }
}

heroCapture?.addEventListener("click", threePulse);

// Capture-mode carousel.
const modeCards = $$(".mode-card");
const modeTrack = $("#mode-track");
const modeNumber = $("#active-mode-number");
const modeStatus = $("#mode-status");
const modeLab = $(".mode-lab");
let activeMode = Math.max(0, modeCards.findIndex((card) => card.classList.contains("is-active")));

const setMode = (index, shouldScroll = true) => {
  if (!modeCards.length) return;
  activeMode = (index + modeCards.length) % modeCards.length;
  modeCards.forEach((card, cardIndex) => {
    const active = cardIndex === activeMode;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", String(active));
  });
  const card = modeCards[activeMode];
  const name = card.dataset.mode || "region";
  if (modeNumber) modeNumber.textContent = String(activeMode + 1).padStart(2, "0");
  if (modeStatus) modeStatus.textContent = `${name.toUpperCase()} / READY TO SAMPLE`;
  if (shouldScroll) card.scrollIntoView({ behavior: motionPaused ? "auto" : "smooth", block: "nearest", inline: "center" });
};

modeCards.forEach((card, index) => card.addEventListener("click", () => setMode(index, false)));
$("#mode-prev")?.addEventListener("click", () => setMode(activeMode - 1));
$("#mode-next")?.addEventListener("click", () => setMode(activeMode + 1));
modeTrack?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") { event.preventDefault(); setMode(activeMode - 1); }
  if (event.key === "ArrowRight") { event.preventDefault(); setMode(activeMode + 1); }
});

$("#hotkey-demo")?.addEventListener("click", () => {
  const name = modeCards[activeMode]?.dataset.mode?.toUpperCase() || "REGION";
  modeLab?.classList.remove("is-sampling");
  requestAnimationFrame(() => modeLab?.classList.add("is-sampling"));
  if (modeStatus) modeStatus.textContent = `${name} / CAPTURED`;
  window.setTimeout(() => {
    modeLab?.classList.remove("is-sampling");
    if (modeStatus) modeStatus.textContent = `${name} / SENT TO ANNOTATION LAB`;
  }, motionPaused ? 60 : 720);
});

// Annotation tools and raw/edited membrane.
const toolButtons = $$("[data-tool]");
const overlayGroups = $$("[data-overlay]");
const annotationStatus = $("#annotation-status");
const toolCopy = {
  point: "POINT / ARROW VEIN ACTIVE",
  redact: "REDACT / PRIVATE PIXELS SEALED",
  number: "NUMBER / STEPS CATALOGUED",
  magnify: "MAGNIFY / DETAIL LENS ACTIVE",
};

toolButtons.forEach((button) => button.addEventListener("click", () => {
  const tool = button.dataset.tool;
  toolButtons.forEach((item) => {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  overlayGroups.forEach((group) => group.classList.toggle("is-active", group.dataset.overlay === tool));
  if (annotationStatus) annotationStatus.textContent = toolCopy[tool] || "TOOL ACTIVE";
}));

const editReveal = $("#edit-reveal");
const annotationPlate = $("#annotation-plate");
const setReveal = (value) => {
  const clamped = Math.max(0, Math.min(100, Number(value)));
  if (annotationPlate) annotationPlate.style.setProperty("--reveal", `${clamped}%`);
  if (editReveal) editReveal.value = String(clamped);
};
editReveal?.addEventListener("input", () => setReveal(editReveal.value));
$$('[data-reveal]').forEach((button) => button.addEventListener("click", () => setReveal(button.dataset.reveal)));

// Workflow behavior presets and execution.
const behaviorButtons = $$("[data-behavior]");
const stepButtons = $$("[data-step]");
const behaviorName = $("#behavior-name");
const behaviorCanvas = $("#behavior-canvas");
const behaviorStatus = $("#behavior-status");
const outputNode = $(".behavior-node--output");
const behaviorConfigs = {
  bug: { name: "BUG REPORT", active: ["annotate", "ocr"], output: ["Save issue", "Clipboard"], done: "ISSUE PACKAGE SAVED" },
  docs: { name: "DOCUMENTATION", active: ["annotate", "ocr", "upload"], output: ["Copy URL", "Docs host"], done: "DOCUMENTATION URL COPIED" },
  share: { name: "QUICK SHARE", active: ["upload"], output: ["Copy URL", "Clipboard"], done: "SHARE URL COPIED" },
  private: { name: "PRIVATE / LOCAL", active: ["annotate"], output: ["Save local", "No upload"], done: "CAPTURE SAVED LOCALLY" },
};
let currentBehavior = "bug";
let behaviorTimer = 0;

const activeStepCount = () => stepButtons.filter((button) => button.getAttribute("aria-pressed") === "true").length;
const refreshBehaviorStatus = () => {
  if (!behaviorStatus) return;
  const count = activeStepCount();
  behaviorStatus.textContent = `READY / ${count} ${count === 1 ? "TASK" : "TASKS"} ARMED`;
};

const setBehavior = (key) => {
  const config = behaviorConfigs[key];
  if (!config) return;
  currentBehavior = key;
  behaviorButtons.forEach((button) => {
    const active = button.dataset.behavior === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  stepButtons.forEach((button) => button.setAttribute("aria-pressed", String(config.active.includes(button.dataset.step))));
  if (behaviorName) behaviorName.textContent = config.name;
  if (outputNode) {
    const strong = $("strong", outputNode);
    const span = $("span", outputNode);
    if (strong) strong.textContent = config.output[0];
    if (span) span.textContent = config.output[1];
  }
  refreshBehaviorStatus();
};

behaviorButtons.forEach((button) => button.addEventListener("click", () => setBehavior(button.dataset.behavior)));
stepButtons.forEach((button) => button.addEventListener("click", () => {
  const next = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(next));
  refreshBehaviorStatus();
}));

$("#run-behavior")?.addEventListener("click", () => {
  window.clearTimeout(behaviorTimer);
  behaviorCanvas?.classList.remove("is-running");
  requestAnimationFrame(() => behaviorCanvas?.classList.add("is-running"));
  if (behaviorStatus) behaviorStatus.textContent = `RUNNING / ${behaviorConfigs[currentBehavior].name}`;
  behaviorTimer = window.setTimeout(() => {
    behaviorCanvas?.classList.remove("is-running");
    if (behaviorStatus) behaviorStatus.textContent = `COMPLETE / ${behaviorConfigs[currentBehavior].done}`;
  }, motionPaused ? 120 : 1450);
});

// Destination mycelium.
const destinationButtons = $$("[data-destination]");
const routeMap = $("#route-map");
const routeName = $("#route-name");
const routeCopy = $("#route-copy");
const routeStatus = $("#route-status");
const routeData = {
  local: ["LOCAL FOLDER", "The capture stays yours. Nothing leaves the machine.", "LOCAL"],
  clipboard: ["CLIPBOARD", "Pixels or a finished URL arrive where you can paste them.", "CLIPBOARD"],
  s3: ["AMAZON S3", "Send the result into the bucket and path you control.", "S3 CLOUD"],
  ftp: ["FTP SERVER", "Route directly to infrastructure that already belongs to you.", "FTP"],
  custom: ["CUSTOM UPLOADER", "Teach ShareX any destination with your own request rules.", "CUSTOM"],
  url: ["COPY RESULT URL", "Finish the route by placing the returned link on the clipboard.", "URL OUTPUT"],
};

destinationButtons.forEach((button) => button.addEventListener("click", () => {
  const destination = button.dataset.destination;
  const data = routeData[destination];
  if (!data) return;
  destinationButtons.forEach((item) => {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  if (routeName) routeName.textContent = data[0];
  if (routeCopy) routeCopy.textContent = data[1];
  if (routeStatus) routeStatus.textContent = `ROUTE LOCKED / ${data[2]}`;
  routeMap?.classList.remove("is-routing");
  requestAnimationFrame(() => routeMap?.classList.add("is-routing"));
  window.setTimeout(() => routeMap?.classList.remove("is-routing"), motionPaused ? 40 : 760);
}));

// Keep specimen drawers readable: one open drawer at a time.
const utilityDrawers = $$(".utility-drawer");
utilityDrawers.forEach((drawer) => drawer.addEventListener("toggle", () => {
  if (!drawer.open) return;
  utilityDrawers.forEach((other) => {
    if (other !== drawer) other.open = false;
  });
}));

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(heroFrame);
  window.clearTimeout(behaviorTimer);
  threeCleanup();
}, { once: true });
