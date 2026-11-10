// Keeps one record per session, with one entry per trial, and copies it to this browser's
// storage after every change. A session that is stopped, or a page that is closed, then still
// leaves its finished trials on the computer that ran it. Nothing is sent anywhere.

const STORE_KEY = "waiting-interface-sessions";

// storage can be unavailable or full; the session must run either way
function readAll() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    return false;
  }
}

function save(session) {
  const list = readAll();
  const at = list.findIndex((other) => other.session_id === session.session_id);
  if (at === -1) list.push(session);
  else list[at] = session;
  return writeAll(list);
}

function removeAll() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    // nothing was stored, so there is nothing to remove
  }
}

function participantCode(participantId) {
  return "P" + String(participantId).padStart(2, "0");
}

// local time, in a form that is safe in a file name and sorts by date
function stamp(date) {
  const two = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) +
    "-" + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds())
  );
}

// settings is stored with the data because the delay and filler choices decide what
// the numbers mean
function create(participantId, order, settings) {
  const now = new Date();
  const code = participantCode(participantId);
  const session = {
    session_id: code + "_" + stamp(now),
    participant: code,
    participant_id: participantId,
    started_at: now.toISOString(),
    ended_at: null,
    completed_all: false,
    order,
    settings,
    trials: [],
  };
  save(session);
  return session;
}

function finish(session) {
  session.ended_at = new Date().toISOString();
  session.completed_all = true;
  return save(session);
}

function fileName(sessions) {
  if (sessions.length === 1) return sessions[0].session_id + ".json";
  return "waiting-sessions_" + stamp(new Date()) + ".json";
}

function toText(sessions) {
  return JSON.stringify(sessions, null, 2);
}

function download(sessions) {
  const url = URL.createObjectURL(new Blob([toText(sessions)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(sessions);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // the browser needs the address for a moment after the click
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

module.exports = { create, save, finish, readAll, removeAll, toText, fileName, download };
