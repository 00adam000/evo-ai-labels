import { LEVELS, levelFor } from "./labels.js";
import { getExplanation } from "./explain-service.js";
import { loadSettings, saveSetting, prefillFromLocalConfig } from "./settings.js";
import { DEFAULT_MODEL } from "./llm.js";

const feedEl = document.getElementById("feed");

const FOOTER = {
  mock: "Explanation built from the provenance record (offline mode).",
  llm: "Written by AI from the provenance record only. Checked before display.",
};

// Panels that are open now; they reload when settings change.
const openPanels = new Set();

async function loadPosts() {
  const res = await fetch("data/posts.json");
  if (!res.ok) throw new Error(`Could not load posts (${res.status})`);
  const data = await res.json();
  return data.posts;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function list(items) {
  return el("ul", {}, ...items.map((t) => el("li", {}, t)));
}

function renderPost(post) {
  const level = levelFor(post.provenance);
  const info = LEVELS[level];

  // Image placeholder: the prototype uses no real images, only alt descriptions.
  const image = el("div", { class: "img-placeholder", role: "img", "aria-label": post.image_alt },
    el("span", { class: "ph-tag" }, "image placeholder"),
    el("span", { class: "ph-alt" }, post.image_alt));

  // The label sits on the image, so it is seen together with the content.
  const label = el("button", {
    class: `ai-label ${info.css}`,
    type: "button",
    "data-post": post.id,
    "aria-label": `${info.text}: ${info.short}. Tap for details.`,
  }, el("strong", {}, info.text), el("span", { class: "label-short" }, info.short));
  image.append(label);

  // Explanation panel, hidden until the label is pressed (detail on demand).
  const panel = el("section", {
    class: "explain",
    id: `explain-${post.id}`,
    "aria-label": `Label explanation for ${post.author}'s post`,
  });
  panel.hidden = true;
  panel.reload = () => loadExplanation(post, info, panel);

  label.setAttribute("aria-expanded", "false");
  label.setAttribute("aria-controls", panel.id);
  label.addEventListener("click", () => {
    const open = label.getAttribute("aria-expanded") === "true";
    label.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
    if (open) openPanels.delete(panel);
    else { openPanels.add(panel); panel.reload(); }
  });

  return el("article", { class: "post", id: post.id },
    el("div", { class: "post-head" },
      el("span", { class: "author" }, post.author),
      el("span", { class: "handle" }, post.handle)),
    el("p", { class: "post-text" }, post.text),
    image,
    panel);
}

async function loadExplanation(post, info, panel) {
  const settings = loadSettings();
  const ticket = (panel.ticket = (panel.ticket || 0) + 1); // ignore stale responses
  const levelLine = el("p", { class: "explain-level" }, `Label: ${info.text}`);

  if (settings.mode === "ai") {
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(levelLine, el("p", { class: "explain-loading" }, "Generating explanation…"));
  }

  let out;
  try {
    out = await getExplanation(post, settings);
  } catch (err) {
    out = { result: null, notice: `Explanation could not be loaded (${err.message}).` };
  }
  if (ticket !== panel.ticket) return;

  const { result, notice } = out;
  const children = [levelLine.cloneNode(true)];
  if (notice) children.push(el("p", { class: "explain-notice", role: "status" }, notice));
  if (result) {
    children.push(el("p", { class: "explain-summary" }, result.summary));
    if (result.what_ai_did.length) children.push(el("h3", {}, "What AI did"), list(result.what_ai_did));
    children.push(
      el("h3", {}, "What we don't know"), list(result.what_is_unknown),
      el("p", { class: "explain-foot" }, FOOTER[result.source]));
  }
  panel.replaceChildren(...children);
  panel.removeAttribute("aria-busy");
}

function reloadOpenPanels() {
  for (const panel of openPanels) panel.reload();
}

function setupSettings() {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings-panel");
  const s = loadSettings();

  const modeInputs = panel.querySelectorAll('input[name="mode"]');
  const keyInput = document.getElementById("api-key");
  const modelInput = document.getElementById("model");
  const aiFields = document.getElementById("ai-fields");

  for (const r of modeInputs) r.checked = r.value === s.mode;
  keyInput.value = s.apiKey;
  modelInput.value = s.model;
  modelInput.placeholder = DEFAULT_MODEL;
  aiFields.hidden = s.mode !== "ai";

  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
  });
  for (const r of modeInputs) {
    r.addEventListener("change", () => {
      saveSetting("mode", r.value);
      aiFields.hidden = r.value !== "ai";
      reloadOpenPanels();
    });
  }
  keyInput.addEventListener("change", () => { saveSetting("apiKey", keyInput.value); reloadOpenPanels(); });
  modelInput.addEventListener("change", () => { saveSetting("model", modelInput.value); reloadOpenPanels(); });
}

async function main() {
  await prefillFromLocalConfig();
  setupSettings();
  try {
    const posts = await loadPosts();
    feedEl.replaceChildren(...posts.map(renderPost));
  } catch (err) {
    feedEl.replaceChildren(el("p", { class: "error" }, `Feed failed to load: ${err.message}`));
  }
}

main();
