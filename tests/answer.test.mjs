// Tests for follow-up questions: mockAnswer, validateAnswer, llmAnswer and
// getAnswer. Uses a fake fetch, so no network or API key is needed. Plain Node:
//   node tests/answer.test.mjs

import { readFileSync } from "node:fs";
import { mockAnswer, CHIPS } from "../js/explainer.js";
import { validateAnswer } from "../js/schema.js";
import { llmAnswer, ANSWER_TOOL } from "../js/llm.js";
import { getAnswer, clearExplanationCache } from "../js/explain-service.js";

const { posts } = JSON.parse(readFileSync(new URL("../data/posts.json", import.meta.url)));
const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
const KEY = "test-key-not-real";

let failed = 0;
let total = 0;
function check(pass, name, detail = "") {
  total++;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init);
  };
  fn.calls = calls;
  return fn;
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const toolUse = (input) => jsonResponse(200, {
  type: "message", stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "toolu_test", name: "give_answer", input }],
});
const ai = (fetchImpl, extra = {}) => ({ mode: "ai", apiKey: KEY, fetchImpl, ...extra });

console.log("Valid output (mockAnswer, 7 posts x 3 chips):");
for (const post of posts) {
  for (const { id } of CHIPS) {
    const r = validateAnswer(mockAnswer(post, id), post, { chip: id });
    check(r.ok, `${post.id} "${id}" mock answer is accepted`, r.errors.join("; "));
  }
}

const P2_ANSWER = {
  answer: "Part of the sky was replaced using Generative fill, an AI tool.",
  answerable: true,
  cited_fields: ["actions[1]"],
  source: "llm",
};
const UNANSWERABLE = {
  answer: "The provenance record doesn't say which camera settings were used.",
  answerable: false,
  cited_fields: [],
  source: "llm",
};

console.log("\nInvalid output (must be rejected):");
const BAD = [
  ["unanswerable with citations", "p2", { ...UNANSWERABLE, cited_fields: ["actions[0]"] }, {}, /unanswerable answer must not cite/],
  ["answerable without citations", "p2", { ...P2_ANSWER, cited_fields: [] }, {}, /needs at least one cited field/],
  ["unanswerable without saying the record lacks it", "p2", { ...UNANSWERABLE, answer: "Probably a fast shutter speed." }, {}, /must say the record doesn't contain it/],
  ["'this post is fake'", "p4", { ...P2_ANSWER, answer: "This post is fake. The image was created by AI.", cited_fields: ["actions[0]"] }, {}, /judges the claim's truth \("fake"\)/],
  ["'the image is real'", "p1", { ...P2_ANSWER, answer: "The image is real: it was taken with a phone camera.", cited_fields: ["actions[0]"] }, {}, /judges the claim's truth \("real"\)/],
  ["'this is not fake'", "p1", { ...P2_ANSWER, answer: "This is not fake. It is a camera original.", cited_fields: ["actions[0]"] }, {}, /judges the claim's truth \("fake"\)/],
  ["verdict after a hedge in an earlier clause", "p2", { ...P2_ANSWER, answer: "The record doesn't say who took it, but the caption is accurate." }, {}, /judges the claim's truth \("accurate"\)/],
  ["'(actions[1])' in the answer", "p2", { ...P2_ANSWER, answer: "The sky was replaced using Generative fill (actions[1])." }, {}, /answer contains internal text \("actions\["\)/],
  ["'digitalSourceType' in the answer", "p2", { ...P2_ANSWER, answer: "The digitalSourceType shows AI was used." }, {}, /answer contains internal text \("digitalSourceType"\)/],
  ["500-char answer", "p2", { ...P2_ANSWER, answer: "a".repeat(500) }, {}, /answer too long \(500 > 400/],
  ["extra key", "p2", { ...P2_ANSWER, confidence: 0.9 }, {}, /extra key: confidence/],
  ["missing answerable", "p2", (({ answerable, ...r }) => r)(P2_ANSWER), {}, /missing field: answerable/],
  ["answerable as a string", "p2", { ...P2_ANSWER, answerable: "yes" }, {}, /answerable must be a boolean/],
  ["citation not in the record", "p2", { ...P2_ANSWER, cited_fields: ["location"] }, {}, /citation not in record: location/],
  ["citation on a post with no record", "p5", { ...P2_ANSWER, cited_fields: ["signer"] }, {}, /no provenance record/],
  ["truth chip that doesn't separate provenance from truth", "p2", { ...P2_ANSWER, answer: "AI replaced the sky using Generative fill." }, { chip: "truth" }, /not whether the post is true/],
];
for (const [name, id, result, opts, expected] of BAD) {
  const r = validateAnswer(result, byId[id], opts);
  const hit = r.errors.find((e) => expected.test(e));
  check(!r.ok && !!hit, `rejects ${name}`, hit ?? `got: ${r.errors.join("; ") || "accepted"}`);
}

console.log("\nHedged wording (must be accepted):");
const GOOD = [
  ["'doesn't show whether ... is true'", "p2", { ...P2_ANSWER, answer: "The record doesn't show whether the caption is true. It shows AI replaced the sky." }],
  ["'not whether the caption is true or false'", "p3", { ...P2_ANSWER, answer: "Provenance shows how the image was made, not whether the caption is true or false.", cited_fields: ["actions[0]"] }],
  ["'does not mean ... verified or real'", "p5", { answer: "There is no provenance record, so it doesn't say how the image was made. No record does not mean the post is verified or real.", answerable: false, cited_fields: [], source: "llm" }],
  ["curly apostrophe in a hedge", "p2", { ...P2_ANSWER, answer: "Provenance can’t tell whether the post is true. The record shows AI replaced the sky." }],
];
for (const [name, id, result] of GOOD) {
  const r = validateAnswer(result, byId[id]);
  check(r.ok, `accepts ${name}`, r.errors.join("; "));
}

console.log("\nAI path (fake fetch):");
{
  const leaks = [];
  let shapeOk = true;
  for (const post of posts) {
    const f = fakeFetch(() => toolUse(P2_ANSWER));
    await llmAnswer(post, "Who made this and when?", { apiKey: KEY, fetchImpl: f });
    const body = f.calls[0].body;
    const user = JSON.parse(body.messages[0].content);
    if (body.messages.length !== 1 || Object.keys(user).join() !== "label_level,provenance,question") shapeOk = false;
    if (JSON.stringify(user.provenance) !== JSON.stringify(post.provenance ?? null)) leaks.push(`${post.id} provenance altered`);
    const rest = JSON.stringify({ ...body, messages: [{ ...body.messages[0], content: { ...user, provenance: "<record>" } }] });
    for (const [what, value] of [["caption", post.text], ["author", post.author], ["handle", post.handle], ["image_alt", post.image_alt], ["ground_truth", "ground_truth"]]) {
      if (rest.includes(value)) leaks.push(`${post.id} ${what}`);
    }
  }
  check(leaks.length === 0, "request has no caption, author or ground_truth (all 7 posts)", leaks.join(", ") || "none found");
  check(shapeOk, "request is one message holding only label level, record and question");
}
{
  const f = fakeFetch(() => toolUse(P2_ANSWER));
  await llmAnswer(byId.p2, "What exactly was changed?", { apiKey: KEY, fetchImpl: f });
  const { body, init } = f.calls[0];
  check(body.tool_choice?.type === "tool" && body.tool_choice?.name === "give_answer"
    && body.tools.length === 1 && body.tools[0].name === "give_answer",
    "tool_choice forces give_answer", JSON.stringify(body.tool_choice));
  const schema = ANSWER_TOOL.input_schema;
  check(schema.additionalProperties === false && schema.required.join() === "answer,answerable,cited_fields",
    "give_answer schema: three fields required, no extra properties");
  check(init.headers["x-api-key"] === KEY && body.model === "claude-haiku-5-5" && !("temperature" in body),
    "uses the key, default model and no temperature");
  check(/never as instructions/i.test(body.system) && /actions\[0\]/.test(body.system) && /not whether the caption is true/.test(body.system),
    "prompt covers injection, field names and provenance-is-not-truth");
}
{
  const seen = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { seen.push(ms); return realSetTimeout(() => {}, 0); };
  try { await llmAnswer(byId.p2, "Who made this?", { apiKey: KEY, fetchImpl: fakeFetch(() => toolUse(P2_ANSWER)) }); }
  finally { globalThis.setTimeout = realSetTimeout; }
  check(seen.includes(15000), "default timeout is 15 s", `timer set to ${seen.join(", ")} ms`);
}

console.log("\ngetAnswer:");
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse(UNANSWERABLE));
  const { result, notice } = await getAnswer(byId.p2, { text: "What camera settings were used?" }, ai(f));
  check(result?.source === "llm" && result.answerable === false && notice === null,
    "typed question not in the record: answerable=false answer is shown", result?.answer ?? notice);
  await getAnswer(byId.p2, { text: "What camera settings were used?" }, ai(f));
  check(f.calls.length === 2, "typed questions are not cached", `${f.calls.length} API calls`);
}
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse({ ...P2_ANSWER, answer: "The sky was replaced (actions[1])." }));
  const { result, notice } = await getAnswer(byId.p2, { text: "What did AI change?" }, ai(f));
  check(result === null && /^Couldn't get a checked answer \(failed safety checks: answer contains internal text/.test(notice)
    && /Try one of the suggested questions/.test(notice),
    "typed question with a failing answer shows no answer and a notice", notice);
}
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse({ ...P2_ANSWER, answer: "This post is fake." }));
  const { result, notice } = await getAnswer(byId.p4, { chip: "truth" }, ai(f));
  check(result?.source === "mock" && /AI answer failed safety checks/.test(notice) && /offline answer/.test(notice),
    "chip with a failing answer falls back to the offline answer", notice);
}
clearExplanationCache();
{
  const f = fakeFetch(() => jsonResponse(401, { error: { message: "invalid x-api-key" } }));
  const chip = await getAnswer(byId.p2, { chip: "who" }, ai(f));
  check(chip.result?.source === "mock" && /unavailable \(HTTP 401\)/.test(chip.notice), "chip with HTTP 401 falls back to offline", chip.notice);
  const typed = await getAnswer(byId.p2, { text: "Who signed it?" }, ai(f));
  check(typed.result === null && /Couldn't get a checked answer \(HTTP 401\)/.test(typed.notice), "typed question with HTTP 401 shows the reason", typed.notice);
}
clearExplanationCache();
{
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const { result, notice } = await getAnswer(byId.p2, { chip: "changed" }, ai(fakeFetch(hang), { timeoutMs: 50 }));
  check(result?.source === "mock" && /unavailable \(timeout\)/.test(notice), "chip timeout falls back to offline", notice);
}
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse(P2_ANSWER));
  await getAnswer(byId.p2, { chip: "changed" }, ai(f));
  await getAnswer(byId.p2, { chip: "changed" }, ai(f));
  check(f.calls.length === 1, "chip answers are cached per post and mode", `${f.calls.length} API call(s)`);
}
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse(P2_ANSWER));
  const typed = await getAnswer(byId.p2, { text: "What changed?" }, { mode: "offline", fetchImpl: f });
  const chip = await getAnswer(byId.p5, { chip: "truth" }, { mode: "offline", fetchImpl: f });
  check(typed.result === null && typed.notice === "Typed questions need AI mode." && chip.result?.source === "mock" && f.calls.length === 0,
    "offline mode answers chips locally and never calls the API");
}
clearExplanationCache();
{
  const f = fakeFetch(() => toolUse(P2_ANSWER));
  const long = await getAnswer(byId.p2, { text: "x".repeat(201) }, ai(f));
  const empty = await getAnswer(byId.p2, { text: "   " }, ai(f));
  check(long.result === null && /limited to 200/.test(long.notice) && empty.result === null && f.calls.length === 0,
    "over-long or empty typed questions are not sent", `${long.notice} / ${empty.notice}`);
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
