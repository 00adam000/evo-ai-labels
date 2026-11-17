# Provenance Feed

*README prose word count: TBC (updated at submission)*

A prototype social-media feed that replaces binary "AI-generated" tags with **graded AI-involvement labels**. Each label can be expanded into a plain-language explanation generated only from the post's provenance record. Built for Assignment 2 of Intelligent Interactive Systems (University of Birmingham, 2026). It extends my A1 literature review, *When "Made with AI" Misleads*.

## Project status
- **Implemented:** (in progress)
- **Simulated:** provenance records are hand-written, C2PA-style JSON, not read from real files.
- **Planned / unfinished:** (in progress)

## Technology stack
- Plain HTML, CSS and JavaScript. No build step and no dependencies, so it runs from any static host (e.g. GitHub Pages).
- AI component: (in progress)

## Running or inspecting the work
```bash
# any static server, e.g.
python3 -m http.server 8000
# then open http://localhost:8000

# check the explanation validator (Node 18+, no dependencies)
node tests/validate.test.mjs
```

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

## AI assistance
<!-- TO BE WRITTEN BY THE AUTHOR -->

## Additional files
None yet.
