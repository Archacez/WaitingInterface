// Serves the local test page and the project's src/ files to this machine only.
// Usage: node test/serve.js [port] [--open]
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const PORT = Number(args.find((arg) => /^\d+$/.test(arg))) || 8765;
const OPEN = args.includes("--open");
const URL_TEXT = `http://127.0.0.1:${PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function openBrowser() {
  const [command, commandArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", URL_TEXT]]
      : process.platform === "darwin" ? ["open", [URL_TEXT]]
      : ["xdg-open", [URL_TEXT]];
  spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
}

function readSources(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base + "/" + entry.name;
    if (entry.isDirectory()) readSources(full, rel, out);
    else if (/\.(js|json)$/.test(entry.name)) out[rel] = fs.readFileSync(full, "utf8");
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  // the project is read fresh on every request, so each Run uses the files as they are now
  if (url.pathname === "/project") {
    try {
      const project = JSON.parse(fs.readFileSync(path.join(ROOT, "project.json"), "utf8"));
      const files = readSources(path.join(ROOT, "src"), "src", {});
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ entry: project.entry, files }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err.message));
    }
    return;
  }

  // only plain file names inside test/ are served, so requests cannot reach other folders
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w-]+\.(html|js|css)$/.test(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  fs.readFile(path.join(__dirname, name), (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(name)], "Cache-Control": "no-store" });
    res.end(data);
  });
});

// a second start while one is already running only reopens the page
server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.log(`Port ${PORT} is already in use; assuming the local test is running at ${URL_TEXT}`);
  if (OPEN) openBrowser();
});

// bound to the loopback address, so the page is not reachable from other machines
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local test running at ${URL_TEXT}  (close this window or press Ctrl+C to stop)`);
  if (OPEN) openBrowser();
});
