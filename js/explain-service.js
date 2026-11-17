// Chooses where an explanation comes from and makes sure it passes the
// validator before display. In AI mode, any failure (service error or failed
// safety checks) falls back to the offline explanation with a visible notice,
// so the user always gets an answer and knows its source.

import { mockExplain } from "./explainer.js";
import { llmExplain, DEFAULT_MODEL } from "./llm.js";
import { validateExplanation } from "./schema.js";

const OFFLINE_SUFFIX = "so this is the offline explanation.";
const cache = new Map();

export function clearExplanationCache() {
  cache.clear();
}

// Offline result, still checked. If even this fails, nothing is shown.
function offline(post, notice = null) {
  const result = mockExplain(post);
  const check = validateExplanation(result, post);
  if (!check.ok) {
    return { result: null, notice: `Explanation failed safety checks (${check.errors[0]}) and is not shown.` };
  }
  return { result, notice };
}

async function fromLlm(post, settings) {
  if (!settings.apiKey) {
    return { value: offline(post, `AI mode needs an API key (add one in Settings), ${OFFLINE_SUFFIX}`), cacheable: false };
  }
  let result;
  try {
    result = await llmExplain(post, {
      apiKey: settings.apiKey,
      model: settings.model || DEFAULT_MODEL,
      ...(settings.fetchImpl && { fetchImpl: settings.fetchImpl }),
      ...(settings.timeoutMs && { timeoutMs: settings.timeoutMs }),
    });
  } catch (err) {
    // Service errors may be temporary, so they are not cached: the next open retries.
    const reason = err.reason || "error";
    const what = reason === "no tool_use block" || reason === "unreadable response"
      ? "AI response could not be used" : "AI service unavailable";
    return { value: offline(post, `${what} (${reason}), ${OFFLINE_SUFFIX}`), cacheable: false };
  }

  const check = validateExplanation(result, post);
  if (!check.ok) {
    return { value: offline(post, `AI explanation failed safety checks (${check.errors[0]}), ${OFFLINE_SUFFIX}`), cacheable: true };
  }
  return { value: { result, notice: null }, cacheable: true };
}

export async function getExplanation(post, settings = {}) {
  const mode = settings.mode === "ai" ? "ai" : "offline";
  const key = mode === "ai" ? `${post.id}|ai|${settings.model || DEFAULT_MODEL}` : `${post.id}|offline`;
  if (cache.has(key)) return cache.get(key);

  if (mode === "offline") {
    const value = offline(post);
    cache.set(key, value);
    return value;
  }
  const { value, cacheable } = await fromLlm(post, settings);
  if (cacheable) cache.set(key, value);
  return value;
}
