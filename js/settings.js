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

// For development: with ?dev in the URL, use the key from the gitignored
// config.local.js if no key is set yet. The file is only requested with ?dev,
// since a missing file logs a 404 in the console that page code can't hide.
// A missing or broken file is ignored, and the key is never logged.
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
