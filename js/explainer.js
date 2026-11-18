// Offline (mock) explainer. Builds a plain-language explanation of a post's
// label using ONLY fields present in post.provenance, so it never invents
// details. It runs with no API key and is the fallback if the LLM explainer fails.

import { levelFor } from "./labels.js";

const SUMMARY = {
  captured: "This image is a camera original: no AI changes are recorded.",
  enhanced: "This image was AI-enhanced: AI was used to improve quality, not to change the content.",
  edited: "This image was edited with AI: part of the content was changed or added by AI.",
  generated: "This image was AI-generated: the whole image was created by AI.",
};

// Plain-English verb for each AI source type. Actions with no
// digitalSourceType (e.g. manual edits) are not claimed as AI.
const VERB = {
  algorithmicallyEnhanced: "Enhanced the image",
  compositeWithTrainedAlgorithmicMedia: "Changed or added part of the image",
  trainedAlgorithmicMedia: "Created the image",
};

const CAPTION_UNKNOWN = "Whether the caption is accurate. Provenance describes the image, not the claim.";

function describeAction(a) {
  let line = VERB[a.digitalSourceType] ?? `AI action (${a.digitalSourceType})`;
  if (a.tool) line += ` using ${a.tool}`;
  if (a.region) line += `, in the ${a.region}`;
  line += ".";
  if (a.description) line += ` ${a.description}.`;
  return line;
}

export function mockExplain(post) {
  const p = post.provenance;

  if (!p || !Array.isArray(p.actions)) {
    return {
      summary: "This post has no provenance record, so we can't tell how the image was made.",
      what_ai_did: [],
      what_is_unknown: [
        "Whether AI was used.",
        "Who made it and when.",
        "No label does not mean the post is verified or real.",
      ],
      cited_fields: [],
      source: "mock",
    };
  }

  const level = levelFor(p);
  const cited = [];
  let summary = SUMMARY[level];
  if (p.signer) {
    summary += ` Signed by: ${p.signer}.`;
    cited.push("signer");
  }

  const what_ai_did = [];
  p.actions.forEach((a, i) => {
    if (a.digitalSourceType && a.digitalSourceType !== "digitalCapture") {
      what_ai_did.push(describeAction(a));
      cited.push(`actions[${i}]`);
    }
  });

  const what_is_unknown = [CAPTION_UNKNOWN];
  if (p.signer && p.signer.toLowerCase().includes("unverified")) {
    what_is_unknown.push("Who published it. The signer is an unverified account.");
  }

  return { summary, what_ai_did, what_is_unknown, cited_fields: cited, source: "mock" };
}

export const CHIPS = [
  { id: "changed", text: "What exactly was changed?" },
  { id: "who", text: "Who made this and when?" },
  { id: "truth", text: "Is this post true?" },
];

const NO_RECORD = "This post has no provenance record";
const NOT_TRUTH = "Provenance shows how the image was made, not whether the caption is true.";
const SHOWS = {
  captured: "The record shows a camera original with no AI changes recorded.",
  enhanced: "The record shows AI was used only to improve quality, not to change the content.",
  edited: "The record shows part of the image was changed or added by AI.",
  generated: "The record shows the whole image was created by AI.",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats an ISO timestamp as "13 Nov 2026, 21:40 UTC", independent of the browser locale. */
function formatSigned(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const isUnverified = (p) => !!p.signer && p.signer.toLowerCase().includes("unverified");

function answerChanged(p) {
  const lines = [];
  const cited = [];
  p.actions.forEach((a, i) => {
    if (a.digitalSourceType === "digitalCapture") {
      lines.push(`It started as a camera capture${a.tool ? ` (${a.tool})` : ""}.`);
    } else if (a.digitalSourceType) {
      lines.push(`Done by AI: ${lowerFirst(describeAction(a))}`);
    } else {
      const what = a.description || (a.action || "an edit").replace(/_/g, " ");
      lines.push(`Not done by AI: ${lowerFirst(what)}${a.tool ? `, using ${a.tool}` : ""}.`);
    }
    cited.push(`actions[${i}]`);
  });
  if (levelFor(p) === "captured") lines.unshift("No AI changes are recorded.");
  return { answer: lines.join(" "), answerable: true, cited_fields: cited, source: "mock" };
}

function answerWho(p) {
  const parts = [];
  const cited = [];
  if (p.signer) {
    parts.push(`Signed by "${p.signer}"${p.signed ? ` on ${formatSigned(p.signed)}` : ""}.`);
    cited.push("signer");
    if (p.signed) cited.push("signed");
  }
  if (p.claim_generator) {
    parts.push(`The record was written by ${p.claim_generator}.`);
    cited.push("claim_generator");
  }
  if (isUnverified(p)) parts.push("The signer is an unverified account, so who published it can't be confirmed.");
  if (!cited.length) {
    return { answer: "The provenance record doesn't say who made the image or when.", answerable: false, cited_fields: [], source: "mock" };
  }
  return { answer: parts.join(" "), answerable: true, cited_fields: cited, source: "mock" };
}

function answerTruth(p) {
  const parts = [NOT_TRUTH, SHOWS[levelFor(p)]];
  const cited = p.actions.map((_, i) => `actions[${i}]`);
  if (p.signer) {
    parts.push(isUnverified(p) ? "It was signed by an unverified account." : `It was signed by "${p.signer}".`);
    cited.push("signer");
  }
  return { answer: parts.join(" "), answerable: true, cited_fields: cited, source: "mock" };
}

/** Answers one of the CHIPS questions from the provenance record alone. */
export function mockAnswer(post, chipId) {
  const p = post.provenance;
  if (!p || !Array.isArray(p.actions)) {
    const answer = {
      changed: `${NO_RECORD}, so it doesn't say what was changed or whether AI was used.`,
      who: `${NO_RECORD}, so it doesn't say who made the image or when.`,
      truth: `${NOT_TRUTH} ${NO_RECORD}, so it doesn't say how the image was made. No record does not mean the post is verified or real.`,
    }[chipId];
    if (!answer) throw new Error(`unknown question: ${chipId}`);
    return { answer, answerable: false, cited_fields: [], source: "mock" };
  }
  if (chipId === "changed") return answerChanged(p);
  if (chipId === "who") return answerWho(p);
  if (chipId === "truth") return answerTruth(p);
  throw new Error(`unknown question: ${chipId}`);
}
