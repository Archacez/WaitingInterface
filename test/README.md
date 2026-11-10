# Local test

Runs the project in a browser without eEVA, for checking screens, flow and recorded values while the platform is unavailable.

## Use

Requires Node.js.

- **Windows:** double-click `test/start.cmd`. It starts the server and opens the page in the default browser; closing its window stops it. Starting it again while it is running only reopens the page.
- **Any system:** from the repository folder, run `node test/serve.js --open` (or without `--open`, then open the address it prints). To use another port, add it as an argument, for example `node test/serve.js 9000`.

Press **Run** on the page. Every Run reads the current `src/` files, so after an edit press Run again.

- **Speed:** Real time (the default) uses the delays in `config.json`; Fast shortens every wait and skips speech time.
- **Condition:** overrides `condition` for that run only; `config.json` is not changed.
- **Read agent lines aloud:** uses a voice installed on this computer. Without one, agent lines are shown and timed but silent.
- **Recorded values and events:** every `metrics.record` call, every agent line, and any error. **Copy recorded values** puts them on the clipboard as JSON.
- **Saved sessions:** sessions run here are kept in this browser's storage, like in eEVA, and appear under Show all saved sessions on the data screen. Remove them there before a study so test data is not mixed with real data.
- **Hide recorded values:** hides that list while a participant uses the page, since it shows the measured wait before the estimate question. Copy recorded values still works.

## Differences from eEVA

The scene, agent, progress indicator and metrics logger are simple stand-ins. Speech, LLM, webcam and biofeedback services are not available and raise an error if called. Check the real agent, the real indicator, timing and eEVA's own logging and export in Project Studio.

The server answers only on this computer (`127.0.0.1`) and serves only `test/` and the project's `.js` and `.json` files.
