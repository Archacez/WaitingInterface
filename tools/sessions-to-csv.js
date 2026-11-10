// Turns downloaded session files into one CSV with a row per trial, for the trial log
// and the per-condition analysis.
// Usage: node tools/sessions-to-csv.js <file-or-folder>... [--out trials.csv]
// Without --out the CSV is printed.
const fs = require("fs");
const path = require("path");

// the names the trial log uses in its Condition column
const CONDITION_LABELS = {
  no_indicator: "no feedback",
  verbal_filler: "verbal filler",
  progress_ring: "progress bar",
};
const TLX = ["frustration", "mental", "physical", "temporal", "performance", "effort"];
const SUS_ITEMS = 10;

// times are the mean over the requests of one part
const seconds = (ms) => (typeof ms === "number" ? ms / 1000 : "");
const value = (v) => (v === undefined || v === null ? "" : v);

const COLUMNS = [
  ["participant", (s) => s.participant],
  ["session_started_at", (s) => s.started_at],
  ["trial_started_at", (s, t) => value(t.started_at)],
  ["trial_number", (s, t) => value(t.trial_number)],
  ["condition", (s, t) => CONDITION_LABELS[t.condition] || value(t.condition)],
  ["requests", (s, t) => value(t.request_count)],
  ["actual_wait_s", (s, t) => seconds(t.actual_elapsed_ms)],
  ["estimated_wait_s", (s, t) => seconds(t.estimated_delay_ms)],
  ["estimate_minus_actual_s", (s, t) => seconds(t.estimation_error_ms)],
  ...TLX.map((key) => ["tlx_" + key, (s, t) => value(t["tlx_" + key])]),
  ["tlx_raw", (s, t) => value(t.tlx_raw)],
  ...Array.from({ length: SUS_ITEMS }, (_, i) => ["sus_" + (i + 1), (s, t) => value(t["sus_" + (i + 1)])]),
  ["sus_score", (s, t) => value(t.sus_score)],
  ["continue_willingness", (s, t) => value(t.continue_willingness)],
  // 1 on the row of the condition this participant preferred, 0 on the others
  ["preferred", (s, t) => (s.preferred_condition === undefined ? "" : s.preferred_condition === t.condition ? 1 : 0)],
  ["completed", (s, t) => value(t.completed)],
  ["abandoned_at_stage", (s, t) => value(t.abandoned_at_stage)],
  ["notes", notes],
];

// anything that could justify excluding a trial, gathered so it is not overlooked
function notes(session, trial) {
  const parts = [];
  // per-request keys carry a prefix such as r2_ for the second request of the part
  for (const [key, v] of Object.entries(trial)) {
    const [, request, name] = /^(r\d+)_(.+)$/.exec(key) || [];
    if (name === "filler_cut_off_ms") parts.push(request + " filler cut off at " + v + " ms");
    if (name === "filler_error") parts.push(request + " filler failed: " + v);
    if (name === "reply_speech") parts.push(request + " reply speech " + v);
  }
  if (session.greeting_speech) parts.push("greeting speech " + session.greeting_speech);
  return parts.join("; ");
}

function cell(v) {
  const text = String(v);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function listFiles(target) {
  if (!fs.statSync(target).isDirectory()) return [target];
  return fs
    .readdirSync(target)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort()
    .map((name) => path.join(target, name));
}

// a file holds one session, or a list of them when all saved sessions were downloaded together
function readSessions(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(data) ? data : [data];
  const bad = list.find((s) => !s || !Array.isArray(s.trials) || !s.session_id);
  if (bad !== undefined) throw new Error(file + " is not a session file");
  return list;
}

function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? null : args[outAt + 1];
  const targets = outAt === -1 ? args : args.filter((_, i) => i !== outAt && i !== outAt + 1);
  if (targets.length === 0 || (outAt !== -1 && !out)) {
    console.error("Usage: node tools/sessions-to-csv.js <file-or-folder>... [--out trials.csv]");
    process.exit(1);
  }

  // the same session can arrive twice, once alone and once inside a download of all sessions
  const sessions = new Map();
  for (const file of targets.flatMap(listFiles)) {
    for (const session of readSessions(file)) sessions.set(session.session_id, session);
  }

  const rows = [COLUMNS.map(([name]) => name)];
  const ordered = [...sessions.values()].sort((a, b) => a.session_id.localeCompare(b.session_id));
  for (const session of ordered) {
    for (const trial of session.trials) {
      rows.push(COLUMNS.map(([, get]) => get(session, trial)));
    }
  }
  const csv = rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";

  if (out) {
    fs.writeFileSync(out, csv);
    console.error(`Wrote ${rows.length - 1} trials from ${sessions.size} sessions to ${out}`);
  } else {
    process.stdout.write(csv);
  }
}

if (require.main === module) main();

module.exports = { listFiles, readSessions, CONDITION_LABELS };
