const config = require("./config.json");
const forms = require("./questionnaire.js");
const questions = require("./questions.json");
const store = require("./session.js");

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

// ---------- condition controller ----------
function getConditionOrder(participantId) {
  if (config.condition && config.condition !== "all") return [config.condition];
  const n = parseInt(participantId, 10);
  const index = Number.isNaN(n) ? Math.floor(Math.random() * ORDERS.length) : (n - 1 + ORDERS.length) % ORDERS.length;
  return ORDERS[index];
}

// Each part of the session uses its own question set, picked by the part's position.
// The condition order differs between participants, so no condition is always paired
// with the same questions.
function questionsForPart(partNumber) {
  const names = Object.keys(questions.sets);
  return questions.sets[names[(partNumber - 1) % names.length]].slice(0, config.requestsPerCondition);
}

// The filler lines come from a fixed list. The starting line shifts with the participant
// number, so a line is not tied to one position in the conversation.
function fillerFor(participantId, requestNumber) {
  const lines = config.fillerTexts;
  return lines[(parseInt(participantId, 10) - 1 + requestNumber - 1) % lines.length];
}

// ---------- speech ----------

// Speech depends on a voice service that can fail or stall. Every spoken line resolves
// with how it ended (finished, failed, or stopped at the cap), so a speech problem never
// ends a session.
function speakSafely(context, text, capMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    Promise.resolve()
      .then(() => context.agent.speak(text))
      .then(
        () => finish("spoken"),
        (err) => finish("failed: " + String((err && err.message) || err))
      );
    context.wait(capMs).then(() => {
      if (settled) return;
      context.agent.stopSpeaking();
      finish("cut off");
    });
  });
}

// The filler is started without being awaited, so it cannot change the length of the wait.
function startFiller(context, text, startedAt, record) {
  let settled = false;
  const settle = (key, value) => {
    if (settled) return;
    settled = true;
    record(key, value);
  };
  const sinceStart = () => Math.round(performance.now() - startedAt);
  const finished = Promise.resolve()
    .then(() => context.agent.speak(text))
    .then(
      () => settle("filler_end_ms", sinceStart()),
      (err) => settle("filler_error", String((err && err.message) || err))
    );
  return {
    finished,
    // has no effect once the line has ended
    cutOff() {
      if (settled) return;
      settle("filler_cut_off_ms", sinceStart());
      context.agent.stopSpeaking();
    },
  };
}

// One wait. Returns the time from the request being sent to the moment the reply may start.
async function runWait(context, condition, fillerText, record) {
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
    // The filler starts with the wait and plays once. Its length depends on the voice,
    // so the moment it ends is logged against the start of the wait.
    const filler = startFiller(context, fillerText, startedAt, record);
    if (!config.fillerInsideDelay) {
      // the delay doubles as the longest time the line may take
      await Promise.race([filler.finished, context.wait(config.actualDelayMs)]);
      filler.cutOff();
    }
    await context.wait(config.actualDelayMs);
    // the wait has the same length in every condition, so a line still playing stops here
    filler.cutOff();
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
    // Screens share one look. The wait panel keeps the plain host, so the indicator that
    // the platform draws inside it is not restyled.
    host.style.cssText +=
      "width:min(600px,calc(100% - 48px)); padding:20px 24px; box-shadow:0 6px 24px rgba(0,0,0,0.25); " +
      "font:16px/1.45 system-ui,sans-serif; box-sizing:border-box;";
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
  button.type = "button";
  // the first button on a screen is the way forward; later ones are side actions
  button.className = host.querySelector("button") ? "button button-secondary" : "button button-primary";
  button.style.cssText = "margin:4px 8px 0 0; min-height:40px; padding:8px 18px; font-size:16px;";
  button.textContent = text;
  button.addEventListener("click", onClick);
  host.appendChild(button);
  return button;
}

function addText(host, text, css) {
  const p = document.createElement("p");
  p.style.cssText = "margin:0 0 12px;" + (css || "");
  p.textContent = text;
  host.appendChild(p);
  return p;
}

function addProgress(host, text) {
  return addText(host, text, "font-size:13px; opacity:0.75; margin-bottom:6px;");
}

// One line of the conversation, with the speaker set apart from what was said
function addTurn(host, speaker, text) {
  const p = addText(host, "");
  const who = document.createElement("strong");
  who.textContent = speaker + ": ";
  p.append(who, text);
  return p;
}

// Filled in by the experimenter before the participant sits down: the number decides the
// order of conditions, so it comes from the schedule, not from the participant.
// Nothing is preselected, because a default left unchanged would repeat an order.
function askParticipantId(context) {
  return showScreen(context, (host, done) => {
    addText(host, "Experimenter setup", "font-weight:600;");
    addText(host, "Select the participant number from the schedule, then hand over the laptop on the next screen.");
    const select = document.createElement("select");
    select.style.cssText = "padding:6px 10px; margin-right:12px; font-size:16px;";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Select";
    select.appendChild(empty);
    for (let n = 1; n <= config.maxParticipants; n++) {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = String(n);
      select.appendChild(option);
    }
    host.appendChild(select);
    const next = addButton(host, "Continue", () => {
      if (select.value) done(select.value);
    });
    next.disabled = true;
    const note = addText(host, "", "margin:12px 0 0; font-size:14px;");

    // a number used twice gives two people the same order and leaves another order short
    const used = new Set(store.readAll().map((session) => String(session.participant_id)));
    select.addEventListener("change", () => {
      next.disabled = !select.value;
      note.textContent = used.has(select.value)
        ? "This number already has a session saved on this computer. Continue only if this is a restart for the same participant."
        : "";
    });
    if (config.condition !== "all") {
      addText(host, "Single-condition run: " + config.condition + ". Set condition to \"all\" for a study session.", "margin:12px 0 0; font-size:14px;");
    }
  });
}

function showInstructions(context, totalParts, perPart) {
  return showScreen(context, (host, done) => {
    addText(
      host,
      "You will have a short conversation with the assistant" +
      (totalParts === 1 ? "." : ", in " + totalParts + " parts.")
    );
    addText(
      host,
      "In each part you ask it " + perPart + " questions, one at a time. Choose a question, say it out loud, " +
      "then press it to send it. The assistant answers out loud. After each part, you answer a few short questions about it."
    );
    addButton(host, "Start", () => done());
  });
}

// The constant task: the same list, in the same words, in every condition.
// The participant chooses the order, which makes it a conversation they lead.
function showQuestionList(context, progress, remaining) {
  return showScreen(context, (host, done) => {
    addProgress(host, progress);
    addText(host, "Choose a question, say it out loud, then press it to send it.", "font-weight:600;");
    for (const question of remaining) {
      const button = addButton(host, question.question, () => done(question));
      button.className = "button button-secondary";
      button.style.cssText += "display:block; width:100%; margin:6px 0 0; text-align:left;";
    }
  });
}

// The agent speaks the reply; the text stays on screen so a missed word or a sound problem
// does not cost the participant the answer. Continue unlocks when the speech has ended,
// so every participant hears every reply in full.
function showReply(context, progress, question, record) {
  return showScreen(context, (host, done) => {
    addProgress(host, progress);
    addTurn(host, "You", question.question);
    addTurn(host, "Assistant", question.reply);
    const next = addButton(host, "Continue", () => done());
    next.disabled = true;
    const startedAt = performance.now();
    speakSafely(context, question.reply, config.replyMaxMs).then((status) => {
      record("reply_ms", Math.round(performance.now() - startedAt));
      if (status !== "spoken") record("reply_speech", status);
      next.disabled = false;
    });
  });
}

// Post-part form: the estimated wait (compared with the measured waits), then NASA-TLX and SUS.
// The questionnaire is taller than the other screens, so its panel scrolls.
async function collectResponses(context, part) {
  const seconds = await showScreen(context, (host, done) => forms.askEstimate(host).then(done));
  const estimatedMs = Math.round(seconds * 1000);
  const ratings = await showScreen(context, (host, done) => {
    host.style.maxHeight = "calc(100% - 48px)";
    host.style.overflowY = "auto";
    host.style.width = "min(720px,calc(100% - 48px))";
    forms.askConditionQuestionnaire(host, "About part " + part.partNumber).then(done);
  });
  return { estimated_delay_ms: estimatedMs, estimation_error_ms: estimatedMs - part.actualMs, ...ratings };
}

// Asked once, after every condition has been met. Parts are named by position because
// the participant never learns what differed between them.
// Resolves with the part number, or 0 for no preference.
function showPreference(context, totalParts) {
  return showScreen(context, (host, done) => {
    addText(host, "Thinking about the whole conversation, which part did you prefer?", "font-weight:600;");
    for (let part = 1; part <= totalParts; part++) {
      addButton(host, "Part " + part, () => done(part)).className = "button button-secondary";
    }
    addButton(host, "No preference", () => done(0)).className = "button button-secondary";
  });
}

// Last screen the participant sees. The data screen behind it lists condition names and
// measured waits, so it opens only from a button addressed to the experimenter.
function showHandoff(context, failed) {
  return showScreen(context, (host, done) => {
    addText(
      host,
      failed
        ? "Something went wrong. Please let the experimenter know."
        : "Thank you. That is the end of the session, and all your responses have been recorded. " +
          "Please let the experimenter know you have finished."
    );
    const open = addButton(host, "Experimenter: save data", () => done());
    open.className = "button button-secondary";
  });
}

// ---------- session record ----------

// Wraps a platform logger so every value also lands in the session record, which is saved
// as it grows. The platform logger is not allowed to end a session, since the session
// record alone is enough to analyse.
function logTrial(metrics, session) {
  const trial = { started_at: new Date().toISOString() };
  session.trials.push(trial);
  store.save(session);
  return {
    record(key, value, note) {
      trial[key] = value;
      try {
        metrics.record(key, value, note);
      } catch (err) {
        console.warn("metrics.record failed for " + key, err);
      }
      store.save(session);
    },
  };
}

function describe(session) {
  const done = session.trials.filter((trial) => trial.completed === 1).length;
  const stopped = session.trials.find((trial) => trial.abandoned_at_stage);
  let line = session.participant + ": " + done + " of " + session.order.length + " parts completed";
  if (stopped) line += ", stopped at " + stopped.abandoned_at_stage;
  else if (session.error) line += ", error: " + session.error;
  else if (!session.completed_all) line += ", not finished";
  return line;
}

// Experimenter only. Download is the normal route; Copy and the visible text remain for
// browsers that block either one. Earlier sessions are reachable from here because a
// stopped session never arrives at this screen itself.
function showSessionData(context, session) {
  return showScreen(context, (host, done) => {
    host.style.maxHeight = "calc(100% - 48px)";
    host.style.overflowY = "auto";

    addText(host, "Session data (experimenter). Save the file before closing.");
    const summary = document.createElement("div");
    const pre = document.createElement("pre");
    pre.style.cssText = "max-height:160px; overflow:auto; font-size:11px; user-select:text;";
    host.append(summary, pre);
    const status = addText(host, "");

    let shown = [];
    const show = (sessions) => {
      shown = sessions;
      summary.replaceChildren();
      for (const each of sessions) addText(summary, describe(each));
      pre.textContent = store.toText(sessions);
    };
    show([session]);

    addButton(host, "Download file", () => {
      try {
        store.download(shown);
        status.textContent = "Downloaded " + store.fileName(shown);
      } catch (err) {
        status.textContent = "Download failed. Use Copy, or select the text above.";
      }
    });
    addButton(host, "Copy", () => {
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(store.toText(shown)))
        .then(
          () => { status.textContent = "Copied"; },
          () => { status.textContent = "Copy failed. Use Download, or select the text above."; }
        );
    });
    addButton(host, "Show all saved sessions", () => {
      show(store.readAll());
      status.textContent = shown.length + " saved on this computer";
    });
    // two presses, so one stray click cannot delete the only copy
    let armed = false;
    const remove = addButton(host, "Remove saved sessions", () => {
      if (!armed) {
        armed = true;
        remove.textContent = "Press again to remove all";
        return;
      }
      store.removeAll();
      armed = false;
      remove.textContent = "Remove saved sessions";
      status.textContent = "Saved sessions removed";
    });
    addButton(host, "Close", () => done());
  });
}

// ---------- run flow ----------

// One part: every question of the set is asked under one condition, then the forms.
async function runPart(context, session, condition, partNumber, totalParts) {
  const participantId = session.participant_id;
  const metrics = logTrial(context.metrics.create("waiting-" + condition), session);
  current.metrics = metrics;
  current.trial = partNumber;
  current.condition = condition;

  metrics.record("participant_id", participantId);
  metrics.record("condition", condition);
  metrics.record("trial_number", partNumber);
  metrics.record("configured_delay_ms", config.actualDelayMs);
  metrics.record("expected_delay_ms", config.expectedDelayMs);

  const remaining = questionsForPart(partNumber);
  const requestCount = remaining.length;
  const waits = [];

  for (let request = 1; request <= requestCount; request++) {
    const progress =
      (totalParts === 1 ? "" : "Part " + partNumber + " of " + totalParts + " · ") +
      "Question " + request + " of " + requestCount;
    // each request logs under its own prefix, so the waits of one part stay apart
    const record = (key, value) => metrics.record("r" + request + "_" + key, value);

    current.stage = "list";
    const question = await showQuestionList(context, progress, remaining);
    remaining.splice(remaining.indexOf(question), 1);
    record("question_id", question.id);

    current.stage = "wait";
    const waitMs = await runWait(context, condition, fillerFor(participantId, request), record);
    record("wait_ms", waitMs);
    waits.push(waitMs);

    current.stage = "reply";
    await showReply(context, progress, question, record);
  }

  // the estimate question asks about the usual wait in this part, so it is compared with the mean
  const actualMs = Math.round(waits.reduce((sum, ms) => sum + ms, 0) / waits.length);
  metrics.record("request_count", requestCount);
  metrics.record("actual_elapsed_ms", actualMs);

  current.stage = "form";
  const responses = await collectResponses(context, { condition, partNumber, actualMs });
  for (const [key, value] of Object.entries(responses)) {
    metrics.record(key, value);
  }
  metrics.record("completed", 1);
}

module.exports.run = async function run(context) {
  current = { metrics: null, completedAll: false, stage: "start", trial: 0, condition: null };

  const participantId = await askParticipantId(context);
  const order = getConditionOrder(participantId);
  const total = order.length;
  const session = store.create(participantId, order, { ...config, tlxSteps: forms.tlxSteps });

  current.stage = "instructions";
  await showInstructions(context, total, config.requestsPerCondition);

  // heard before any condition starts, in the same words for everyone; it also lets the
  // experimenter confirm the sound works before the first wait
  current.stage = "greeting";
  const greeting = await speakSafely(context, config.greetingText, config.replyMaxMs);
  if (greeting !== "spoken") {
    session.greeting_speech = greeting;
    store.save(session);
  }

  // an unexpected error still ends on the data screen, so the finished parts can be saved
  try {
    for (let i = 0; i < total; i++) {
      await runPart(context, session, order[i], i + 1, total);
    }
    // a preference only means something when there was more than one condition to compare
    if (total > 1) {
      current.stage = "preference";
      const part = await showPreference(context, total);
      session.preferred_part = part;
      session.preferred_condition = part === 0 ? "none" : order[part - 1];
      try {
        context.metrics.create("waiting-session").record("preferred_condition", session.preferred_condition);
      } catch (err) {
        console.warn("metrics.record failed for preferred_condition", err);
      }
    }
    store.finish(session);
  } catch (err) {
    // Stop can surface here as a failed wait; stop() has already logged the abandonment
    if (current.stopped) return;
    session.error = String((err && err.message) || err) + " (stage: " + current.stage + ")";
    session.ended_at = new Date().toISOString();
    store.save(session);
    console.error(err);
  }
  if (current.stopped) return;
  current.completedAll = true;

  await showHandoff(context, !session.completed_all);
  await showSessionData(context, session);
};

module.exports.stop = async function stop(context) {
  if (current) current.stopped = true;
  // Log abandonment for the part that was in progress
  if (current && !current.completedAll && current.metrics) {
    current.metrics.record("completed", 0);
    current.metrics.record("abandoned_at_stage", current.stage);
  }
  context.agent.stopSpeaking();
  context.agent.neutral();
  context.ui.clear();
};
