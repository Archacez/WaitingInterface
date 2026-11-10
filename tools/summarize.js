// Prints the per-condition summary of downloaded session files: medians and ranges for
// each measure, then the within-participant differences the hypotheses are about.
// Usage: node tools/summarize.js <file-or-folder>...
// Only completed trials count. A participant enters a paired comparison only when both
// of its conditions were completed.
const { listFiles, readSessions, CONDITION_LABELS } = require("./sessions-to-csv.js");

const CONDITIONS = ["no_indicator", "verbal_filler", "progress_ring"];
const MEASURES = [
  ["Actual wait (s)", (t) => t.actual_elapsed_ms / 1000],
  ["Estimated wait (s)", (t) => t.estimated_delay_ms / 1000],
  ["Estimate - actual (s)", (t) => t.estimation_error_ms / 1000],
  ["TLX frustration (0-100)", (t) => t.tlx_frustration],
  ["Raw TLX (0-100)", (t) => t.tlx_raw],
  ["SUS (0-100)", (t) => t.sus_score],
  ["Willing to continue (1-7)", (t) => t.continue_willingness],
];
// the measures compared between conditions, each with the direction that counts as better
const PAIRED = [
  ["TLX frustration", (t) => t.tlx_frustration, "lower"],
  ["Estimate - actual (s)", (t) => t.estimation_error_ms / 1000, "lower"],
  ["Raw TLX", (t) => t.tlx_raw, "lower"],
  ["SUS", (t) => t.sus_score, "higher"],
  ["Willing to continue", (t) => t.continue_willingness, "higher"],
];
const PAIRS = [
  ["verbal_filler", "no_indicator"],
  ["progress_ring", "no_indicator"],
  ["verbal_filler", "progress_ring"],
];

const round = (v) => Math.round(v * 100) / 100;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spread(all) {
  // sessions recorded before a measure existed have no value for it
  const values = all.filter((v) => typeof v === "number");
  if (values.length === 0) return "no data";
  return `${round(median(values))} (${round(Math.min(...values))} to ${round(Math.max(...values))})`;
}

function table(header, rows) {
  const line = (cells) => "| " + cells.join(" | ") + " |";
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("Usage: node tools/summarize.js <file-or-folder>...");
    process.exit(1);
  }

  // the same session can arrive twice, once alone and once inside a download of all sessions
  const sessions = new Map();
  for (const file of targets.flatMap(listFiles)) {
    for (const session of readSessions(file)) sessions.set(session.session_id, session);
  }

  // one completed trial per condition for each participant; a repeated session replaces the earlier one
  const byParticipant = new Map();
  let abandoned = 0;
  const ordered = [...sessions.values()].sort((a, b) => a.session_id.localeCompare(b.session_id));
  for (const session of ordered) {
    for (const trial of session.trials) {
      if (trial.completed !== 1) {
        abandoned += 1;
        continue;
      }
      if (!byParticipant.has(session.participant)) byParticipant.set(session.participant, {});
      byParticipant.get(session.participant)[trial.condition] = trial;
    }
  }
  const trialsFor = (condition) =>
    [...byParticipant.values()].map((trials) => trials[condition]).filter(Boolean);

  const out = [];
  out.push(`Participants with completed trials: ${byParticipant.size}. Trials not completed: ${abandoned}.`);
  out.push("");
  out.push("Median (lowest to highest) per condition");
  out.push("");
  out.push(
    table(
      ["Measure", ...CONDITIONS.map((c) => `${CONDITION_LABELS[c]} (n=${trialsFor(c).length})`)],
      MEASURES.map(([name, get]) => [name, ...CONDITIONS.map((c) => spread(trialsFor(c).map(get)))])
    )
  );
  out.push("");
  const preferences = ordered.map((session) => session.preferred_condition).filter((c) => c !== undefined);
  const tally = [...CONDITIONS, "none"].map(
    (c) => `${CONDITION_LABELS[c] || "no preference"}: ${preferences.filter((p) => p === c).length}`
  );
  out.push(`Preferred condition (${preferences.length} answers): ${tally.join(", ")}`);
  out.push("");
  out.push("Differences within participants (first condition minus second)");
  out.push("");
  const rows = [];
  for (const [a, b] of PAIRS) {
    for (const [name, get, better] of PAIRED) {
      const diffs = [...byParticipant.values()]
        .filter((trials) => trials[a] && trials[b])
        .filter((trials) => typeof get(trials[a]) === "number" && typeof get(trials[b]) === "number")
        .map((trials) => get(trials[a]) - get(trials[b]));
      if (diffs.length === 0) {
        rows.push([`${CONDITION_LABELS[a]} vs ${CONDITION_LABELS[b]}`, name, 0, "no data", "no data", "no data"]);
        continue;
      }
      const mean = diffs.reduce((sum, v) => sum + v, 0) / diffs.length;
      const improved = diffs.filter((v) => (better === "lower" ? v < 0 : v > 0)).length;
      rows.push([
        `${CONDITION_LABELS[a]} vs ${CONDITION_LABELS[b]}`,
        name,
        diffs.length,
        round(mean),
        round(median(diffs)),
        `${improved} of ${diffs.length}`,
      ]);
    }
  }
  out.push(table(["Comparison", "Measure", "Pairs", "Mean difference", "Median difference", "Better in first"], rows));
  console.log(out.join("\n"));
}

main();
