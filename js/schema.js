// Validators for explanation and follow-up answer output (mock or LLM). The
// model only proposes text; nothing reaches the screen unless it passes every
// check here.

import { levelFor } from "./labels.js";

const KEYS = ["summary", "what_ai_did", "what_is_unknown", "cited_fields", "source"];
// The only names a citation may use, besides "actions[i]". The prompts in
// js/llm.js list the same names, so the model and the validator agree.
// label_level is not a record field but is part of the model's input, and it
// is decided by fixed rules, so citing it is legitimate.
export const CITATION_NAMES = ["label_level", "signer", "signed", "claim_generator"];
const RECORD_FIELDS = ["signer", "signed", "claim_generator"];
const NOT_VERIFIED = /\bno(t)?\b.*\b(verified|real)\b/i;
const CAMERA_WORDS = /\bcamera\b|\breal photo\b|\bphotographed\b/i;
const TRUTH_WORDS = /\b(true|untrue|false|fake|genuine|accurate|inaccurate)\b/i;
// Only these source types involve AI. Camera capture and manual edits (no
// source type) must not be described as something AI did.
const AI_SOURCE_TYPES = ["algorithmicallyEnhanced", "compositeWithTrainedAlgorithmicMedia", "trainedAlgorithmicMedia"];
// Field names or JSON in the shown text mean the model copied record internals
// into prose meant for readers; citations belong in cited_fields only.
const SOURCE_TYPES = ["digitalCapture", ...AI_SOURCE_TYPES];
// "label level" is internal jargon; the reader should see the label's name.
const INTERNAL_TEXT = ["actions[", "cited_fields", "label_level", "label level", "digitalSourceType", "{", ...SOURCE_TYPES];

const ANSWER_KEYS = ["answer", "answerable", "cited_fields", "source"];
const MAX_ANSWER_LENGTH = 400;
const CLAIM_WORDS = /\b(true|untrue|false|fake|real|genuine|accurate|inaccurate)\b/gi;
// A claim word is allowed only after a hedge in the same clause, as in
// "doesn't show whether the caption is true" or "does not mean it is real".
const HEDGE = /\bwhether\b|(?:\b(?:not|cannot|never)\b|n['’]t\b).*\b(?:show|shows|tell|tells|prove|proves|mean|means|say|says|establish|establishes|confirm|confirms)\b/i;
// Clauses are split on commas and "but" so a hedge can't cover a later verdict,
// as in "it doesn't say who took it, but the post is fake".
const CLAUSE_SPLIT = /[.!?;,:]|\bbut\b/i;
const NOT_IN_RECORD = /(?:\b(?:no|not|cannot|never)\b|n['’]t\b)[^.]*\b(?:say|says|show|shows|record|records|recorded|include|includes|contain|contains|state|states|mention|mentions|list|lists|know)\b/i;
const PROVENANCE_NOT_TRUTH = /\bnot whether\b|(?:\b(?:not|cannot)\b|n['’]t\b)[^.]*\b(?:show|shows|tell|tells|prove|proves|establish|establishes)\b[^.]*\bwhether\b/i;

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const isAiAction = (a) => !!a && AI_SOURCE_TYPES.includes(a.digitalSourceType);
// Case-insensitive, so "Label level" at the start of a sentence is also caught.
const internalText = (text) => INTERNAL_TEXT.find((t) => text.toLowerCase().includes(t.toLowerCase()));

/** Checks that each cited field exists in the record; also reports whether any cited action is an AI action. */
function checkCitations(cited, p) {
  const errors = [];
  const hasRecord = !!p && Array.isArray(p.actions);
  let citesAiAction = false;
  for (const f of cited) {
    const m = f.match(/^actions\[(\d+)\]$/);
    if (f === "label_level") continue;
    if (!hasRecord) errors.push(`citation to ${f} but the post has no provenance record`);
    else if (m) {
      if (+m[1] >= p.actions.length) errors.push(`citation out of range: ${f} (record has ${p.actions.length} actions)`);
      else if (isAiAction(p.actions[+m[1]])) citesAiAction = true;
    } else if (!RECORD_FIELDS.includes(f) || p[f] === undefined) {
      errors.push(`citation not in record: ${f}`);
    }
  }
  return { errors, citesAiAction };
}

/** Returns the first claim word used as a verdict rather than inside a hedge, or null. */
export function truthJudgment(text) {
  for (const clause of text.split(CLAUSE_SPLIT)) {
    for (const m of clause.matchAll(CLAIM_WORDS)) {
      if (!HEDGE.test(clause.slice(0, m.index))) return m[0];
    }
  }
  return null;
}

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
  const aiActionCount = hasRecord ? p.actions.filter(isAiAction).length : 0;
  const { errors: citationErrors, citesAiAction } = checkCitations(cited_fields, p);
  errors.push(...citationErrors);
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
    const bad = internalText(text);
    if (bad) errors.push(`${where} contains internal text ("${bad}")`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Checks a follow-up answer. Pass { chip: "truth" } for the "Is this post true?"
 * chip, whose answer must also explain that provenance is not a truth check.
 */
export function validateAnswer(result, post, { chip } = {}) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, errors: ["result is not an object"] };
  }

  for (const k of ANSWER_KEYS) if (!(k in result)) errors.push(`missing field: ${k}`);
  for (const k of Object.keys(result)) if (!ANSWER_KEYS.includes(k)) errors.push(`extra key: ${k}`);

  const { answer, answerable, cited_fields, source } = result;
  if (typeof answer !== "string" || answer.trim() === "") errors.push("answer must be a non-empty string");
  else if (answer.length > MAX_ANSWER_LENGTH) errors.push(`answer too long (${answer.length} > ${MAX_ANSWER_LENGTH} chars)`);
  if ("answerable" in result && typeof answerable !== "boolean") errors.push("answerable must be a boolean");
  if ("cited_fields" in result && !isStringArray(cited_fields)) errors.push("cited_fields must be an array of strings");
  if ("source" in result && source !== "mock" && source !== "llm") errors.push(`invalid source: ${JSON.stringify(source)}`);

  if (errors.length) return { ok: false, errors };

  errors.push(...checkCitations(cited_fields, post.provenance).errors);
  if (answerable) {
    if (!cited_fields.length) errors.push("an answerable answer needs at least one cited field");
  } else {
    if (cited_fields.length) errors.push("an unanswerable answer must not cite fields");
    if (!NOT_IN_RECORD.test(answer)) errors.push("an unanswerable answer must say the record doesn't contain it");
  }

  const bad = internalText(answer);
  if (bad) errors.push(`answer contains internal text ("${bad}")`);

  const verdict = truthJudgment(answer);
  if (verdict) errors.push(`answer judges the claim's truth ("${verdict}")`);
  if (chip === "truth" && !PROVENANCE_NOT_TRUTH.test(answer)) {
    errors.push("answer must say that provenance shows how the image was made, not whether the post is true");
  }

  return { ok: errors.length === 0, errors };
}
