const config = require("./config.json");
const forms = require("./questionnaire.js");

// All 6 orders of the 3 conditions. Participant ID picks one (ID 1 -> order 1, ..., ID 7 -> order 1 again).
const ORDERS = [
  ["no_indicator", "progress_ring", "verbal_filler"],
  ["progress_ring", "verbal_filler", "no_indicator"],
  ["verbal_filler", "no_indicator", "progress_ring"],
  ["no_indicator", "verbal_filler", "progress_ring"],
  ["verbal_filler", "progress_ring", "no_indicator"],
  ["progress_ring", "no_indicator", "verbal_filler"],
];

let current = null; // shared with stop() so abandonment can be logged
const trialLoggers = [];

// ---------- condition controller ----------
function getConditionOrder(participantId) {
  if (config.condition && config.condition !== "all") return [config.condition];
  const n = parseInt(participantId, 10);
  const index = Number.isNaN(n) ? Math.floor(Math.random() * ORDERS.length) : (n - 1 + ORDERS.length) % ORDERS.length;
  return ORDERS[index];
}

async function runWait(context, condition) {
  const host = createHost();
  // Same as the template: the helper is always created, but no panel is mounted for no_indicator
  if (condition === "progress_ring") {
    context.ui.mountOverlay(host);
    }
  const waitUi = context.helpers.project.createWaitingIndicator(host, { ...config, condition });
  context.onCleanup(() => waitUi.clear());

  const startedAt = performance.now();
  waitUi.start();

  if (condition === "verbal_filler") {
    if (config.fillerInsideDelay) {
      await Promise.all([
        context.agent.speak(config.fillerText),
        context.wait(config.actualDelayMs),
      ]);
    } else {
      await context.agent.speak(config.fillerText);
      await context.wait(config.actualDelayMs);
    }
  } else {
    await context.wait(config.actualDelayMs);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  waitUi.complete();
  host.remove();
  return elapsedMs;
}

// ---------- screens ----------
function createHost() {
  const host = document.createElement("section");
  host.style.cssText =
    "bottom:24px; left:50%; width:min(520px,calc(100% - 48px)); " +
    "transform:translateX(-50%); padding:16px; border-radius:10px; " +
    "background:white; color:#183322;";
  return host;
}

// Shows one screen and resolves when build() calls done(value)
function showScreen(context, build) {
  return new Promise((resolve) => {
    const host = createHost();
    const done = (value) => {
      host.remove();
      resolve(value);
    };
    build(host, done);
    context.ui.mountOverlay(host);
  });
}

function addButton(host, text, onClick) {
  const button = document.createElement("button");
  button.className = "button button-secondary";
  button.textContent = text;
  button.addEventListener("click", onClick);
  host.appendChild(button);
  return button;
}

function addText(host, text) {
  const p = document.createElement("p");
  p.textContent = text;
  host.appendChild(p);
}

function askParticipantId(context) {
  return showScreen(context, (host, done) => {
    addText(host, "Select your participant number:");
    const select = document.createElement("select");
    select.style.padding = "6px 10px";
    for (let n = 1; n <= 12; n++) {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = String(n);
      select.appendChild(option);
    }
    host.appendChild(select);
    addButton(host, "Continue", () => done(select.value));
  });
}

function showInstructions(context, totalTrials) {
  return showScreen(context, (host, done) => {
    addText(
      host,
      "You will send " + totalTrials + " requests to the assistant, one at a time. " +
      "After each one you will wait for the response, then answer a few short questions."
    );
    addButton(host, "Start", () => done());
  });
}

// The constant task: identical in every condition
function showTask(context, trialNumber, totalTrials) {
  return showScreen(context, (host, done) => {
    addText(host, "Request " + trialNumber + " of " + totalTrials + ". Press the button to send your request to the assistant.");
    addButton(host, "Send request", () => done());
  });
}

// Post-wait form: the estimated wait (compared with the measured wait), then NASA-TLX and SUS.
// The questionnaire is taller than the other screens, so its panel scrolls.
async function collectResponses(context, trial) {
  const seconds = await showScreen(context, (host, done) => forms.askEstimate(host).then(done));
  const estimatedMs = Math.round(seconds * 1000);
  const ratings = await showScreen(context, (host, done) => {
    host.style.maxHeight = "calc(100% - 48px)";
    host.style.overflowY = "auto";
    host.style.boxSizing = "border-box";
    forms.askConditionQuestionnaire(host, "About request " + trial.trialNumber).then(done);
  });
  return { estimated_delay_ms: estimatedMs, estimation_error_ms: estimatedMs - trial.actualMs, ...ratings };
}

function showThanks(context) {
  return showScreen(context, (host, done) => {
    addText(host, "Thank you. All your responses have been recorded.");
    addButton(host, "Close", () => done());
  });
}


async function showMetricsExport(context) {
  const exported = [];
  for (const m of trialLoggers) {
    let data;
    try {
      data = await m.exportJson();
    } catch (e) {
      data = "exportJson failed: " + e.message;
    }
    if (typeof data !== "string") data = JSON.stringify(data, null, 2);
    exported.push(data);
  }
  const allText = exported.join("\n\n");
  console.log("WAITING_INTERFACE_EXPORT", allText);

  return showScreen(context, (host, done) => {
    addText(host, "Logged metrics (testing only)");
    const pre = document.createElement("pre");
    pre.style.cssText = "max-height:180px; overflow:auto; font-size:11px;";
    pre.textContent = allText || "(nothing returned)";
    host.appendChild(pre);
    addButton(host, "Copy", () => navigator.clipboard.writeText(allText));
    addButton(host, "Close", () => done());
  });
}

// ---------- run flow ----------
module.exports.run = async function run(context) {
  trialLoggers.length = 0;

  current = { metrics: null, completedAll: false, stage: "start", trial: 0, condition: null };

  const participantId = await askParticipantId(context);
  const order = getConditionOrder(participantId);
  const total = order.length;

  current.stage = "instructions";
  await showInstructions(context, total);

  for (let i = 0; i < total; i++) {
    const condition = order[i];
    const trialNumber = i + 1;

    // One metrics logger per trial, named by condition. Each record carries participant and position.
    const metrics = context.metrics.create("waiting-" + condition);
    trialLoggers.push(metrics);
    current.metrics = metrics;
    current.trial = trialNumber;
    current.condition = condition;

    metrics.record("participant_id", participantId);
    metrics.record("condition", condition);
    metrics.record("trial_number", trialNumber);
    metrics.record("configured_delay_ms", config.actualDelayMs);
    metrics.record("expected_delay_ms", config.expectedDelayMs);

    current.stage = "task";
    await showTask(context, trialNumber, total);

    current.stage = "wait";
    const actualMs = await runWait(context, condition);
    metrics.record("actual_elapsed_ms", actualMs);

    current.stage = "form";
    const responses = await collectResponses(context, { condition, trialNumber, actualMs });
    for (const [key, value] of Object.entries(responses)) {
      metrics.record(key, value);
    }
    metrics.record("completed", 1);
  }

  await showThanks(context);
  current.completedAll = true;
  if (config.debug) await showMetricsExport(context);
};

module.exports.stop = async function stop(context) {
  // Log abandonment for the trial that was in progress
  if (current && !current.completedAll && current.metrics) {
    current.metrics.record("completed", 0);
    current.metrics.record("abandoned_at_stage", current.stage);
  }
  context.agent.stopSpeaking();
  context.agent.neutral();
  context.ui.clear();
};
