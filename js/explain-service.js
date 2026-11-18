// Chooses where an explanation or follow-up answer comes from and makes sure
// it passes the validator before display. In AI mode, any failure (service error or failed
// safety checks) falls back to the offline explanation with a visible notice,
// so the user always gets an answer and knows its source.

import { mockExplain, mockAnswer, CHIPS } from "./explainer.js";
import { llmExplain, llmAnswer, DEFAULT_MODEL, MAX_QUESTION_LENGTH } from "./llm.js";
import { validateExplanation, validateAnswer } from "./schema.js";

const OFFLINE_SUFFIX = "so this is the offline explanation.";
const OFFLINE_ANSWER_SUFFIX = "so this is the offline answer.";
const cache = new Map();

export function clearExplanationCache() {
  cache.clear();
}

function serviceFailure(err) {
  const reason = err.reason || "error";
  const what = reason === "no tool_use block" || reason === "unreadable response"
    ? "AI response could not be used" : "AI service unavailable";
  return { reason, what };
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
    const { reason, what } = serviceFailure(err);
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

function offlineAnswer(post, chip, notice = null) {
  const result = mockAnswer(post, chip);
  const check = validateAnswer(result, post, { chip });
  if (!check.ok) {
    return { result: null, notice: `Answer failed safety checks (${check.errors[0]}) and is not shown.` };
  }
  return { result, notice };
}

const typedFailure = (reason) => ({
  result: null,
  notice: `Couldn't get a checked answer (${reason}). Try one of the suggested questions.`,
});

async function answerFromLlm(post, question, settings) {
  const { chip } = question;
  const text = chip ? CHIPS.find((c) => c.id === chip).text : question.text.trim();
  const fail = (reason, chipNotice) => (chip ? offlineAnswer(post, chip, chipNotice) : typedFailure(reason));

  if (!settings.apiKey) {
    return { value: fail("no API key", `AI mode needs an API key (add one in Settings), ${OFFLINE_ANSWER_SUFFIX}`), cacheable: false };
  }
  let result;
  try {
    result = await llmAnswer(post, text, {
      apiKey: settings.apiKey,
      model: settings.model || DEFAULT_MODEL,
      ...(settings.fetchImpl && { fetchImpl: settings.fetchImpl }),
      ...(settings.timeoutMs && { timeoutMs: settings.timeoutMs }),
    });
  } catch (err) {
    const { reason, what } = serviceFailure(err);
    return { value: fail(reason, `${what} (${reason}), ${OFFLINE_ANSWER_SUFFIX}`), cacheable: false };
  }

  const check = validateAnswer(result, post, { chip });
  if (!check.ok) {
    const reason = `failed safety checks: ${check.errors[0]}`;
    return { value: fail(reason, `AI answer failed safety checks (${check.errors[0]}), ${OFFLINE_ANSWER_SUFFIX}`), cacheable: true };
  }
  return { value: { result, notice: null }, cacheable: true };
}

/**
 * Answers a follow-up question, given as { chip } for a suggested question or
 * { text } for a typed one. Chip answers fall back to the offline answer and
 * are cached per post and mode; typed questions need AI mode and are never cached.
 */
export async function getAnswer(post, question, settings = {}) {
  const mode = settings.mode === "ai" ? "ai" : "offline";
  const { chip } = question;

  if (chip) {
    if (!CHIPS.some((c) => c.id === chip)) return { result: null, notice: `Unknown question: ${chip}` };
  } else {
    const text = typeof question.text === "string" ? question.text.trim() : "";
    if (!text) return { result: null, notice: "Type a question first." };
    if (text.length > MAX_QUESTION_LENGTH) return { result: null, notice: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` };
    if (mode === "offline") return { result: null, notice: "Typed questions need AI mode." };
  }

  const key = chip && (mode === "ai" ? `${post.id}|answer|${chip}|ai|${settings.model || DEFAULT_MODEL}` : `${post.id}|answer|${chip}|offline`);
  if (key && cache.has(key)) return cache.get(key);

  if (mode === "offline") {
    const value = offlineAnswer(post, chip);
    cache.set(key, value);
    return value;
  }
  const { value, cacheable } = await answerFromLlm(post, question, settings);
  if (key && cacheable) cache.set(key, value);
  return value;
}
