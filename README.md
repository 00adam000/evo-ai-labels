# Provenance Feed

A prototype social-media feed with graded AI-involvement labels that expand into checked, plain-language explanations of each image's provenance.

- **Live demo:** https://00adam000.github.io/evo-ai-labels/
- *README prose word count: 901*

Built for Assignment 2 of Intelligent Interactive Systems (University of Birmingham, 2026), extending my A1 literature review, *When "Made with AI" Misleads*.

## Project status
- **Implemented:**
  - Feed of 7 posts with five graded labels: camera original, AI-enhanced, edited with AI, AI-generated, no provenance info.
  - Label explanations in offline mode (fixed rules) and AI mode (LLM).
  - Follow-up questions about each image's provenance.
  - A validator that checks every explanation and answer before display, with an offline fallback and a notice.
- **Simulated:**
  - Hand-written C2PA-style provenance records for the 7 posts.
  - Image placeholders instead of real images.
- **Planned (not built):**
  - Reading real C2PA manifests from image files.
  - A belief rating per post to measure discernment (the A1 proposed study).
  - A small user study comparing graded and binary labels in a partly labelled feed.
  - A server-side proxy so users don't need their own API key.
  - Real images.

## Technology stack
- Plain HTML, CSS and JavaScript. No build step, no dependencies; runs from any static host.
- Anthropic Messages API with `claude-haiku-5-5`, called from the browser (`js/llm.js`). Output is forced through one tool (`give_explanation` / `give_answer`) so it always has the same shape.
- Validator (`js/schema.js`) checks structure, citations, consistency with the rule-based label and wording before anything is shown.
- Offline fallback (`js/explainer.js`) when there is no key, the call fails or a check fails.
- Node test scripts, plus a headless Chromium UI test.

## Running or inspecting the work
- **Live:** https://00adam000.github.io/evo-ai-labels/ (offline mode by default, no key needed).
- **Local:**
  ```bash
  python3 -m http.server 8000
  # open http://localhost:8000
  ```
  This server sends no cache headers, so hard-reload (Ctrl+Shift+R) after pulling changes.
- **AI mode:** open ⚙ settings, choose *AI*, paste your own Anthropic API key. The key is kept in `sessionStorage` only and sent only to `api.anthropic.com`. If anything fails, the offline explanation is shown with a notice saying why.
- **Developers:** put `window.LOCAL_CONFIG = { apiKey: "YOUR_ANTHROPIC_API_KEY" };` in a gitignored `config.local.js` at the repo root and open the page with `?dev`.
- **Tests** (Node 18+, no key or network needed):
  ```bash
  node tests/validate.test.mjs
  node tests/llm.test.mjs
  node tests/answer.test.mjs
  node tests/ui.test.mjs   # headless Chromium; set CHROME=/path/to/chromium if not found
  ```

## Development record
### Stage 1: feed and graded labels (17 Nov 2026)
- Five graded labels instead of a binary "AI-generated" tag, because A1 found binary labels lower trust in true content (Altay and Gilardi, 2024). "No provenance info" is its own label so unlabelled posts don't read as verified (Pennycook et al., 2020).
- The label is decided by fixed rules (`js/labels.js`), never by the LLM, so a model error cannot mislabel a post. It sits on the image, since small labels under images get missed (Wittenberg et al., 2025).
- *Checked:* every post gets its intended label; labels visible in headless Chrome.

### Stage 2: label explanations (17 Nov 2026)
- Each label expands into a panel: summary, "What AI did", "What we don't know", built only from the record. Detail appears only on demand.
- "What we don't know" always says provenance describes the image, not the caption.
- *Checked:* a script confirmed every value in all 7 offline explanations comes from the record or fixed text; panels toggle in headless Chromium with no console errors.

### Stage 3: checking AI output (17 Nov 2026)
- The LLM proposes, the code checks: structure, citations that must exist in the record, and no contradiction of the rule-based label or verdicts on truth.
- *Checked:* `tests/validate.test.mjs` (23/23): offline output passes for all posts, 16 bad outputs each fail with the expected error.

### Stage 4: AI explanations (17 Nov 2026)
- The model sees only the label and the record, never the caption, author or ground truth, so a persuasive caption can't sway it. Output is forced through one tool.
- Any failure (timeout, HTTP error, missing key, failed check) falls back to the offline explanation with a notice saying which.
- *Checked:* `tests/llm.test.mjs` (18/18) with a fake API, including a request-leak test; the key was found only in `sessionStorage`.

### Stage 5: fixes from the first live test (18 Nov 2026)
- **Live failure:** on p2, "What AI did" listed the camera capture as AI, and the shown text contained field names like "(actions[0])". The validator accepted both, because the hand-written test outputs never looked like real model output.
- **Fix:** the prompt lists only AI source types for "What AI did"; the validator now requires a cited AI action per line and rejects field names in shown text.
- *Checked:* the real p2 output is now rejected; `validate` 34/34, `llm` 19/19.

### Stage 6: follow-up questions (18 Nov 2026)
- Three suggested questions, plus typed questions in AI mode (200 characters, five per post). Each is answered from the label and record alone.
- "The record doesn't say" is a valid, checked answer, so the model has no reason to guess. "Is this post true?" must first say provenance shows how the image was made, not whether the caption is true.
- *Checked:* `tests/answer.test.mjs` (58/58), including 16 bad answers rejected and 4 hedged ones accepted.

### Stage 7: second live test (18 Nov 2026)
- **Live failure:** the model cited `label_level`, which the validator didn't accept, so every AI explanation fell back. Fix: one shared list of citation names in `js/schema.js`, used by both prompts and the validator.
- Suggested questions went missing after a fallback (likely a cached old `app.js`); the explanation now renders into its own container. Source type names like "trainedAlgorithmicMedia" in shown text are now rejected.
- *Checked:* `validate` 43/43, `llm` 22/22, `answer` 69/69, `ui` 13/13 across every render path; reintroducing the old bug failed all 13 UI cases.

## AI assistance
<!-- TO BE WRITTEN BY THE AUTHOR -->

## Additional files
None. Report submitted separately on Canvas.
