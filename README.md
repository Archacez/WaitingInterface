
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

## Platform boundary
This workspace exposes documented eEVA agent, speech, perception, UI, and evaluation helpers. It does not expose production credentials, deployment controls, or the platform source tree.
