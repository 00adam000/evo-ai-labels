// Validator for explanation output (mock or LLM). The model only proposes an
// explanation; nothing reaches the screen unless it passes every check here.

import { levelFor } from "./labels.js";

const KEYS = ["summary", "what_ai_did", "what_is_unknown", "cited_fields", "source"];
const RECORD_FIELDS = ["signer", "claim_generator", "signed"];
const NOT_VERIFIED = /\bno(t)?\b.*\b(verified|real)\b/i;
const CAMERA_WORDS = /\bcamera\b|\breal photo\b|\bphotographed\b/i;
const TRUTH_WORDS = /\b(true|untrue|false|fake|genuine|accurate|inaccurate)\b/i;
// Only these source types involve AI. Camera capture and manual edits (no
// source type) must not be described as something AI did.
const AI_SOURCE_TYPES = ["algorithmicallyEnhanced", "compositeWithTrainedAlgorithmicMedia", "trainedAlgorithmicMedia"];
// Field names or JSON in the shown text mean the model copied record internals
// into prose meant for readers; citations belong in cited_fields only.
const INTERNAL_TEXT = ["actions[", "cited_fields", "digitalSourceType", "{"];

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

export function validateExplanation(result, post) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, errors: ["result is not an object"] };
  }

  // --- Structure ---
  for (const k of KEYS) if (!(k in result)) errors.push(`missing field: ${k}`);
  for (const k of Object.keys(result)) if (!KEYS.includes(k)) errors.push(`extra key: ${k}`);

  const { summary, what_ai_did, what_is_unknown, cited_fields, source } = result;
  if (typeof summary !== "string" || summary.trim() === "") errors.push("summary must be a non-empty string");
  else if (summary.length > 300) errors.push(`summary too long (${summary.length} > 300 chars)`);

  for (const k of ["what_ai_did", "what_is_unknown", "cited_fields"]) {
    if (k in result && !isStringArray(result[k])) errors.push(`${k} must be an array of strings`);
  }
  if (isStringArray(what_ai_did)) {
    if (what_ai_did.length > 5) errors.push(`what_ai_did has too many items (${what_ai_did.length} > 5)`);
    what_ai_did.forEach((s, i) => {
      if (s.length > 200) errors.push(`what_ai_did[${i}] too long (${s.length} > 200 chars)`);
    });
  }
  if ("source" in result && source !== "mock" && source !== "llm") errors.push(`invalid source: ${JSON.stringify(source)}`);

  // Stop here if the shape is wrong; the later checks assume it is right.
  if (errors.length) return { ok: false, errors };

  const p = post.provenance;
  const hasRecord = !!p && Array.isArray(p.actions);

  // --- Grounding: every citation must exist in the record ---
  const isAiAction = (a) => !!a && AI_SOURCE_TYPES.includes(a.digitalSourceType);
  const aiActionCount = hasRecord ? p.actions.filter(isAiAction).length : 0;
  let citesAiAction = false;
  for (const f of cited_fields) {
    const m = f.match(/^actions\[(\d+)\]$/);
    if (!hasRecord) errors.push(`citation to ${f} but the post has no provenance record`);
    else if (m) {
      if (+m[1] >= p.actions.length) errors.push(`citation out of range: ${f} (record has ${p.actions.length} actions)`);
      else if (isAiAction(p.actions[+m[1]])) citesAiAction = true;
    } else if (!RECORD_FIELDS.includes(f) || p[f] === undefined) {
      errors.push(`citation not in record: ${f}`);
    }
  }
  if (what_ai_did.length > aiActionCount) {
    errors.push(`what_ai_did has ${what_ai_did.length} items but the record has ${aiActionCount} AI actions`);
  }
  if (what_ai_did.length && !citesAiAction) errors.push("what_ai_did items need at least one cited actions[i] that is an AI action");

  // --- Consistency with the rule-based label ---
  const level = levelFor(p);
  if (level === "none") {
    if (what_ai_did.length) errors.push("what_ai_did must be empty when there is no provenance record");
    if (!what_is_unknown.some((s) => NOT_VERIFIED.test(s))) {
      errors.push("what_is_unknown must say that no label does not mean verified or real");
    }
  }
  if (level === "captured" && what_ai_did.length) errors.push("what_ai_did must be empty for a camera original");
  if (level === "generated" && CAMERA_WORDS.test(summary)) {
    errors.push("summary of an AI-generated post must not describe it as a camera photo");
  }

  // --- Safety of claims: provenance can't show the claim is true or false ---
  const w = summary.match(TRUTH_WORDS);
  if (w) errors.push(`summary judges the claim's truth ("${w[0]}")`);

  const userText = [["summary", summary], ...what_ai_did.map((s, i) => [`what_ai_did[${i}]`, s]), ...what_is_unknown.map((s, i) => [`what_is_unknown[${i}]`, s])];
  for (const [where, text] of userText) {
    const bad = INTERNAL_TEXT.find((t) => text.includes(t));
    if (bad) errors.push(`${where} contains internal text ("${bad}")`);
  }

  return { ok: errors.length === 0, errors };
}
