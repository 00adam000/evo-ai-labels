// Graded AI-involvement labels, derived by fixed rules from the provenance record.
// The label level is decided here, deterministically, not by the LLM. The model
// only explains a label later, so it can never change what the label says.

export const LEVELS = {
  captured: {
    text: "Camera original",
    short: "No AI changes recorded",
    css: "lvl-captured",
  },
  enhanced: {
    text: "AI-enhanced",
    short: "AI used for quality only (e.g. noise reduction)",
    css: "lvl-enhanced",
  },
  edited: {
    text: "Edited with AI",
    short: "Part of the content was changed or added by AI",
    css: "lvl-edited",
  },
  generated: {
    text: "AI-generated",
    short: "The whole image was created by AI",
    css: "lvl-generated",
  },
  none: {
    text: "No provenance info",
    short: "Unknown, not verified real",
    css: "lvl-none",
  },
};

// Severity of each IPTC digital source type (simplified). The most severe
// action in the record sets the label level.
const SEVERITY = {
  digitalCapture: 0,
  algorithmicallyEnhanced: 1,
  compositeWithTrainedAlgorithmicMedia: 2,
  trainedAlgorithmicMedia: 3,
};

export function levelFor(provenance) {
  if (!provenance || !Array.isArray(provenance.actions)) return "none";
  let max = 0;
  for (const a of provenance.actions) {
    const s = SEVERITY[a.digitalSourceType];
    if (s !== undefined && s > max) max = s;
  }
  return ["captured", "enhanced", "edited", "generated"][max];
}
