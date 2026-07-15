import "./style.css";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = navigator.connection && navigator.connection.saveData;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const state = {
  motionPaused: reduceMotion,
  three: null,
  toastTimer: null,
  commandReturnFocus: null,
};

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function showToast(message, duration = 2200) {
  const toast = qs("#toast");
  if (!toast) return;
  qs("span", toast).textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
}

function triggerCaptureFlash() {
  const flash = qs(".capture-flash");
  flash.classList.remove("is-active");
  void flash.offsetWidth;
  flash.classList.add("is-active");
}

function initReveal() {
  const targets = qsa("[data-reveal]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );

  targets.forEach((target, index) => {
    target.style.transitionDelay = Math.min(index % 4, 3) * 45 + "ms";
    observer.observe(target);
  });
}

function initScrollUI() {
  const meter = qs(".scroll-meter__track i");
  const value = qs(".scroll-meter__value");
  const header = qs(".site-header");
  let ticking = false;

  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    const percent = Math.round(progress * 100);
    meter.style.height = percent + "%";
    value.textContent = String(percent).padStart(2, "0") + "%";
    header.classList.toggle("is-scrolled", window.scrollY > 28);
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
}

function initPointerEffects() {
  if (!finePointer || reduceMotion) return;
  document.body.classList.add("has-pointer");
  const halo = qs(".cursor-halo");
  let currentX = window.innerWidth / 2;
  let currentY = window.innerHeight / 2;
  let targetX = currentX;
  let targetY = currentY;

  window.addEventListener(
    "pointermove",
    (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
    },
    { passive: true },
  );

  const follow = () => {
    currentX += (targetX - currentX) * 0.13;
    currentY += (targetY - currentY) * 0.13;
    halo.style.transform = "translate3d(" + (currentX - 110) + "px," + (currentY - 110) + "px,0)";
    requestAnimationFrame(follow);
  };
  follow();

  qsa(".magnetic").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.12;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.12;
      element.style.transform = "translate3d(" + x + "px," + y + "px,0)";
    });
    element.addEventListener("pointerleave", () => {
      element.style.transform = "";
    });
  });
}

function initMotionToggle() {
  const button = qs("#motionToggle");
  const icon = qs("svg", button);

  const sync = () => {
    document.body.classList.toggle("motion-paused", state.motionPaused);
    button.setAttribute("aria-pressed", String(state.motionPaused));
    button.setAttribute("aria-label", state.motionPaused ? "Resume motion" : "Pause motion");
    icon.innerHTML = state.motionPaused
      ? '<path d="m8 5 11 7-11 7z"/>'
      : '<path d="M8 5v14M16 5v14"/>';
    if (state.three) state.three.setPaused(state.motionPaused);
  };

  button.addEventListener("click", () => {
    state.motionPaused = !state.motionPaused;
    sync();
    showToast(state.motionPaused ? "Motion paused" : "Motion resumed");
  });
  sync();
}

function initCommandPalette() {
  const dialog = qs("#commandPalette");
  const panel = qs(".command-palette__panel", dialog);
  const input = qs("#commandInput");
  const commands = qsa(".command-list button", dialog);

  const open = () => {
    state.commandReturnFocus = document.activeElement;
    dialog.hidden = false;
    document.body.style.overflow = "hidden";
    input.value = "";
    commands.forEach((command) => (command.hidden = false));
    requestAnimationFrame(() => input.focus());
  };

  const close = () => {
    if (dialog.hidden) return;
    dialog.hidden = true;
    document.body.style.overflow = "";
    if (state.commandReturnFocus && state.commandReturnFocus.focus) state.commandReturnFocus.focus();
  };

  qsa(".command-trigger").forEach((button) => button.addEventListener("click", open));
  qs("[data-close-command]", dialog).addEventListener("click", close);

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    commands.forEach((command) => {
      command.hidden = !command.textContent.toLowerCase().includes(query);
    });
  });

  commands.forEach((command) => {
    command.addEventListener("click", () => {
      const name = command.dataset.command;
      close();
      triggerCaptureFlash();
      showToast(name + " armed — choose an area");
      if (state.three) state.three.capture();
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.hidden ? open() : close();
      return;
    }
    if (!dialog.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!dialog.hidden && event.key === "Tab") {
      const focusable = qsa('input, button:not([hidden])', panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

function initWorkflow() {
  const lab = qs(".workflow-lab");
  const runButton = qs("#runWorkflow");
  const eventLog = qs("#eventLog");
  const runClock = qs("#runClock");
  const middleNodes = qsa('.flow-node[data-flow="edit"], .flow-node[data-flow="ocr"], .flow-node[data-flow="upload"]');
  const presets = {
    quick: ["edit", "upload"],
    bug: ["edit", "ocr", "upload"],
    docs: ["edit", "ocr"],
    private: ["edit", "ocr"],
  };
  const labels = {
    edit: ["Image editor opened", "00.142"],
    ocr: ["Text recognized", "00.318"],
    upload: ["Uploaded to destination", "00.604"],
  };
  let running = false;
  let timers = [];

  const toggleNode = (node) => {
    if (running) return;
    const next = node.getAttribute("aria-pressed") !== "true";
    node.setAttribute("aria-pressed", String(next));
    qsa(".preset").forEach((preset) => preset.classList.remove("is-active"));
    showToast(node.dataset.flow.toUpperCase() + (next ? " added to route" : " bypassed"));
  };

  middleNodes.forEach((node) => node.addEventListener("click", () => toggleNode(node)));

  qsa(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      if (running) return;
      qsa(".preset").forEach((preset) => preset.classList.toggle("is-active", preset === button));
      const enabled = presets[button.dataset.preset];
      middleNodes.forEach((node) => node.setAttribute("aria-pressed", String(enabled.includes(node.dataset.flow))));
      showToast(button.textContent.trim() + " preset loaded");
    });
  });

  const addEvent = (label, time, active) => {
    const item = document.createElement("li");
    item.className = active ? "is-active" : "";
    item.innerHTML = "<time>" + time + "</time><span>" + label + "</span><b>" + (active ? "●" : "○") + "</b>";
    eventLog.appendChild(item);
    return item;
  };

  const finishEvent = (item) => {
    item.className = "is-complete";
    qs("b", item).textContent = "✓";
  };

  const run = () => {
    if (running) return;
    running = true;
    timers.forEach(window.clearTimeout);
    timers = [];
    runButton.disabled = true;
    lab.classList.remove("is-running");
    void lab.offsetWidth;
    lab.classList.add("is-running");
    eventLog.innerHTML = "";
    runClock.textContent = "00:00.000";

    const activeSteps = middleNodes.filter((node) => node.getAttribute("aria-pressed") === "true");
    const sequence = [
      ["Region captured", "00.000"],
      ...activeSteps.map((node) => labels[node.dataset.flow]),
      activeSteps.some((node) => node.dataset.flow === "upload")
        ? ["Result URL copied", "00.742"]
        : ["Image saved locally", "00.511"],
    ];

    sequence.forEach((step, index) => {
      const start = window.setTimeout(() => {
        const item = addEvent(step[0], step[1], true);
        runClock.textContent = step[1];
        const complete = window.setTimeout(() => {
          finishEvent(item);
          if (index === sequence.length - 1) {
            running = false;
            runButton.disabled = false;
            window.setTimeout(() => lab.classList.remove("is-running"), 350);
            triggerCaptureFlash();
            showToast(activeSteps.some((node) => node.dataset.flow === "upload") ? "Workflow complete — URL copied" : "Workflow complete — saved locally");
            if (state.three) state.three.setMode("route");
          }
        }, reduceMotion ? 30 : 270);
        timers.push(complete);
      }, reduceMotion ? index * 50 : index * 420);
      timers.push(start);
    });
  };

  runButton.addEventListener("click", run);
}

function initRegionDemo() {
  const demo = qs("#regionDemo");
  const selection = qs("#demoSelection");
  const crosshair = qs("#regionCrosshair");
  let left = 27;
  let top = 24;

  const setPosition = (xPercent, yPercent) => {
    left = clamp(xPercent - 24, 2, 50);
    top = clamp(yPercent - 25.5, 2, 47);
    selection.style.left = left + "%";
    selection.style.top = top + "%";
    crosshair.style.left = clamp(xPercent, 0, 100) + "%";
    crosshair.style.top = clamp(yPercent, 0, 100) + "%";
  };

  demo.addEventListener("pointermove", (event) => {
    const rect = demo.getBoundingClientRect();
    setPosition(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100);
  });

  demo.addEventListener("pointerdown", () => {
    triggerCaptureFlash();
    showToast("Region locked — 640 × 360");
    if (state.three) state.three.capture();
  });

  demo.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") left -= 2;
    if (event.key === "ArrowRight") left += 2;
    if (event.key === "ArrowUp") top -= 2;
    if (event.key === "ArrowDown") top += 2;
    left = clamp(left, 2, 50);
    top = clamp(top, 2, 47);
    selection.style.left = left + "%";
    selection.style.top = top + "%";
  });
}

function initRecorder() {
  const canvas = qs("#waveform");
  const context = canvas.getContext("2d");
  const button = qs("#recordButton");
  const demo = qs(".record-demo");
  const time = qs("#recordTime");
  let recording = false;
  let startTime = 0;
  let raf = 0;

  const draw = (timestamp = 0) => {
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.beginPath();
    for (let x = 0; x <= width; x += 3) {
      const amp = recording ? 18 + Math.sin(x * 0.035 + timestamp * 0.004) * 14 : 8;
      const y =
        height / 2 +
        Math.sin(x * 0.072 + timestamp * 0.0024) * amp * 0.45 +
        Math.sin(x * 0.021 - timestamp * 0.0015) * amp * 0.55;
      x === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
    }
    context.strokeStyle = recording ? "#ff4e6a" : "#22a7f0";
    context.lineWidth = 2;
    context.shadowBlur = 12;
    context.shadowColor = context.strokeStyle;
    context.stroke();
    context.shadowBlur = 0;

    if (recording) {
      const elapsed = Math.floor((timestamp - startTime) / 1000);
      const hours = String(Math.floor(elapsed / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
      const seconds = String(elapsed % 60).padStart(2, "0");
      time.textContent = hours + ":" + minutes + ":" + seconds;
      raf = requestAnimationFrame(draw);
    }
  };

  draw();
  button.addEventListener("click", () => {
    recording = !recording;
    button.setAttribute("aria-pressed", String(recording));
    demo.classList.toggle("is-recording", recording);
    button.lastChild.textContent = recording ? " Stop recording" : " Start recording";
    cancelAnimationFrame(raf);
    if (recording) {
      startTime = performance.now();
      draw(startTime);
      showToast("Recording started");
    } else {
      time.textContent = "00:00:00";
      draw();
      showToast("Recording saved as MP4");
    }
  });
}

function initEditor() {
  const canvas = qs("#editorCanvas");
  const toast = qs(".annotation-toast", canvas);

  const selectTool = (button) => {
    qsa(".editor-tool").forEach((tool) => {
      const selected = tool === button;
      tool.classList.toggle("is-active", selected);
      tool.setAttribute("aria-pressed", String(selected));
    });
    const name = button.dataset.tool;
    canvas.dataset.tool = name;
    toast.firstChild.textContent = name.toUpperCase() + " ADDED ";
    showToast(name.charAt(0).toUpperCase() + name.slice(1) + " tool selected");
  };

  qsa(".editor-tool").forEach((button) => button.addEventListener("click", () => selectTool(button)));
  qs("#resetEditor").addEventListener("click", () => {
    selectTool(qs('.editor-tool[data-tool="arrow"]'));
    showToast("Editor reset");
  });
  canvas.dataset.tool = "arrow";
}

function initDestinations() {
  const stage = qs(".destination-stage");
  const output = qs("#destinationOutput");
  const copyButton = qs("#copyRoute");
  let current = "Clipboard";

  const activate = (button) => {
    qsa(".destination-node").forEach((node) => node.classList.toggle("is-active", node === button));
    current = button.dataset.destination;
    output.textContent = current === "Clipboard" ? "Copied to clipboard" : "Ready for " + current;

    const stageRect = stage.getBoundingClientRect();
    const nodeRect = button.getBoundingClientRect();
    const centerX = stageRect.left + stageRect.width / 2;
    const centerY = stageRect.top + stageRect.height * 0.47;
    const nodeX = nodeRect.left + nodeRect.width / 2;
    const nodeY = nodeRect.top + nodeRect.height / 2;
    const angle = Math.atan2(nodeY - centerY, nodeX - centerX) * (180 / Math.PI) - 90;
    const distance = Math.hypot(nodeX - centerX, nodeY - centerY);
    stage.style.setProperty("--beam-angle", angle + "deg");
    qs(".route-beam", stage).style.height = distance + "px";
    showToast("Route locked: " + current);
    if (state.three) state.three.setMode("route");
  };

  qsa(".destination-node").forEach((button) => button.addEventListener("click", () => activate(button)));
  window.addEventListener("resize", () => {
    const active = qs(".destination-node.is-active");
    if (active) activate(active);
  });

  copyButton.addEventListener("click", async () => {
    const text = current === "Clipboard" ? "Capture copied locally" : "https://sharex.example/" + current.toLowerCase().replace(/\s+/g, "-");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Result copied to clipboard");
    } catch {
      showToast("Copy result ready");
    }
  });
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];
  return (
    "#" +
    [r, g, b]
      .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function initToolCards() {
  if (finePointer && !reduceMotion) {
    qsa(".tool-card").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = "perspective(900px) rotateX(" + -y * 5 + "deg) rotateY(" + x * 6 + "deg) translateY(-6px)";
      });
      card.addEventListener("pointerleave", () => (card.style.transform = ""));
    });
  }

  const tool = qs("#colorTool");
  const field = qs(".color-field", tool);
  const picker = qs("i", field);
  const label = qs("span", field);
  let current = "#22A7F0";

  field.addEventListener("pointermove", (event) => {
    const rect = field.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    picker.style.left = x * 100 + "%";
    picker.style.top = y * 100 + "%";
    current = hslToHex(x * 360, 82, clamp(66 - y * 40, 24, 68));
    label.textContent = current;
    picker.style.background = current;
  });

  field.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(current);
    } catch {
      // Clipboard permissions vary on local previews.
    }
    showToast(current + " copied");
  });
}

function initEasterEgg() {
  let sequence = "";
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    sequence = (sequence + event.key.toLowerCase()).slice(-6);
    if (sequence !== "sharex") return;
    triggerCaptureFlash();
    showToast("Secret route unlocked: maximum overkill", 3000);
    if (state.three) state.three.setMode("burst");
  });
}

async function initThreeScene() {
  const canvas = qs("#webgl");
  if (!canvas || saveData) return;

  let THREE;
  try {
    THREE = await import("three");
  } catch (error) {
    console.warn("Three.js could not load; using CSS fallback.", error);
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !window.matchMedia("(max-width: 760px)").matches,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.warn("WebGL is unavailable; using CSS fallback.", error);
    return;
  }

  canvas.classList.add("is-ready");
  const fallback = qs(".webgl-fallback");
  if (fallback) fallback.style.opacity = "0";

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05080d, 0.068);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(0, 0.15, 10.4);
  const world = new THREE.Group();
  const reactor = new THREE.Group();
  const shardGroup = new THREE.Group();
  scene.add(world);
  world.add(reactor, shardGroup);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.setClearColor(0x000000, 0);

  const ambient = new THREE.AmbientLight(0x93dfff, 0.72);
  const key = new THREE.PointLight(0x22a7f0, 38, 22, 2);
  key.position.set(4, 4, 5);
  const mint = new THREE.PointLight(0x35e6c1, 20, 16, 2);
  mint.position.set(-5, -2, 3);
  const warm = new THREE.PointLight(0xff4e6a, 13, 13, 2);
  warm.position.set(4, -4, 2);
  scene.add(ambient, key, mint, warm);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.06, 0.06);
  bladeShape.lineTo(0.88, 0.06);
  bladeShape.bezierCurveTo(1.1, 0.06, 1.18, 0.28, 1.03, 0.45);
  bladeShape.lineTo(0.48, 1.04);
  bladeShape.bezierCurveTo(0.31, 1.22, 0.06, 1.12, 0.06, 0.88);
  bladeShape.closePath();

  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.07,
    bevelThickness: 0.07,
    curveSegments: 10,
  });
  bladeGeometry.center();

  const colors = [0x22a7f0, 0xff4e3f, 0xffd624, 0x28d447];
  const bladeMaterials = colors.map(
    (color) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.18,
        metalness: 0.16,
        transmission: 0.1,
        thickness: 1.4,
        emissive: color,
        emissiveIntensity: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.15,
      }),
  );

  const logo = new THREE.Group();
  colors.forEach((color, index) => {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterials[index]);
    const angle = index * Math.PI * 0.5;
    blade.rotation.z = -angle;
    blade.position.set(Math.cos(angle + Math.PI * 0.25) * 0.66, Math.sin(angle + Math.PI * 0.25) * 0.66, index * 0.025);
    blade.castShadow = false;
    logo.add(blade);
  });
  logo.scale.setScalar(1.34);
  logo.rotation.z = -0.13;
  reactor.add(logo);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.36, 3),
    new THREE.MeshPhysicalMaterial({
      color: 0x06151f,
      emissive: 0x22a7f0,
      emissiveIntensity: 0.85,
      roughness: 0.08,
      metalness: 0.85,
      transmission: 0.2,
    }),
  );
  core.position.z = 0.18;
  logo.add(core);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x4dd4ff,
    transparent: true,
    opacity: 0.26,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rings = [];
  [
    [2.25, 0.014, 0.2, 0.15],
    [2.85, 0.009, -0.35, 0.52],
    [3.5, 0.007, 0.65, -0.25],
  ].forEach((config, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(config[0], config[1], 5, 160), ringMaterial.clone());
    ring.rotation.x = Math.PI / 2 + config[2];
    ring.rotation.y = config[3];
    ring.userData.speed = index % 2 ? -0.12 : 0.09 + index * 0.02;
    reactor.add(ring);
    rings.push(ring);
  });

  const frameMaterial = new THREE.LineBasicMaterial({
    color: 0x5bdcff,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
  });
  const frames = [];
  for (let index = 0; index < 5; index += 1) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(4.8 - index * 0.42, 3.15 - index * 0.24, 0.06));
    const frame = new THREE.LineSegments(geometry, frameMaterial.clone());
    frame.position.z = -0.45 - index * 0.42;
    frame.rotation.z = (index - 2) * 0.035;
    frame.material.opacity = 0.22 - index * 0.025;
    reactor.add(frame);
    frames.push(frame);
  }

  const cardMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x102637,
    emissive: 0x0d79ad,
    emissiveIntensity: 0.1,
    roughness: 0.35,
    metalness: 0.25,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
  });
  const cards = [];
  const cardPositions = [
    [-3.5, 1.8, -1.7, -0.2],
    [3.7, -1.5, -2.2, 0.18],
    [-4.1, -1.65, -3.4, 0.1],
    [3.5, 2.05, -3.1, -0.16],
  ];
  cardPositions.forEach((item, index) => {
    const group = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.28), cardMaterial.clone());
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.05, 1.28)),
      new THREE.LineBasicMaterial({ color: colors[index], transparent: true, opacity: 0.46 }),
    );
    plane.add(edge);
    group.add(plane);
    group.position.set(item[0], item[1], item[2]);
    group.rotation.z = item[3];
    group.rotation.y = item[0] > 0 ? -0.26 : 0.26;
    group.userData.base = group.position.clone();
    group.userData.phase = index * 1.7;
    reactor.add(group);
    cards.push(group);
  });

  const nodeMaterial = new THREE.MeshStandardMaterial({
    color: 0x53d8ff,
    emissive: 0x22a7f0,
    emissiveIntensity: 1.2,
    roughness: 0.25,
    metalness: 0.5,
  });
  const nodes = [];
  const nodeLinePoints = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const radius = 3.15 + (index % 2) * 0.55;
    const node = new THREE.Mesh(new THREE.OctahedronGeometry(index % 3 === 0 ? 0.12 : 0.075, 1), nodeMaterial.clone());
    node.material.color.setHex(colors[index % 4]);
    node.material.emissive.setHex(colors[index % 4]);
    node.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.68, -0.6 - (index % 3) * 0.35);
    node.userData.angle = angle;
    node.userData.radius = radius;
    node.userData.speed = 0.08 + (index % 4) * 0.015;
    reactor.add(node);
    nodes.push(node);
    nodeLinePoints.push(node.position.clone());
  }
  nodeLinePoints.push(nodeLinePoints[0]);
  const network = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(nodeLinePoints),
    new THREE.LineBasicMaterial({ color: 0x22a7f0, transparent: true, opacity: 0.12 }),
  );
  reactor.add(network);

  const lowPower = window.matchMedia("(max-width: 760px)").matches;
  const particleCount = lowPower ? 320 : 820;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const colorObject = new THREE.Color();
  for (let index = 0; index < particleCount; index += 1) {
    const radius = 2.7 + Math.random() * 6.8;
    const angle = Math.random() * Math.PI * 2;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 8;
    particlePositions[index * 3 + 2] = -4 + (Math.random() - 0.5) * 7;
    colorObject.setHex(colors[index % 4]);
    particleColors[index * 3] = colorObject.r;
    particleColors[index * 3 + 1] = colorObject.g;
    particleColors[index * 3 + 2] = colorObject.b;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      size: lowPower ? 0.025 : 0.036,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  world.add(particles);

  const shardGeometry = new THREE.BoxGeometry(0.055, 0.055, 0.055);
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: 0x58d8ff,
    emissive: 0x22a7f0,
    emissiveIntensity: 0.75,
    roughness: 0.3,
    metalness: 0.4,
  });
  const shardCount = lowPower ? 80 : 180;
  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, shardCount);
  const dummy = new THREE.Object3D();
  const shardData = [];
  for (let index = 0; index < shardCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.25 + Math.random() * 3.5;
    const data = {
      angle,
      radius,
      y: (Math.random() - 0.5) * 4,
      z: -0.4 - Math.random() * 3,
      speed: 0.06 + Math.random() * 0.11,
      scale: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    };
    shardData.push(data);
    dummy.position.set(Math.cos(angle) * radius, data.y, data.z);
    dummy.scale.setScalar(data.scale);
    dummy.updateMatrix();
    shards.setMatrixAt(index, dummy.matrix);
    shards.setColorAt(index, new THREE.Color(colors[index % 4]));
  }
  shardGroup.add(shards);

  const grid = new THREE.GridHelper(22, 40, 0x12678e, 0x0c3347);
  grid.position.y = -4.1;
  grid.position.z = -3;
  grid.material.transparent = true;
  grid.material.opacity = 0.13;
  world.add(grid);

  let width = 0;
  let height = 0;
  let paused = state.motionPaused;
  let visible = true;
  let dragging = false;
  let dragMoved = false;
  let previousPointer = { x: 0, y: 0 };
  let pointer = { x: 0, y: 0 };
  let dragRotation = { x: 0, y: 0 };
  let mode = "capture";
  let capturePulse = 0;
  const clock = new THREE.Clock();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const maxDpr = lowPower ? 1 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(width, height, false);
  };

  const setMode = (nextMode) => {
    mode = nextMode;
    qsa(".scene-mode").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === nextMode));
    const telemetry = qs("#telemetryMode");
    if (telemetry) telemetry.textContent = nextMode === "capture" ? "ARMED" : nextMode === "route" ? "ROUTING" : "OVERDRIVE";
    if (nextMode === "burst") capturePulse = 1;
  };

  const capture = () => {
    capturePulse = 1;
    setMode("burst");
    window.setTimeout(() => {
      if (mode === "burst") setMode("capture");
    }, reduceMotion ? 20 : 1300);
  };

  qsa(".scene-mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragMoved = false;
    previousPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    if (!dragging) return;
    const dx = event.clientX - previousPointer.x;
    const dy = event.clientY - previousPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    dragRotation.y += dx * 0.006;
    dragRotation.x += dy * 0.004;
    previousPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!dragMoved) {
      triggerCaptureFlash();
      showToast("Capture reactor fired");
      capture();
    }
  });
  canvas.addEventListener("pointercancel", () => (dragging = false));

  const modeTargets = {
    capture: { scale: 1, z: 0, ring: 1, shard: 0.08, frame: 0.22 },
    route: { scale: 0.78, z: -0.9, ring: 1.36, shard: 0.35, frame: 0.08 },
    burst: { scale: 1.2, z: 0.45, ring: 1.7, shard: 1, frame: 0.42 },
  };

  const render = () => {
    if (!visible || paused || document.hidden) return;
    const delta = Math.min(clock.getDelta(), 0.04);
    const elapsed = clock.elapsedTime;
    const target = modeTargets[mode];

    world.rotation.y += ((pointer.x * 0.12 + dragRotation.y) - world.rotation.y) * 0.045;
    world.rotation.x += ((-pointer.y * 0.08 + dragRotation.x) - world.rotation.x) * 0.045;
    reactor.scale.lerp(new THREE.Vector3(target.scale, target.scale, target.scale), 0.045);
    reactor.position.z += (target.z - reactor.position.z) * 0.045;
    logo.rotation.z += delta * (mode === "burst" ? 1.4 : 0.08);
    logo.rotation.y = Math.sin(elapsed * 0.4) * 0.1;
    core.rotation.x += delta * 0.7;
    core.rotation.y -= delta * 0.9;
    core.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.055 + capturePulse * 0.35);

    rings.forEach((ring, index) => {
      ring.rotation.z += delta * ring.userData.speed * (mode === "burst" ? 6 : 1);
      const ringScale = target.ring * (1 + Math.sin(elapsed * 0.7 + index) * 0.025);
      ring.scale.lerp(new THREE.Vector3(ringScale, ringScale, ringScale), 0.04);
      ring.material.opacity += ((mode === "burst" ? 0.62 : 0.2 + index * 0.035) - ring.material.opacity) * 0.05;
    });

    frames.forEach((frame, index) => {
      frame.rotation.z += delta * (index % 2 ? -0.015 : 0.02);
      frame.material.opacity += (target.frame - index * 0.022 - frame.material.opacity) * 0.04;
      const spread = mode === "burst" ? index * 0.2 : 0;
      frame.position.z += (-0.45 - index * 0.42 - spread - frame.position.z) * 0.04;
    });

    cards.forEach((card, index) => {
      const base = card.userData.base;
      card.position.y = base.y + Math.sin(elapsed * 0.7 + card.userData.phase) * 0.16;
      card.rotation.x = Math.sin(elapsed * 0.45 + index) * 0.055;
      card.rotation.y += delta * (index % 2 ? -0.035 : 0.035);
      const spread = mode === "route" ? 1.22 : mode === "burst" ? 1.5 : 1;
      card.position.x += (base.x * spread - card.position.x) * 0.035;
    });

    nodes.forEach((node, index) => {
      node.userData.angle += delta * node.userData.speed * (mode === "route" ? 5 : 1);
      const radius = node.userData.radius * (mode === "burst" ? 1.35 : 1);
      node.position.x = Math.cos(node.userData.angle) * radius;
      node.position.y = Math.sin(node.userData.angle) * radius * 0.68;
      node.rotation.x += delta;
      node.rotation.y -= delta * 0.7;
      node.scale.setScalar(1 + Math.sin(elapsed * 2 + index) * 0.12);
    });

    const positionAttribute = network.geometry.getAttribute("position");
    nodes.forEach((node, index) => {
      positionAttribute.setXYZ(index, node.position.x, node.position.y, node.position.z);
    });
    positionAttribute.setXYZ(nodes.length, nodes[0].position.x, nodes[0].position.y, nodes[0].position.z);
    positionAttribute.needsUpdate = true;

    particles.rotation.z += delta * 0.009;
    particles.rotation.y += delta * 0.014;
    shardGroup.rotation.z -= delta * (mode === "burst" ? 0.5 : 0.05);
    shardData.forEach((data, index) => {
      const radius = data.radius * (1 + target.shard * 0.85);
      const angle = data.angle + elapsed * data.speed * (mode === "burst" ? 4 : 1);
      const wave = Math.sin(elapsed * 1.3 + data.phase) * 0.12;
      dummy.position.set(Math.cos(angle) * radius, data.y + wave, data.z + capturePulse * (index % 7) * 0.05);
      dummy.rotation.set(angle, elapsed * data.speed, angle * 0.5);
      const scale = data.scale * (mode === "burst" ? 1.5 : 1);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      shards.setMatrixAt(index, dummy.matrix);
    });
    shards.instanceMatrix.needsUpdate = true;

    capturePulse *= 0.94;
    key.intensity = 38 + capturePulse * 95;
    warm.intensity = 13 + capturePulse * 38;
    camera.position.x += (pointer.x * 0.28 - camera.position.x) * 0.025;
    camera.position.y += (0.15 + pointer.y * 0.22 - camera.position.y) * 0.025;
    camera.lookAt(0, 0, -0.5);
    renderer.render(scene, camera);
  };

  renderer.setAnimationLoop(render);
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !paused) {
        clock.getDelta();
        renderer.setAnimationLoop(render);
      }
    },
    { threshold: 0.01 },
  );
  visibilityObserver.observe(canvas);

  const setPaused = (next) => {
    paused = next;
    if (paused) {
      renderer.render(scene, camera);
    } else {
      clock.getDelta();
    }
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  renderer.render(scene, camera);

  state.three = { setMode, capture, setPaused };
}

function init() {
  initReveal();
  initScrollUI();
  initPointerEffects();
  initMotionToggle();
  initCommandPalette();
  initWorkflow();
  initRegionDemo();
  initRecorder();
  initEditor();
  initDestinations();
  initToolCards();
  initEasterEgg();

  requestAnimationFrame(() => {
    initThreeScene();
  });
}

init();
