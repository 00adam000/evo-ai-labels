// Headless browser check that the "Ask about this image" section appears after
// every explanation render path: offline, AI success, safety-check fallback,
// HTTP error, network error, missing key, and switching mode while a panel is
// open. The Anthropic API is replaced by a fake fetch, so no key or network is
// needed. Needs a Chromium binary (set CHROME=/path/to/chromium if it isn't found):
//   node tests/ui.test.mjs

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch { /* not on PATH */ }
  }
  const cache = join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      for (const bin of ["chrome-linux/headless_shell", "chrome-linux/chrome"]) {
        if (existsSync(join(cache, dir, bin))) return join(cache, dir, bin);
      }
    }
  }
  return null;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
// Serves the repo read-only. The local config holds a real API key and is never served.
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
    if (path.startsWith("..") || path === "config.local.js" || !existsSync(join(ROOT, path))) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(join(ROOT, path)));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// Replaces calls to the Anthropic API; the response depends on sessionStorage "fake.scenario".
const FAKE_API = `(() => {
  const realFetch = window.fetch.bind(window);
  window.__apiCalls = 0;
  window.fetch = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
    window.__apiCalls++;
    const scenario = sessionStorage.getItem("fake.scenario");
    const request = JSON.parse(init.body);
    const tool = request.tool_choice.name;
    const hasRecord = JSON.parse(request.messages[0].content).provenance !== null;
    if (scenario === "network") throw new TypeError("Failed to fetch");
    if (scenario === "http500") return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 500 });
    const inputs = hasRecord ? {
      give_explanation: {
        summary: "Part of this photo was changed with AI. It is signed by City Life Daily.",
        what_ai_did: ["The sky was replaced with a generated night sky using generative fill."],
        what_is_unknown: ["Whether the caption is accurate. Provenance describes the image, not the caption."],
        cited_fields: ["label_level", "signer", "actions[1]"],
      },
      give_answer: { answer: "Generative fill, an AI tool, replaced the sky.", answerable: true, cited_fields: ["label_level", "actions[1]"] },
    } : {
      give_explanation: {
        summary: "This post has no provenance record, so how the image was made is unknown.",
        what_ai_did: [],
        what_is_unknown: ["Whether AI was used.", "No label does not mean the post is verified or real."],
        cited_fields: ["label_level"],
      },
      give_answer: { answer: "This post has no provenance record, so it doesn't say what was changed.", answerable: false, cited_fields: [] },
    };
    const input = scenario === "unsafe" ? { ...inputs[tool], cited_fields: ["caption"] } : inputs[tool];
    return new Response(JSON.stringify({ type: "message", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: tool, input }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
})();`;

const chromePath = findChrome();
if (!chromePath) {
  console.log("SKIP  no Chromium found (set CHROME=/path/to/chromium)");
  process.exit(0);
}

const server = await serve();
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless", "--no-sandbox", "--window-size=600,2400", "about:blank"], { stdio: "ignore" });

let ws;
let failed = 0;
let total = 0;
try {
  let targets;
  for (let i = 0; i < 100 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); }
  }
  if (!targets) throw new Error("Chromium did not start");
  ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));

  let id = 0;
  const pending = new Map();
  let consoleErrors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level)) consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result.result.value;
  };

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_API });
  await send("Page.navigate", { url: pageUrl });
  await sleep(300);

  async function loadWith({ mode, key, scenario }) {
    await evaluate(`sessionStorage.clear();
      sessionStorage.setItem("pf.mode", ${JSON.stringify(mode)});
      ${key ? 'sessionStorage.setItem("pf.apiKey", "test-key-not-real");' : ""}
      ${scenario ? `sessionStorage.setItem("fake.scenario", ${JSON.stringify(scenario)});` : ""}
      location.reload();`).catch(() => {});
    await sleep(200);
    for (let i = 0; i < 50 && !(await evaluate("document.querySelectorAll('.post').length").catch(() => 0)); i++) await sleep(100);
  }

  // Opens the panel (unless already open), waits for the explanation, then asks the first chip.
  const INSPECT = (postId, open) => `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const post = document.getElementById(${JSON.stringify(postId)});
    if (${open}) post.querySelector(".ai-label").click();
    const body = post.querySelector(".explain-body");
    await sleep(50);
    for (let i = 0; i < 60 && body.hasAttribute("aria-busy"); i++) await sleep(50);
    const panel = post.querySelector(".explain");
    const shown = (n) => !!n && n.offsetParent !== null;
    const chips = [...panel.querySelectorAll(".ask .chip")];
    const out = {
      notice: body.querySelector(".explain-notice")?.textContent ?? null,
      foot: body.querySelector(".explain-foot")?.textContent ?? null,
      chips: chips.filter(shown).length,
      typedForm: shown(panel.querySelector(".ask-form")),
    };
    chips[0]?.click();
    for (let i = 0; i < 60 && panel.querySelector(".qa-list [aria-busy]"); i++) await sleep(50);
    const last = [...panel.querySelectorAll(".qa-list li")].pop();
    out.answer = last?.querySelector(".qa-a")?.textContent ?? null;
    out.answerNotice = last?.querySelector(".explain-notice")?.textContent ?? null;
    out.apiCalls = window.__apiCalls;
    return out;
  })()`;

  function check(name, r, expect) {
    total++;
    const problems = [];
    if (r.chips !== 3) problems.push(`${r.chips} chips visible`);
    if (r.typedForm !== expect.typedForm) problems.push(`typed form ${r.typedForm ? "shown" : "hidden"}`);
    if (!r.answer) problems.push("chip gave no answer");
    if (expect.notice && !expect.notice.test(r.notice ?? "")) problems.push(`notice: ${r.notice}`);
    if (!expect.notice && r.notice) problems.push(`unexpected notice: ${r.notice}`);
    if (consoleErrors.length) problems.push(`console: ${consoleErrors.join(" / ")}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}: chips shown after the explanation  (${problems.join("; ") || `notice: ${r.notice ?? "none"}; ${r.apiCalls} API calls`})`);
    consoleErrors = [];
  }

  const PATHS = [
    ["offline", { mode: "offline" }, { typedForm: false }],
    ["AI success", { mode: "ai", key: true, scenario: "ok" }, { typedForm: true }],
    ["AI safety-check fallback", { mode: "ai", key: true, scenario: "unsafe" }, { typedForm: true, notice: /failed safety checks/ }],
    ["AI HTTP 500", { mode: "ai", key: true, scenario: "http500" }, { typedForm: true, notice: /unavailable \(HTTP 500\)/ }],
    ["AI network error", { mode: "ai", key: true, scenario: "network" }, { typedForm: true, notice: /unavailable \(network error\)/ }],
    ["AI mode, no key", { mode: "ai", key: false }, { typedForm: true, notice: /needs an API key/ }],
  ];
  for (const postId of ["p2", "p5"]) {
    for (const [name, setup, expect] of PATHS) {
      await loadWith(setup);
      check(`${postId} ${name}`, await evaluate(INSPECT(postId, true)), expect);
    }
  }

  await loadWith({ mode: "offline", key: true, scenario: "ok" });
  await evaluate(INSPECT("p2", true));
  await evaluate(`(() => { const r = document.querySelector('input[name="mode"][value="ai"]'); r.checked = true; r.dispatchEvent(new Event("change")); })()`);
  check("p2 switched to AI while open", await evaluate(INSPECT("p2", false)), { typedForm: true });
} catch (err) {
  failed++;
  total++;
  console.log(`FAIL  headless run: ${err.message}`);
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
