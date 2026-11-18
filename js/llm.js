// LLM explainer: asks Claude (Anthropic Messages API, called directly from the
// browser) to explain a label. The model sees ONLY the rule-based label level
// and the provenance record: never the caption, author or ground truth, so a
// persuasive caption can't sway it. Output is forced through a single tool so
// it has a fixed shape that js/schema.js can check before anything is shown.

import { LEVELS, levelFor } from "./labels.js";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-haiku-5-5";
export const TIMEOUT_MS = 15000;

export const EXPLANATION_TOOL = {
  name: "give_explanation",
  description: "Return the plain-language explanation of this post's AI label.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "At most 2 sentences." },
      what_ai_did: { type: "array", items: { type: "string" }, description: "One line per action whose digitalSourceType is algorithmicallyEnhanced, compositeWithTrainedAlgorithmicMedia or trainedAlgorithmicMedia. Never camera capture or manual edits. Empty if none." },
      what_is_unknown: { type: "array", items: { type: "string" } },
      cited_fields: { type: "array", items: { type: "string" }, description: 'Record fields used, e.g. "signer", "actions[1]".' },
    },
    required: ["summary", "what_ai_did", "what_is_unknown", "cited_fields"],
    additionalProperties: false,
  },
};

export const SYSTEM_PROMPT = `You explain AI-involvement labels on social media images to a general reader.
Rules:
1. Use ONLY the provenance JSON you are given. Never add facts that are not in it.
2. Cite every field you use in cited_fields, as "signer", "signed", "claim_generator" or "actions[i]" (i is the index in the actions array).
3. The label level has already been decided by fixed rules. Never contradict it.
4. Never say whether the post's claim is true or false, real or fake. Provenance cannot show that.
5. what_is_unknown must always include that provenance describes the image, not the caption.
6. If the provenance is null: what_ai_did must be empty, cited_fields must be empty, and what_is_unknown must say that having no label does not mean the post is verified or real.
7. Plain English, no jargon. The summary is at most 2 sentences.
8. what_ai_did lists ONLY actions whose digitalSourceType is algorithmicallyEnhanced, compositeWithTrainedAlgorithmicMedia or trainedAlgorithmicMedia, one item per such action. Never include camera capture (digitalCapture) or manual edits (no digitalSourceType). If there are no such actions, what_ai_did is empty.
9. Never write field names or brackets such as "actions[0]", "cited_fields" or "digitalSourceType" in summary, what_ai_did or what_is_unknown. Citations go only in cited_fields.
Answer by calling give_explanation.`;

// A failure with a short reason the UI can show, e.g. "timeout" or "HTTP 401".
export class LlmError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = "LlmError";
    this.reason = reason;
  }
}

// The user message holds only the label level and the record.
export function buildUserMessage(post) {
  const level = levelFor(post.provenance);
  return JSON.stringify({
    label_level: LEVELS[level].text,
    provenance: post.provenance ?? null,
  }, null, 2);
}

export function buildRequestBody(post, model = DEFAULT_MODEL) {
  // No temperature: claude-haiku-5-5 returns HTTP 400 for any non-default value.
  // The forced tool and the validator keep the output predictable instead.
  return {
    model,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    tools: [EXPLANATION_TOOL],
    tool_choice: { type: "tool", name: EXPLANATION_TOOL.name },
    messages: [{ role: "user", content: buildUserMessage(post) }],
  };
}

export async function llmExplain(post, {
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!apiKey) throw new LlmError("no API key");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(buildRequestBody(post, model || DEFAULT_MODEL)),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new LlmError("timeout", `No response within ${timeoutMs / 1000} s`);
    throw new LlmError("network error", `Could not reach the Anthropic API: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* error body was not JSON; report the status only */ }
    throw new LlmError(`HTTP ${res.status}`, `Anthropic API returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  let data;
  try { data = await res.json(); } catch { throw new LlmError("unreadable response", "Response was not valid JSON"); }

  const block = Array.isArray(data?.content)
    ? data.content.find((b) => b.type === "tool_use" && b.name === EXPLANATION_TOOL.name)
    : undefined;
  if (!block || typeof block.input !== "object" || block.input === null) {
    throw new LlmError("no tool_use block", `Response had no ${EXPLANATION_TOOL.name} call (stop_reason: ${data?.stop_reason ?? "unknown"})`);
  }
  return { ...block.input, source: "llm" };
}
