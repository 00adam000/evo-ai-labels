// Tests for js/schema.js. Plain Node, no dependencies:
//   node tests/validate.test.mjs

import { readFileSync } from "node:fs";
import { mockExplain } from "../js/explainer.js";
import { validateExplanation } from "../js/schema.js";

const { posts } = JSON.parse(readFileSync(new URL("../data/posts.json", import.meta.url)));
const byId = Object.fromEntries(posts.map((p) => [p.id, p]));

let failed = 0;
function report(pass, name, detail = "") {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// 1. The mock explainer's output must pass for every post.
console.log("Valid output (mockExplain):");
for (const post of posts) {
  const r = validateExplanation(mockExplain(post), post);
  report(r.ok, `${post.id} mock explanation is accepted`, r.errors.join("; "));
}

// 2. Hand-made bad outputs must be rejected with the expected error.
const mock = (id) => structuredClone(mockExplain(byId[id]));
const BAD = [
  ["missing field (no what_is_unknown)", "p2", () => { const r = mock("p2"); delete r.what_is_unknown; return r; }, /missing field: what_is_unknown/],
  ["extra key (confidence)", "p2", () => ({ ...mock("p2"), confidence: 0.9 }), /extra key: confidence/],
  ["citation to actions[5]", "p2", () => { const r = mock("p2"); r.cited_fields.push("actions[5]"); return r; }, /citation out of range: actions\[5\]/],
  ["citation to a field not in the record", "p2", () => { const r = mock("p2"); r.cited_fields.push("location"); return r; }, /citation not in record: location/],
  ["what_ai_did item with no action citation", "p2", () => ({ ...mock("p2"), cited_fields: ["signer"] }), /need at least one cited actions\[i\]/],
  ["AI actions listed for a no-provenance post", "p5", () => ({ ...mock("p5"), what_ai_did: ["AI brightened the loaves."] }), /must be empty when there is no provenance/],
  ["no-provenance post without the 'not verified' warning", "p6", () => ({ ...mock("p6"), what_is_unknown: ["Whether AI was used."] }), /no label does not mean verified or real/],
  ["AI actions listed for a camera original", "p1", () => ({ ...mock("p1"), what_ai_did: ["AI adjusted colours."], cited_fields: ["actions[1]"] }), /must be empty for a camera original/],
  ["'camera' in a generated post's summary", "p3", () => ({ ...mock("p3"), summary: "This image was taken with a camera and lightly edited." }), /must not describe it as a camera photo/],
  ["'this is fake' in a summary", "p4", () => ({ ...mock("p4"), summary: "This is fake. The image was created by AI." }), /judges the claim's truth \("fake"\)/],
  ["400-char summary", "p2", () => ({ ...mock("p2"), summary: "a".repeat(400) }), /summary too long \(400 > 300/],
  ["6 items in what_ai_did", "p2", () => ({ ...mock("p2"), what_ai_did: Array(6).fill("Changed the sky.") }), /too many items \(6 > 5\)/],
  ["what_ai_did item over 200 chars", "p2", () => ({ ...mock("p2"), what_ai_did: ["x".repeat(201)] }), /what_ai_did\[0\] too long/],
  ["invalid source", "p2", () => ({ ...mock("p2"), source: "gpt" }), /invalid source/],
  ["empty summary", "p2", () => ({ ...mock("p2"), summary: "  " }), /summary must be a non-empty string/],
  ["non-string in cited_fields", "p2", () => ({ ...mock("p2"), cited_fields: ["signer", 1] }), /cited_fields must be an array of strings/],
  ["more what_ai_did items than AI actions", "p2", () => ({ ...mock("p2"), what_ai_did: ["Replaced the sky.", "Changed the lanterns."] }), /has 2 items but the record has 1 AI actions/],
  ["only the camera capture action cited", "p2", () => ({ ...mock("p2"), what_ai_did: ["Took the photo with a DSLR camera."], cited_fields: ["signer", "actions[0]"] }), /at least one cited actions\[i\] that is an AI action/],
  ["manual edit described as AI on an AI-generated post", "p4", () => ({ ...mock("p4"), what_ai_did: [...mock("p4").what_ai_did, "Added a text overlay and crop."], cited_fields: ["actions[0]", "actions[1]"] }), /has 2 items but the record has 1 AI actions/],
  ["'(actions[1])' in what_ai_did", "p2", () => { const r = mock("p2"); r.what_ai_did[0] += " (actions[1])"; return r; }, /what_ai_did\[0\] contains internal text \("actions\["\)/],
  ["'cited_fields' in summary", "p2", () => ({ ...mock("p2"), summary: "Part of the image was changed by AI, see cited_fields." }), /summary contains internal text \("cited_fields"\)/],
  ["'digitalSourceType' in what_is_unknown", "p7", () => ({ ...mock("p7"), what_is_unknown: ["Whether the caption is accurate.", "What digitalSourceType means here."] }), /what_is_unknown\[1\] contains internal text \("digitalSourceType"\)/],
  ["'{' in summary", "p3", () => ({ ...mock("p3"), summary: "This image was AI-generated {tool: Text-to-image model}." }), /summary contains internal text \("\{"\)/],
  ["citation to 'caption'", "p2", () => { const r = mock("p2"); r.cited_fields.push("caption"); return r; }, /citation not in record: caption/],
  ["'label_level' in summary", "p2", () => ({ ...mock("p2"), summary: "The label_level is Edited with AI." }), /summary contains internal text \("label_level"\)/],
  ["'(trainedAlgorithmicMedia)' in what_ai_did", "p3", () => ({ ...mock("p3"), what_ai_did: ["Created the image with a text-to-image model (trainedAlgorithmicMedia)."] }), /what_ai_did\[0\] contains internal text \("trainedAlgorithmicMedia"\)/],
  ...["digitalCapture", "algorithmicallyEnhanced", "compositeWithTrainedAlgorithmicMedia", "trainedAlgorithmicMedia"].map((t) =>
    [`source type '${t}' in summary`, "p2", () => ({ ...mock("p2"), summary: `This image is ${t}.` }), new RegExp(`summary contains internal text \\("${t}"\\)`)]),
];

console.log("\nInvalid output (must be rejected):");
for (const [name, id, make, expected] of BAD) {
  const r = validateExplanation(make(), byId[id]);
  const hit = r.errors.some((e) => expected.test(e));
  report(!r.ok && hit, `rejects ${name}`, hit ? r.errors.find((e) => expected.test(e)) : `got: ${r.errors.join("; ") || "accepted"}`);
}

// Real output from the first live run (claude-haiku-5-5, post p2). The old
// validator accepted it although it counted the camera capture as AI and put
// field names in the text.
console.log("\nLive failure (p2, claude-haiku-5-5):");
const LIVE_P2 = {
  summary: "This image was labeled \"Edited with AI.\" The provenance shows it started as a camera photo, and an AI generative fill tool later replaced the overcast sky in the upper part of the image with a generated clear night sky.",
  what_ai_did: [
    "Created the image as a digital camera capture using a DSLR camera (actions[0]).",
    "Edited the sky region (upper third of the image) using Generative fill, replacing the overcast sky with a generated clear night sky (actions[1]).",
  ],
  what_is_unknown: [
    "This provenance describes the image itself, not the caption or any text the post uses with it.",
    "The record does not say how much of the rest of the image, if any, was changed beyond the sky.",
    "The record does not say why the sky was replaced or whether the change was disclosed to viewers outside this record.",
    "The record does not show whether the scene itself was as photographed or what happened at the location.",
  ],
  // Not visible in the screenshot of the live run, so this value is assumed.
  cited_fields: ["actions[0]", "actions[1]"],
  source: "llm",
};
const LIVE_EXPECTED = [
  ["camera capture counted as AI", /what_ai_did has 2 items but the record has 1 AI actions/],
  ["'(actions[0])' in user-facing text", /what_ai_did\[0\] contains internal text \("actions\["\)/],
  ["'(actions[1])' in user-facing text", /what_ai_did\[1\] contains internal text \("actions\["\)/],
];
const live = validateExplanation(LIVE_P2, byId.p2);
report(!live.ok, "rejects the live p2 output", live.errors.join("; ") || "accepted");
for (const [name, expected] of LIVE_EXPECTED) {
  const e = live.errors.find((x) => expected.test(x));
  report(!!e, `live p2 output: flags ${name}`, e ?? `got: ${live.errors.join("; ")}`);
}

console.log("\nCiting the label level (must be accepted):");
const ACCEPTED = [
  ["p2 explanation citing label_level", "p2", () => { const r = mock("p2"); r.cited_fields.unshift("label_level"); return r; }],
  ["p5 (no record) explanation citing only label_level", "p5", () => ({ ...mock("p5"), cited_fields: ["label_level"] })],
];
for (const [name, id, make] of ACCEPTED) {
  const r = validateExplanation(make(), byId[id]);
  report(r.ok, `accepts ${name}`, r.errors.join("; "));
}

const total = posts.length + BAD.length + 1 + LIVE_EXPECTED.length + ACCEPTED.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
