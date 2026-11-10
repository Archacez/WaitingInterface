const items = require("./questionnaire.json");

const INK = "#183322";
const SOFT = "#e6efe9";
const ALERT = "#b3261e";

function el(tag, text, css) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (css) node.style.cssText = css;
  return node;
}

function button(label, primary) {
  const node = el("button", label, "min-height:40px; padding:8px 18px; font-size:16px;");
  node.type = "button";
  node.className = primary ? "button button-primary" : "button button-secondary";
  return node;
}

// boxes instead of a slider, so no answer starts preselected
function choiceRow(count, labelFor, onPick) {
  const row = el("div", "", `display:grid; grid-template-columns:repeat(${count},1fr); gap:3px;`);
  const boxes = [];
  let picked = -1;
  const paint = (box, state) => {
    box.style.background = state === "on" ? INK : state === "hover" ? SOFT : "white";
    box.style.color = state === "on" ? "white" : INK;
  };
  for (let i = 0; i < count; i++) {
    const box = el(
      "button",
      labelFor(i),
      `min-height:36px; padding:0; border:1px solid ${INK}; border-radius:4px; ` +
        `background:white; color:${INK}; font:inherit; cursor:pointer;`
    );
    box.type = "button";
    box.setAttribute("aria-pressed", "false");
    box.addEventListener("mouseenter", () => {
      if (picked !== i) paint(box, "hover");
    });
    box.addEventListener("mouseleave", () => {
      if (picked !== i) paint(box, "off");
    });
    box.addEventListener("click", () => {
      picked = i;
      boxes.forEach((other, j) => {
        paint(other, j === i ? "on" : "off");
        other.setAttribute("aria-pressed", String(j === i));
      });
      onPick(i);
    });
    boxes.push(box);
    row.appendChild(box);
  }
  return row;
}

function anchors(low, high) {
  const row = el("div", "", "display:flex; justify-content:space-between; font-size:13px; opacity:0.8; margin-top:3px;");
  row.append(el("span", low), el("span", high));
  return row;
}

// One page of rated items. Continue is always enabled: pressing it with items left open
// points at the first one, which a disabled button cannot do on a page that scrolls.
// Each entry of rows is { lines: [nodes shown above the scale], count, labelFor, low, high }.
// Resolves with the index picked in every row.
function askPage(host, heading, intro, rows, step) {
  return new Promise((resolve) => {
    host.replaceChildren();
    host.scrollTop = 0;
    const picks = new Array(rows.length).fill(null);
    const blocks = [];

    const top = el("div", "", "display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:6px;");
    top.append(el("h3", heading, "margin:0; font-size:18px;"), el("span", step, "font-size:13px; opacity:0.8; white-space:nowrap;"));
    host.append(top, el("p", intro, "margin:0 0 14px;"));

    const count = el("span", "", "font-size:13px;");
    const refresh = () => {
      const answered = picks.filter((v) => v !== null).length;
      count.textContent = `${answered} of ${rows.length} answered`;
      count.style.color = INK;
    };

    rows.forEach((row, n) => {
      const block = el("div", "", "margin-bottom:10px; padding:8px 10px; border-radius:6px; border-left:4px solid transparent;");
      block.append(
        ...row.lines,
        choiceRow(row.count, row.labelFor, (i) => {
          picks[n] = i;
          block.style.borderLeftColor = "transparent";
          block.style.background = "transparent";
          refresh();
        }),
        anchors(row.low, row.high)
      );
      blocks.push(block);
      host.appendChild(block);
    });

    const next = button("Continue", true);
    next.addEventListener("click", () => {
      const open = picks.map((v, n) => (v === null ? n : -1)).filter((n) => n !== -1);
      if (open.length === 0) {
        resolve(picks);
        return;
      }
      for (const n of open) {
        blocks[n].style.borderLeftColor = ALERT;
        blocks[n].style.background = "#fdf1f0";
      }
      count.textContent = open.length === 1 ? "1 item still needs an answer" : `${open.length} items still need an answer`;
      count.style.color = ALERT;
      blocks[open[0]].scrollIntoView({ block: "center", behavior: "smooth" });
    });

    // stays in view while the page scrolls, so progress and the way forward are always visible;
    // the negative margins let it cover the panel's own padding
    const foot = el(
      "div",
      "",
      "position:sticky; bottom:-20px; display:flex; align-items:center; justify-content:flex-end; gap:12px; " +
        "margin:8px -24px -20px; padding:12px 24px; background:white; border-top:1px solid #d5ddd9;"
    );
    foot.append(count, next);
    host.appendChild(foot);
    refresh();
  });
}

function scoreTlx(tlx) {
  const values = items.tlx.items.map((item) => tlx[item.key]);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// odd items are worded positively and even items negatively (Brooke, 1996)
function scoreSus(sus) {
  const sum = sus.reduce((total, v, i) => total + (i % 2 === 0 ? v - 1 : 5 - v), 0);
  return sum * 2.5;
}

// on-screen keys instead of a text field: keystrokes do not reach fields
// mounted over the eEVA scene, and every participant enters the estimate the same way
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
const MAX_CHARS = 6;

function askEstimate(host) {
  return new Promise((resolve) => {
    const { prompt, hint, min, max } = items.estimate;
    host.replaceChildren();
    let text = "";

    const display = el(
      "div",
      "",
      `width:130px; min-height:44px; padding:6px 10px; border:2px solid ${INK}; border-radius:6px; ` +
        "box-sizing:border-box; font-size:24px; text-align:right;"
    );
    display.setAttribute("aria-live", "polite");

    const next = button("Continue", true);
    const valid = () => {
      const v = Number(text);
      return text !== "" && text !== "." && Number.isFinite(v) && v >= min && v <= max;
    };
    const update = () => {
      display.textContent = text;
      next.disabled = !valid();
    };
    next.addEventListener("click", () => {
      if (valid()) resolve(Number(text));
    });

    const pad = el("div", "", "display:grid; grid-template-columns:repeat(3,64px); gap:6px;");
    for (const key of KEYS) {
      const box = el(
        "button",
        key === "back" ? "⌫" : key,
        `min-height:48px; padding:0; border:1px solid ${INK}; border-radius:6px; ` +
          `background:white; color:${INK}; font:inherit; font-size:20px; cursor:pointer;`
      );
      box.type = "button";
      if (key === "back") box.setAttribute("aria-label", "Delete last digit");
      box.addEventListener("mouseenter", () => {
        box.style.background = SOFT;
      });
      box.addEventListener("mouseleave", () => {
        box.style.background = "white";
      });
      box.addEventListener("click", () => {
        if (key === "back") text = text.slice(0, -1);
        else if (!(key === "." && text.includes(".")) && text.length < MAX_CHARS) text += key;
        update();
      });
      pad.appendChild(box);
    }

    const reading = el("div", "", "display:flex; align-items:center; gap:8px;");
    reading.append(display, el("span", "seconds"));
    const side = el("div", "", "display:flex; flex-direction:column; align-items:flex-start; gap:16px;");
    side.append(reading, next);
    const body = el("div", "", "display:flex; align-items:flex-start; gap:24px; margin-top:12px;");
    body.append(pad, side);

    host.append(
      el("p", prompt, "margin:0; font-weight:600;"),
      el("p", hint, "margin:4px 0 0; font-size:13px; opacity:0.8;"),
      body
    );
    update();
  });
}

// A short scale shows its numbers. A long one stays unlabelled, like the marks on the
// paper form, because numbers in that many boxes cannot be read.
const MAX_NUMBERED_STEPS = 11;
function tlxLabel(i) {
  return items.tlx.steps <= MAX_NUMBERED_STEPS ? String(i + 1) : "";
}

// Three pages (workload, usability, willingness to continue), so none needs much scrolling.
// TLX answers are stored on 0 to 100 whatever the number of steps, so scores from forms
// with different step counts stay on one scale.
// Resolves with flat keys (tlx_mental ... tlx_raw, sus_1 ... sus_score, continue_willingness)
// ready for metrics.record.
async function askConditionQuestionnaire(host, title) {
  const tlxPicks = await askPage(
    host,
    title,
    items.tlx.intro,
    items.tlx.items.map((item) => ({
      lines: [el("div", item.label, "font-weight:600;"), el("div", item.question, "margin-bottom:6px;")],
      count: items.tlx.steps,
      labelFor: tlxLabel,
      low: item.low,
      high: item.high,
    })),
    "Part 1 of 3"
  );
  const susPicks = await askPage(
    host,
    title,
    items.sus.intro,
    items.sus.items.map((statement, n) => ({
      lines: [el("div", `${n + 1}. ${statement}`, "margin-bottom:6px;")],
      count: 5,
      labelFor: (i) => String(i + 1),
      low: items.sus.low,
      high: items.sus.high,
    })),
    "Part 2 of 3"
  );
  const [continuePick] = await askPage(
    host,
    title,
    items.continue.intro,
    [
      {
        lines: [el("div", items.continue.question, "margin-bottom:6px;")],
        count: items.continue.steps,
        labelFor: (i) => String(i + 1),
        low: items.continue.low,
        high: items.continue.high,
      },
    ],
    "Part 3 of 3"
  );

  const result = {};
  const tlx = {};
  items.tlx.items.forEach((item, n) => {
    tlx[item.key] = Math.round((tlxPicks[n] * 100) / (items.tlx.steps - 1));
    result[`tlx_${item.key}`] = tlx[item.key];
  });
  result.tlx_raw = Number(scoreTlx(tlx).toFixed(2));
  const sus = susPicks.map((i) => i + 1);
  sus.forEach((value, i) => {
    result[`sus_${i + 1}`] = value;
  });
  result.sus_score = scoreSus(sus);
  result.continue_willingness = continuePick + 1;
  return result;
}

module.exports = { askEstimate, askConditionQuestionnaire, tlxSteps: items.tlx.steps };
