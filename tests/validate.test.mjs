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
];

console.log("\nInvalid output (must be rejected):");
for (const [name, id, make, expected] of BAD) {
  const r = validateExplanation(make(), byId[id]);
  const hit = r.errors.some((e) => expected.test(e));
  report(!r.ok && hit, `rejects ${name}`, hit ? r.errors.find((e) => expected.test(e)) : `got: ${r.errors.join("; ") || "accepted"}`);
}

const total = posts.length + BAD.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
