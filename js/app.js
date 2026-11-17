import { LEVELS, levelFor } from "./labels.js";

const feedEl = document.getElementById("feed");

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

  return el("article", { class: "post", id: post.id },
    el("div", { class: "post-head" },
      el("span", { class: "author" }, post.author),
      el("span", { class: "handle" }, post.handle)),
    el("p", { class: "post-text" }, post.text),
    image);
}

async function main() {
  try {
    const posts = await loadPosts();
    feedEl.replaceChildren(...posts.map(renderPost));
  } catch (err) {
    feedEl.replaceChildren(el("p", { class: "error" }, `Feed failed to load: ${err.message}`));
  }
}

main();
