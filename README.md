# Provenance Feed

*README prose word count: TBC (updated at submission)*

A prototype social-media feed that replaces binary "AI-generated" tags with **graded AI-involvement labels**. Each label can be expanded into a plain-language explanation generated only from the post's provenance record. Built for Assignment 2 of Intelligent Interactive Systems (University of Birmingham, 2026). It extends my A1 literature review, *When "Made with AI" Misleads*.

## Project status
- **Implemented:** social-media feed with graded AI-involvement labels; label explanations in offline and AI modes; a validator that checks every explanation and answer before display; follow-up questions about each image's provenance.
- **Simulated:** provenance records are hand-written, C2PA-style JSON, not read from real files.
- **Planned / unfinished:** (in progress)

## Technology stack
- Plain HTML, CSS and JavaScript. No build step and no dependencies, so it runs from any static host (e.g. GitHub Pages).
- AI component: label explanations from the Anthropic Messages API (default model `claude-haiku-5-5`), called from the browser (`js/llm.js`). Output is forced through a single tool (`give_explanation`) so it always has the same shape. The validator (`js/schema.js`) checks every explanation before display. If the call fails or the output fails a check, the offline explainer (`js/explainer.js`) is shown instead, with a notice.

## Running or inspecting the work
```bash
# any static server, e.g.
python3 -m http.server 8000
# then open http://localhost:8000

# tests (Node 18+, no dependencies, no API key or network needed)
node tests/validate.test.mjs
node tests/llm.test.mjs
node tests/answer.test.mjs
node tests/ui.test.mjs   # headless Chromium; set CHROME=/path/to/chromium if it isn't found
```

`python3 -m http.server` sends no `Cache-Control` header, so after pulling changes the browser may keep running old JS modules. Hard-reload (Ctrl+Shift+R) before testing.

**Offline mode** is the default and needs no key: explanations are built by fixed rules from the provenance record.

**AI mode (optional):** open the ⚙ settings in the top bar, choose *AI*, and paste your own Anthropic API key. The key is kept in `sessionStorage` only, so it is cleared when the tab closes. It is never written to `localStorage` or the repo, and it is sent only to `api.anthropic.com`. The model field defaults to `claude-haiku-5-5`. If the key is missing or wrong, or the AI output fails a check, the panel shows the offline explanation and a notice saying why.

**Developers** can instead put their key in a gitignored `config.local.js` at the repo root, containing `window.LOCAL_CONFIG = { apiKey: "YOUR_ANTHROPIC_API_KEY" };`, and open the page with `?dev` (e.g. `http://localhost:8000/?dev`). The key is copied into `sessionStorage` only if no key is set there yet. **Reviewers** can just paste a key in settings.

## Development record
### Stage 1: feed and graded labels (17 Nov)
- **Five label levels instead of a binary "AI-generated" tag.** A1 found binary labels lower trust in true content because viewers assume full automation (Altay and Gilardi, 2024). The levels are camera original, AI-enhanced, edited with AI, AI-generated, and no provenance info.
- **Label level computed by fixed rules from the provenance record (`js/labels.js`), not by the LLM.** The AI should explain a label, never decide it, so a model error cannot mislabel a post.
- **"No provenance info" shown as its own label, not left blank.** This addresses the implied truth effect (Pennycook et al., 2020): unlabelled posts otherwise read as verified.
- **Label placed on the image with a one-line summary.** A1 notes some participants never saw small labels under images (Wittenberg et al., 2025).
- *Checked:* ran `levelFor` on all 7 posts and confirmed each level appears as intended (p1 captured … p7 enhanced). Rendered the page in headless Chrome to confirm the labels are visible.

### Stage 2: label explanations (17 Nov 2026)
- **Each label now expands into an explanation panel** (`js/explainer.js`, `js/app.js`): summary, "What AI did" and "What we don't know". It is built only from fields in the provenance record. The short label stays on the image and the detail appears only on demand, which keeps the default view light on cognitive load.
- **"What we don't know" is always shown.** It says that provenance describes the image, not the caption, so "camera original" is not read as "the claim is true". It also flags unverified signers.
- **Offline (mock) explainer first.** It runs without an API key and becomes the fallback when the LLM explainer is added.
- *Checked:* ran `mockExplain` on all 7 posts with Node. A script confirmed that every value in each output comes from the record or from fixed template text. Served the site and clicked every label in headless Chromium: each panel toggles, `aria-expanded` updates, and there were no console errors.

### Stage 3: checking AI output (17 Nov 2026)
- **The LLM proposes and the code checks before anything is shown.** `validateExplanation` (`js/schema.js`) checks the structure: required keys only, length limits, and `source` set to `mock` or `llm`. Any output that fails is not displayed.
- **Grounding:** every entry in `cited_fields` must exist in the post's provenance record, and each "What AI did" line needs at least one cited `actions[i]`. This makes invented details detectable.
- **Consistency with the rule-based label:** the explanation can't contradict the label from `levelFor`. Examples: AI actions on a camera original or a post with no record, "camera" in an AI-generated summary, or a missing "no label does not mean verified" warning are all rejected. The summary also can't call the claim true, false, fake, genuine or accurate, because provenance can't establish that.
- *Checked:* `tests/validate.test.mjs` confirms that mock output passes for all 7 posts and that 16 hand-made bad outputs each fail with the expected error (23/23 pass).

### Stage 4: AI explanations (17 Nov 2026)
- **The model sees only the rule-based label and the provenance record.** It never sees the caption, author or ground truth. This keeps it grounded in what the record shows, and a persuasive caption can't sway it.
- **Structured output is forced through a single tool (`give_explanation`)** with a fixed schema. This sets the boundary between model and system: the model returns a predictable shape and the code checks it (Stage 3) before display. `temperature` is left out because `claude-haiku-5-5` rejects any non-default value; the forced tool and the validator provide the consistency instead.
- **If anything fails, the panel falls back to the offline explanation with a visible notice.** Failures include a timeout, an HTTP error, a missing key or failed safety checks, and the notice says which one, e.g. "AI explanation failed safety checks (…), so this is the offline explanation." The user always gets an answer and knows where it came from, which keeps the system transparent and gives feedback when the AI is not used.
- *Checked:* `tests/llm.test.mjs` (18/18 pass) uses a fake `fetch` to cover a valid response, a citation to `actions[9]`, a "fake" summary, HTTP 401, a timeout, a network error and a missing tool call. It also checks that the request contains no caption, author or ground truth for any of the 7 posts and that it forces `give_explanation`. A deliberately leaky request made the leak test fail, as it should. In headless Chromium, offline mode, AI mode (with the API intercepted) and the fallback notice all rendered with no console errors, and the key was found only in `sessionStorage`.

### Stage 5: fixes from the first live test (18 Nov 2026)
- **The first run with a real key showed two problems.** It used `claude-haiku-5-5` on post p2 ("City Life Daily"). First, "What AI did" included the camera capture step, which is not AI: "Created the image as a digital camera capture using a DSLR camera (actions[0])". Second, the text shown to users contained internal field names such as "(actions[0])" and "(actions[1])". The validator accepted both.
- **The fake-response tests missed this because they used hand-written outputs, not the model's.** Those outputs were written to be either clean or broken in one known way, so none looked like what the model actually wrote. The old grounding check also only asked for some cited `actions[i]`, and the camera capture action was enough to pass it.
- **Fix: the prompt tells the model and the validator enforces it.** The prompt now says "What AI did" lists only actions whose `digitalSourceType` is AI (enhanced, composite or generated), one line per action, and that field names go only in `cited_fields`. `validateExplanation` now rejects more "What AI did" lines than the record has AI actions, requires at least one cited action to be an AI action, and rejects user-facing text containing `actions[`, `cited_fields`, `digitalSourceType` or `{`. *Checked:* `tests/validate.test.mjs` (34/34 pass) reproduces the live p2 output and confirms it is rejected for both problems, and all 7 offline explanations still pass. `tests/llm.test.mjs` (19/19 pass) confirms that a response with "(actions[1])" in its text falls back with a safety-check notice.

### Stage 6: follow-up questions (18 Nov 2026)
- **Readers can ask about an image from the explanation panel.** Three suggested questions are always available, and AI mode also accepts a typed question of up to 200 characters, with a limit of five questions per post. Each question is answered from the label level and the provenance record alone, with no caption, author or earlier questions and answers. The answer can then only be grounded in the record, and keeping the context to the minimum leaves the model nothing else to draw on.
- **"The record doesn't say" is a valid answer, and it is checked.** An answer marked as not answerable must say plainly that the record lacks the information and must cite nothing. An answerable one must cite at least one field that exists in the record. The model has a correct option when the record is silent, so it has no reason to guess, and a guess with no support in the record is rejected.
- **The "Is this post true?" question exists because of the mental-model problem from A1:** people read provenance as a verdict on truth. The answer must first say that provenance shows how the image was made, not whether the caption is true, and then say what the record does show. The validator rejects any answer that calls the post true, false, fake, real, genuine or accurate, but allows hedged wording such as "doesn't show whether the caption is true".
- *Checked:* `tests/answer.test.mjs` (58/58 pass) confirms that the offline answers for all 7 posts and 3 questions pass the validator, that 16 bad answers are rejected and 4 hedged ones accepted, that the request contains no caption, author or ground truth and forces `give_answer`, and that a typed question the record can't answer ("What camera settings were used?") is shown as answerable=false. In headless Chromium, the offline answers for p2, p4 and p5 rendered, the five-question limit applied, and there were no console errors.

### Stage 7: second live test (18 Nov 2026)
- **A check that was too strict made AI mode useless.** The model cited `label_level`, which is part of its input and decided by fixed rules. The validator accepted only record fields, so every AI explanation was rejected and replaced by the offline one. The fix puts the allowed citation names (`label_level`, `signer`, `signed`, `claim_generator`, `actions[i]`) in a single list in `js/schema.js`. Both prompts are built from that list, so the model is told exactly what the validator accepts, and any other name such as `caption` is still rejected.
- **The suggested questions were missing after a fallback.** The current code could not reproduce this in any render path. The most likely cause is that the browser was running a cached pre-Stage-6 `app.js`. The explanation now renders into its own container next to the questions section, so no render path can remove it. A new headless test covers every path. The README also notes that a hard reload is needed after changes.
- **The text shown to users contained source type names such as "(trainedAlgorithmicMedia)".** All four `digitalSourceType` values and `label_level` are now on the validator's internal-text list for explanations and answers. Both prompts also ask for plain words such as "created by AI".
- *Checked:* `tests/validate.test.mjs` (43/43), `tests/llm.test.mjs` (22/22) and `tests/answer.test.mjs` (69/69) cover the following: explanations and answers that cite `label_level` pass, `caption` fails, each source type name is rejected, and both prompts list the same citation names as the validator. `tests/ui.test.mjs` (13/13) uses a fake API in headless Chromium to confirm that the questions appear after every render path: offline, success, safety-check fallback, HTTP 500, network error, missing key, and switching to AI with the panel open. Putting the old bug back made all 13 cases fail.

## AI assistance
<!-- TO BE WRITTEN BY THE AUTHOR -->

## Additional files
None yet.
