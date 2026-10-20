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

function askEstimate(host) {
  return new Promise((resolve) => {
    const { prompt, hint, min, max } = items.estimate;
    host.replaceChildren();

    const input = el("input", "", "width:120px; padding:6px 8px; font:inherit;");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "any";
    input.inputMode = "decimal";

    const next = button("Continue", true);
    next.disabled = true;

    const valid = () => {
      const v = Number(input.value);
      return input.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max;
    };
    const submit = () => {
      if (valid()) resolve(Number(input.value));
    };
    input.addEventListener("input", () => {
      next.disabled = !valid();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    next.addEventListener("click", submit);

    const row = el("div", "", "display:flex; align-items:center; gap:8px; margin-top:8px;");
    row.append(input, el("span", "seconds"), next);
    host.append(
      el("p", prompt, "margin:0; font-weight:600;"),
      el("p", hint, "margin:4px 0 0; font-size:13px; opacity:0.8;"),
      row
    );
    // the host is mounted after this returns, so focus has to wait a tick
    setTimeout(() => input.focus(), 0);
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
