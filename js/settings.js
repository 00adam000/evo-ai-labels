// Explanation settings. Everything lives in sessionStorage only, so the API
// key is cleared when the tab closes and is never written to localStorage or
// the repo. Storage can be blocked (private mode, sandbox), so every access is
// wrapped and the app still works with in-memory defaults.

import { DEFAULT_MODEL } from "./llm.js";

const KEYS = { mode: "pf.mode", apiKey: "pf.apiKey", model: "pf.model" };
const memory = { mode: "offline", apiKey: "", model: DEFAULT_MODEL };

function read(name) {
  try {
    const v = sessionStorage.getItem(KEYS[name]);
    if (v !== null) memory[name] = v;
  } catch { /* storage unavailable: keep in-memory value */ }
  return memory[name];
}

function write(name, value) {
  memory[name] = value;
  try {
    if (value) sessionStorage.setItem(KEYS[name], value);
    else sessionStorage.removeItem(KEYS[name]);
  } catch { /* storage unavailable: in-memory only */ }
}

export function loadSettings() {
  return {
    mode: read("mode") === "ai" ? "ai" : "offline",
    apiKey: read("apiKey"),
    model: read("model") || DEFAULT_MODEL,
  };
}

export function saveSetting(name, value) {
  if (!(name in KEYS)) return;
  write(name, value.trim());
}

// Developer convenience: with ?dev in the URL, load the gitignored
// config.local.js from the repo root and use its key if none is set yet.
// Without ?dev no request is made, because the browser logs a 404 for a
// missing file and page code can't suppress that. A missing or broken file
// is ignored. The key's value is never logged.
export async function prefillFromLocalConfig() {
  if (!new URLSearchParams(location.search).has("dev")) return;
  if (loadSettings().apiKey) return;
  try {
    await import("../config.local.js");
  } catch {
    return;
  }
  const key = globalThis.LOCAL_CONFIG?.apiKey;
  if (typeof key === "string" && key.trim()) saveSetting("apiKey", key);
}
