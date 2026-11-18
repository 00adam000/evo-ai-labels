import { LEVELS, levelFor } from "./labels.js";
import { getExplanation, getAnswer } from "./explain-service.js";
import { loadSettings, saveSetting, prefillFromLocalConfig } from "./settings.js";
import { DEFAULT_MODEL, MAX_QUESTION_LENGTH } from "./llm.js";
import { CHIPS } from "./explainer.js";

const feedEl = document.getElementById("feed");

const FOOTER = {
  mock: "Explanation built from the provenance record (offline mode).",
  llm: "Written by AI from the provenance record only. Checked before display.",
};

const ANSWER_FOOTER = {
  mock: "From the provenance record (offline mode).",
  llm: "AI answer from the provenance record only. Checked before display.",
};

// Each question can trigger an API call, so asking is capped per post.
const MAX_QUESTIONS = 5;

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
  const ask = buildAsk(post);
  panel.reload = () => loadExplanation(post, info, panel, ask);

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

/** Builds the "Ask about this image" section. It lives as long as the post, so answers survive panel reloads. */
function buildAsk(post) {
  let asked = 0;
  let busy = false;

  const chips = CHIPS.map((c) => el("button", { type: "button", class: "chip" }, c.text));
  const input = el("input", {
    type: "text",
    maxlength: String(MAX_QUESTION_LENGTH),
    placeholder: "Ask about the record…",
    "aria-label": "Your question about this image",
    autocomplete: "off",
  });
  const askBtn = el("button", { type: "submit", class: "ask-btn" }, "Ask");
  const form = el("form", { class: "ask-form" }, input, askBtn);
  const offlineNote = el("p", { class: "ask-note" }, "Typed questions need AI mode");
  const limitNote = el("p", { class: "ask-note", role: "status" }, "Question limit reached for this post");
  const qaList = el("ol", { class: "qa-list", "aria-live": "polite" });
  const section = el("div", { class: "ask" },
    el("h3", {}, "Ask about this image"),
    el("div", { class: "chips" }, ...chips),
    form, offlineNote, limitNote, qaList);

  function refresh() {
    const aiMode = loadSettings().mode === "ai";
    const full = asked >= MAX_QUESTIONS;
    form.hidden = !aiMode;
    offlineNote.hidden = aiMode;
    limitNote.hidden = !full;
    for (const c of [...chips, input, askBtn]) c.disabled = busy || full;
  }

  async function ask(question, label) {
    if (busy || asked >= MAX_QUESTIONS) return;
    asked++;
    busy = true;
    refresh();

    const pending = el("p", { class: "qa-loading" }, "Checking the record…");
    const item = el("li", { "aria-busy": "true" }, el("p", { class: "qa-q" }, label), pending);
    qaList.append(item);

    let out;
    try {
      out = await getAnswer(post, question, loadSettings());
    } catch (err) {
      out = { result: null, notice: `Answer could not be loaded (${err.message}).` };
    }
    const parts = [];
    if (out.notice) parts.push(el("p", { class: "explain-notice", role: "status" }, out.notice));
    if (out.result) {
      parts.push(el("p", { class: "qa-a" }, out.result.answer),
        el("p", { class: "qa-meta" }, ANSWER_FOOTER[out.result.source]));
    }
    pending.replaceWith(...parts);
    item.removeAttribute("aria-busy");

    busy = false;
    refresh();
    if (!input.disabled && !form.hidden && question.text) input.focus();
  }

  chips.forEach((btn, i) => btn.addEventListener("click", () => ask({ chip: CHIPS[i].id }, CHIPS[i].text)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    ask({ text }, text);
  });

  section.refresh = refresh;
  refresh();
  return section;
}

async function loadExplanation(post, info, panel, ask) {
  const settings = loadSettings();
  const ticket = (panel.ticket = (panel.ticket || 0) + 1); // a newer request replaces this one's result
  const levelLine = el("p", { class: "explain-level" }, `Label: ${info.text}`);

  if (settings.mode === "ai") {
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(levelLine, el("p", { class: "explain-loading" }, "Generating explanation…"), ask);
    ask.refresh();
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
  panel.replaceChildren(...children, ask);
  panel.removeAttribute("aria-busy");
  ask.refresh();
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
