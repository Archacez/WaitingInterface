const items = require("./questionnaire.json");

const INK = "#183322";

function el(tag, text, css) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (css) node.style.cssText = css;
  return node;
}

function button(label, primary) {
  const node = el("button", label);
  node.type = "button";
  node.className = primary ? "button button-primary" : "button button-secondary";
  return node;
}

// boxes instead of a slider, so no answer starts preselected and the TLX
// scale keeps the 21 marks of the paper form
function choiceRow(count, labelFor, onPick) {
  const row = el("div", "", `display:grid; grid-template-columns:repeat(${count},1fr); gap:3px;`);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const box = el(
      "button",
      labelFor(i),
      `min-height:28px; padding:0; border:1px solid ${INK}; border-radius:4px; ` +
        `background:white; color:${INK}; font:inherit; cursor:pointer;`
    );
    box.type = "button";
    box.setAttribute("aria-pressed", "false");
    box.addEventListener("click", () => {
      boxes.forEach((other, j) => {
        const on = j === i;
        other.style.background = on ? INK : "white";
        other.style.color = on ? "white" : INK;
        other.setAttribute("aria-pressed", String(on));
      });
      onPick(i);
    });
    boxes.push(box);
    row.appendChild(box);
  }
  return row;
}

function anchors(low, high) {
  const row = el("div", "", "display:flex; justify-content:space-between; font-size:13px; opacity:0.8; margin-top:2px;");
  row.append(el("span", low), el("span", high));
  return row;
}

function footer(total, onSubmit) {
  const wrap = el("div", "", "display:flex; align-items:center; justify-content:flex-end; gap:12px; margin-top:16px;");
  const count = el("span", "", "font-size:13px;");
  const next = button("Continue", true);
  next.addEventListener("click", onSubmit);
  wrap.append(count, next);
  const update = (answered) => {
    count.textContent = `${answered} of ${total} answered`;
    next.disabled = answered < total;
  };
  update(0);
  return { wrap, update };
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
      `width:120px; min-height:36px; padding:6px 8px; border:1px solid ${INK}; border-radius:4px; ` +
        "box-sizing:border-box; font-size:20px; text-align:right;"
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

    const pad = el("div", "", "display:grid; grid-template-columns:repeat(3,56px); gap:4px;");
    for (const key of KEYS) {
      const box = el(
        "button",
        key === "back" ? "⌫" : key,
        `min-height:40px; padding:0; border:1px solid ${INK}; border-radius:4px; ` +
          `background:white; color:${INK}; font:inherit; font-size:18px; cursor:pointer;`
      );
      box.type = "button";
      if (key === "back") box.setAttribute("aria-label", "Delete last digit");
      box.addEventListener("click", () => {
        if (key === "back") text = text.slice(0, -1);
        else if (!(key === "." && text.includes(".")) && text.length < MAX_CHARS) text += key;
        update();
      });
      pad.appendChild(box);
    }

    const reading = el("div", "", "display:flex; align-items:center; gap:8px;");
    reading.append(display, el("span", "seconds"));
    const side = el("div", "", "display:flex; flex-direction:column; align-items:flex-start; gap:12px;");
    side.append(reading, next);
    const body = el("div", "", "display:flex; align-items:flex-start; gap:16px; margin-top:8px;");
    body.append(pad, side);

    host.append(
      el("p", prompt, "margin:0; font-weight:600;"),
      el("p", hint, "margin:4px 0 0; font-size:13px; opacity:0.8;"),
      body
    );
    update();
  });
}

// resolves with flat keys (tlx_mental ... tlx_raw, sus_1 ... sus_score) ready for metrics.record
function askConditionQuestionnaire(host, title) {
  return new Promise((resolve) => {
    host.replaceChildren();
    const tlx = {};
    const sus = new Array(items.sus.items.length).fill(null);
    const total = items.tlx.items.length + sus.length;
    const answered = () => Object.keys(tlx).length + sus.filter((v) => v !== null).length;

    const foot = footer(total, () => {
      const result = {};
      for (const item of items.tlx.items) result[`tlx_${item.key}`] = tlx[item.key];
      result.tlx_raw = Number(scoreTlx(tlx).toFixed(2));
      sus.forEach((value, i) => {
        result[`sus_${i + 1}`] = value;
      });
      result.sus_score = scoreSus(sus);
      resolve(result);
    });

    host.append(el("h3", title, "margin:0 0 8px;"), el("p", items.tlx.intro, "margin:0 0 12px;"));
    for (const item of items.tlx.items) {
      const block = el("div", "", "margin-bottom:14px;");
      block.append(
        el("div", item.label, "font-weight:600;"),
        el("div", item.question, "margin-bottom:6px;"),
        choiceRow(items.tlx.steps, () => "", (i) => {
          tlx[item.key] = Math.round((i * 100) / (items.tlx.steps - 1));
          foot.update(answered());
        }),
        anchors(item.low, item.high)
      );
      host.appendChild(block);
    }

    host.appendChild(el("p", items.sus.intro, "margin:20px 0 12px;"));
    items.sus.items.forEach((statement, n) => {
      const block = el("div", "", "margin-bottom:14px;");
      block.append(
        el("div", `${n + 1}. ${statement}`, "margin-bottom:6px;"),
        choiceRow(5, (i) => String(i + 1), (i) => {
          sus[n] = i + 1;
          foot.update(answered());
        }),
        anchors(items.sus.low, items.sus.high)
      );
      host.appendChild(block);
    });

    host.appendChild(foot.wrap);
  });
}

module.exports = { askEstimate, askConditionQuestionnaire };
