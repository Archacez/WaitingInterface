// Local stand-in for the eEVA Project Studio runtime. Each Run loads src/ from
// the local server, calls the entry file's run(context), and lists what the
// project records. The agent, waiting indicator and metrics logger are
// simplified, so final checks still belong in eEVA.

const FAST_FACTOR = 20;
const WORDS_PER_SECOND = 2.5;

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const logList = $("log");
const container = $("container");
const recorded = [];

let current = null;

function log(kind, text) {
  const row = document.createElement("li");
  row.className = kind;
  row.textContent = text;
  logList.appendChild(row);
  logList.scrollTop = logList.scrollHeight;
}

function removeOverlays() {
  stage.querySelectorAll(".overlay").forEach((node) => node.remove());
}

// ---------- module loader ----------

function resolvePath(from, request) {
  const parts = from.split("/").slice(0, -1);
  for (const piece of request.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

function createRequire(files) {
  const cache = {};
  function load(file) {
    const found = [file, file + ".js", file + ".json"].find((name) => name in files);
    if (!found) throw new Error("Cannot find module " + file);
    if (cache[found]) return cache[found].exports;
    const module = { exports: {} };
    cache[found] = module;
    if (found.endsWith(".json")) {
      module.exports = JSON.parse(files[found]);
    } else {
      // sourceURL makes errors and the browser's developer tools show the real file name
      const body = files[found] + "\n//# sourceURL=" + found;
      new Function("module", "exports", "require", body)(module, module.exports, (request) =>
        load(resolvePath(found, request))
      );
    }
    return module.exports;
  }
  return load;
}

// ---------- stand-ins for eEVA services ----------

// only voices that run on this machine are used, so spoken text is not sent anywhere
function localVoice() {
  return speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.startsWith("en")) || null;
}

function createAgent(opts, isStopped, never) {
  const bubble = $("speech");
  const show = (text) => {
    bubble.textContent = text || "";
    bubble.hidden = !text;
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function speakAloud(text) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = localVoice();
      utterance.onend = utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  return {
    async speak(text) {
      if (isStopped()) return never();
      log("speech", "Agent says: " + text);
      show(text);
      if (opts.fast) await pause(150);
      else if (opts.voice && localVoice()) await speakAloud(text);
      else await pause((text.split(/\s+/).length / WORDS_PER_SECOND) * 1000);
      if (isStopped()) return never();
      show("");
    },
    stopSpeaking() {
      speechSynthesis.cancel();
      show("");
    },
    neutral() {},
    setExpression(name) {
      log("info", "Expression: " + name);
    },
    applyAU() {},
  };
}

function createWaitingIndicator(host, config, opts) {
  let timer = null;
  let startedAt = 0;
  return {
    start() {
      startedAt = performance.now();
      if (config.condition !== "progress_ring") return;
      const label = document.createElement("div");
      const track = document.createElement("div");
      const fill = document.createElement("div");
      track.style.cssText = "height:10px; margin-top:6px; border-radius:5px; background:#dde5e2; overflow:hidden;";
      fill.style.cssText = "height:100%; width:0; background:#1f6f4a;";
      track.appendChild(fill);
      host.replaceChildren(label, track);
      const expected = Math.max(1, (config.expectedDelayMs || 0) / (opts.fast ? FAST_FACTOR : 1));
      const tick = () => {
        const share = Math.min(1, (performance.now() - startedAt) / expected);
        fill.style.width = share * 100 + "%";
        label.textContent = "Progress indicator (test stand-in): " + Math.round(share * 100) + "%";
      };
      tick();
      timer = setInterval(tick, 50);
    },
    complete() {
      clearInterval(timer);
      return { elapsedMs: Math.round(performance.now() - startedAt) };
    },
    clear() {
      clearInterval(timer);
    },
  };
}

function createMetrics() {
  return {
    create(name) {
      const records = [];
      return {
        record(key, value, note) {
          const entry = { logger: name, key, value, note };
          records.push(entry);
          recorded.push(entry);
          log("metric", `${name}: ${key} = ${value}` + (note ? `  (${note})` : ""));
        },
        exportJson: async () => records.map((entry) => ({ ...entry })),
      };
    },
  };
}

function unavailable(name, provided = {}) {
  return new Proxy(provided, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {
        throw new Error(`${name}.${String(key)} is not available in the local test`);
      };
    },
  });
}

function createContext(opts) {
  let stopped = false;
  const cleanups = [];
  const isStopped = () => stopped;
  // after Stop, pending waits and speech never settle, so an old run cannot keep going
  const never = () => new Promise(() => {});

  const context = {
    agent: createAgent(opts, isStopped, never),
    wait(ms) {
      if (stopped) return never();
      return new Promise((resolve) => setTimeout(resolve, opts.fast ? ms / FAST_FACTOR : ms)).then(() =>
        stopped ? never() : undefined
      );
    },
    metrics: createMetrics(),
    helpers: {
      project: unavailable("helpers.project", {
        createWaitingIndicator: (host, config) => createWaitingIndicator(host, config, opts),
      }),
    },
    ui: {
      mountOverlay(element) {
        if (stopped) return;
        element.classList.add("overlay");
        stage.appendChild(element);
      },
      clear() {
        removeOverlays();
        container.replaceChildren();
      },
      heading(text) {
        const node = document.createElement("h3");
        node.textContent = text;
        container.appendChild(node);
      },
      paragraph(text) {
        const node = document.createElement("p");
        node.textContent = text;
        container.appendChild(node);
      },
      result(label, ...values) {
        const node = document.createElement("p");
        node.textContent = label + ": " + values.join(" / ");
        container.appendChild(node);
      },
      setRunnerControlsVisible() {},
    },
    container,
    onCleanup(fn) {
      cleanups.push(fn);
    },
    speech: unavailable("speech"),
    llm: unavailable("llm"),
    webcam: unavailable("webcam"),
    biofeedback: unavailable("biofeedback"),
  };

  return {
    context,
    cleanups,
    markStopped() {
      stopped = true;
      speechSynthesis.cancel();
    },
  };
}

// ---------- runner ----------

async function stop() {
  if (!current) return;
  const { module, runtime } = current;
  current = null;
  runtime.markStopped();
  try {
    if (module && module.stop) await module.stop(runtime.context);
  } catch (err) {
    log("error", "stop() failed: " + (err.stack || err));
  }
  for (const fn of runtime.cleanups.splice(0)) {
    try {
      fn();
    } catch (err) {
      log("error", "Cleanup failed: " + (err.stack || err));
    }
  }
  removeOverlays();
  $("speech").hidden = true;
  log("info", "Stopped");
}

async function run() {
  await stop();
  logList.replaceChildren();
  container.replaceChildren();
  recorded.length = 0;

  const opts = { fast: $("speed").value === "fast", voice: $("voice").checked, condition: $("condition").value };
  let project;
  try {
    const response = await fetch("/project", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    project = await response.json();
  } catch (err) {
    log("error", "Could not load the project from the local server: " + err.message);
    return;
  }

  // the condition choice changes only this run's copy of config.json, never the file
  if (opts.condition && project.files["src/config.json"]) {
    const config = JSON.parse(project.files["src/config.json"]);
    config.condition = opts.condition;
    project.files["src/config.json"] = JSON.stringify(config);
  }

  const runtime = createContext(opts);
  current = { module: null, runtime };
  const mine = current;
  log("info", `Run: ${project.entry}, ${opts.fast ? "fast" : "real time"}` +
    (opts.condition ? `, condition ${opts.condition}` : ""));
  if (opts.voice && !opts.fast && !localVoice()) {
    log("info", "No local English voice found, so agent lines are timed but silent");
  }

  try {
    mine.module = createRequire(project.files)(project.entry);
    await mine.module.run(runtime.context);
    if (current === mine) log("info", "run() finished");
  } catch (err) {
    log("error", String(err.stack || err));
  }
}

// the voice list loads asynchronously; asking early gives it time before the first Run
if ("speechSynthesis" in window) speechSynthesis.getVoices();

$("run").addEventListener("click", run);
$("stop").addEventListener("click", stop);
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(recorded, null, 2));
    log("info", `Copied ${recorded.length} recorded values`);
  } catch (err) {
    log("error", "Copy failed: " + err.message);
  }
});
