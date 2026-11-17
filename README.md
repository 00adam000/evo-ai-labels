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
```

## Development record
### Stage 1: feed and graded labels (17 Nov)
- **Five label levels instead of a binary "AI-generated" tag.** A1 found binary labels lower trust in true content because viewers assume full automation (Altay and Gilardi, 2024). The levels are camera original, AI-enhanced, edited with AI, AI-generated, and no provenance info.
- **Label level computed by fixed rules from the provenance record (`js/labels.js`), not by the LLM.** The AI should explain a label, never decide it, so a model error cannot mislabel a post.
- **"No provenance info" shown as its own label, not left blank.** This addresses the implied truth effect (Pennycook et al., 2020): unlabelled posts otherwise read as verified.
- **Label placed on the image with a one-line summary.** A1 notes some participants never saw small labels under images (Wittenberg et al., 2025).
- *Checked:* ran `levelFor` on all 7 posts and confirmed each level appears as intended (p1 captured … p7 enhanced). Rendered the page in headless Chrome to confirm the labels are visible.

## AI assistance
(in progress)

## Additional files
None yet.
