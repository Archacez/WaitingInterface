
# 1.2 – The Waiting Interface

## Research question
How do a progress ring with expected time, verbal filler, and no indicator affect perceived waiting time and frustration during agent delays?

## Runtime contract
- Edit `src/main.js`.
- Export `module.exports.run = async function (context) { ... }`.
- Export `module.exports.stop` when the project starts timers, listening, or webcam capture.
- Use the Helper APIs panel; server keys and the production source tree are not exposed.

## Evaluation
- actual elapsed time
- estimated elapsed time
- estimation error
- perceived responsiveness
- frustration
- completion/abandonment rate


## Required technical contribution
A reusable waiting-state controller that renders timed progress, verbal-only, and silent conditions while logging objective and perceived delay measures.

## Deliverables
- progress-ring condition
- verbal-filler condition
- no-indicator condition
- timing log
- condition comparison

## Session

A session is a short spoken conversation in parts, one part per condition. In each part the participant asks every question of that part's set, in the order they choose: they say the question aloud and press it, wait, and the agent speaks the scripted reply while its text is shown. After the part they estimate the usual wait, then fill in NASA-TLX, SUS and one rating of how willing they would be to keep using the assistant. After the last part they are asked which part they preferred; the answer is stored as the condition that part ran.

Settings in `src/config.json`:

- `maxParticipants`: the highest number offered on the experimenter's setup screen. Numbers past six repeat the orders.
- `condition`: `all` runs the three conditions in one of six orders, chosen by participant number. A condition name runs that one condition only.
- `requestsPerCondition`: questions asked in each part, up to the size of a set in `src/questions.json`.
- `actualDelayMs`, `expectedDelayMs`: the wait before each reply, and the duration the progress indicator is told to expect.
- `fillerTexts`: the fixed list of filler lines, used in turn. `fillerInsideDelay` decides whether the line plays inside the wait or before it.
- `greetingText`: spoken once before the first part, the same in every session.
- `replyMaxMs`: the longest a spoken line may take before the session moves on without it.
- `questionnaires`: `app` asks the wait estimate, NASA-TLX, SUS, the willingness rating and the preference on screen. `external` leaves all of them to a survey on the participant's own device: after each part the screen holds until the participant returns, and the session file then holds the measured waits only. The setup screen starts on this value and can change it for one session; the saved session records which was used.

The NASA-TLX scales use the number of steps set in `src/questionnaire.json`. Answers are stored on 0 to 100 whatever that number is.

## Saving session data

Every recorded value goes to the eEVA metrics logger and, as it is recorded, to a session record in the browser's storage on the computer that ran the session. Nothing is sent anywhere else.

The participant's last screen asks them to tell the experimenter. Its **Experimenter: save data** button opens the data screen:

- **Download file** saves the session as a JSON file named by participant code and start time. Copy, and the text shown on the screen, are there in case the download is blocked.
- **Show all saved sessions** lists every session stored on that computer, including ones that were stopped or whose page was closed before the end. Download then saves them all in one file.
- **Remove saved sessions** needs two presses. Download first.

Stopping during a trial records it as not completed, with the stage it reached.

A filler line that fails, or is still playing when the wait ends, does not stop the session or lengthen the wait. The trial records `filler_error` or `filler_cut_off_ms` in place of `filler_end_ms`, so such trials can be found afterwards.

## From session files to results

Requires Node.js. Put the downloaded files in one folder, then:

```
node tools/sessions-to-csv.js path/to/folder --out trials.csv
node tools/summarize.js path/to/folder
```

The CSV has one row per trial, with times in seconds and the condition names used in the trial log. Its `notes` column lists filler problems. The summary prints the median and range of each measure per condition, then the differences within participants between each pair of conditions.

## Platform boundary
This workspace exposes documented eEVA agent, speech, perception, UI, and evaluation helpers. It does not expose production credentials, deployment controls, or the platform source tree.
