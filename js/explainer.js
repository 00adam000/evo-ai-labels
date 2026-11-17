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
