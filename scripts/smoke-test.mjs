// Smoke test for dsh-notify: applies the plugin to a bare cordis Context and
// feeds it synthetic session events. Expected result: two real Windows toasts
// (completed + error) and a log file recording exactly those two notifications.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { Context } = await import(pathToFileURL("E:/DeepSeekHarness/node_modules/@deepseek-ai/cordis/lib/index.js").href);
const { default: dshNotify } = await import(pathToFileURL("E:/MyProjectCollection/DSH提醒插件/lib/index.js").href);

const logPath = join(tmpdir(), "dsh-notify", "notify.log");

const ctx = new Context();
await ctx.plugin(dshNotify, { log: true, notifyOnStart: false });
console.log("[smoke] plugin applied");

const mainSession = { id: "smoke-main", header: {}, events: [] };
const subSession = { id: "smoke-sub", header: { origin: "subagent", depth: 1 }, events: [] };

const ev = (turn, reason) => ({ type: "turn/end", seq: 100 + turn, time: Date.now(), data: { turn, reason } });

ctx.emit("session/event", mainSession, ev(1, { kind: "completed" })); // -> toast
ctx.emit("session/event", subSession, ev(2, { kind: "completed" })); // -> filtered
ctx.emit("session/event", mainSession, ev(3, { kind: "blocked" }));   // -> filtered
ctx.emit("session/event", mainSession, ev(4, { kind: "error", error: { code: "X", message: "x" } })); // -> toast

console.log("[smoke] events emitted, waiting for toast processes...");
await new Promise((resolve) => setTimeout(resolve, 4000));

const text = readFileSync(logPath, "utf8");
console.log("--- notify.log ---");
console.log(text.trim());
const notifies = text.trim().split("\n").filter((line) => line.includes('"event":"notify"'));
const errors = text.trim().split("\n").filter((line) => line.includes('"event":"error"'));
console.log("[smoke] notify entries: " + notifies.length + " (expect 2), error entries: " + errors.length + " (expect 0)");
if (notifies.length === 2 && errors.length === 0) {
  console.log("[smoke] PASS");
} else {
  console.log("[smoke] FAIL");
  process.exitCode = 1;
}
