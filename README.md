# Provenance Feed

*README prose word count: TBC (updated at submission)*

A prototype social-media feed that replaces binary "AI-generated" tags with **graded AI-involvement labels**. Each label can be expanded into a plain-language explanation generated only from the post's provenance record. Built for Assignment 2 of Intelligent Interactive Systems (University of Birmingham, 2026). It extends my A1 literature review, *When "Made with AI" Misleads*.

## Project status
- **Implemented:** (in progress)
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
```

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

## AI assistance
<!-- TO BE WRITTEN BY THE AUTHOR -->

## Additional files
None yet.
