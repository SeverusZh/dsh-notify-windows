// Smoke test for dsh-notify: applies the plugin to a bare cordis Context and
// feeds it synthetic session events. Expected result: three real Windows
// toasts (turn completion, approval ask, ask-user tool call) and a log file
// recording exactly those three plus filtered-out cases.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { Context } = await import(pathToFileURL("E:/DeepSeekHarness/node_modules/@deepseek-ai/cordis/lib/index.js").href);
const { default: dshNotify } = await import(pathToFileURL("E:/MyProjectCollection/dsh-notify-windows/lib/index.js").href);

const logPath = join(tmpdir(), "dsh-notify", "notify.log");

const ctx = new Context();
await ctx.plugin(dshNotify, { log: true, notifyOnStart: false });
console.log("[smoke] plugin applied");

// The log file is shared with the live host; snapshot the line count now and
// count only entries appended during this run.
const before = readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;

const mainSession = { id: "smoke-main", header: {}, events: [] };
const subSession = { id: "smoke-sub", header: { origin: "subagent", depth: 1 }, events: [] };
const neverSession = { id: "smoke-never", header: {}, events: [{ type: "approval/policy", data: { policy: "never" } }] };

const ev = (type, data) => ({ type, seq: 1, time: Date.now(), data });

// turn/end completed on main session -> toast
ctx.emit("session/event", mainSession, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));
// turn/end completed on subagent session -> filtered
ctx.emit("session/event", subSession, ev("turn/end", { turn: 2, reason: { kind: "completed" } }));
// approval/asked on main session (default policy = ask) -> toast
ctx.emit("session/event", mainSession, ev("approval/asked", { id: "a1", toolName: "pwsh", reason: "需要更宽的沙箱权限" }));
// approval/asked on a never-policy session -> filtered
ctx.emit("session/event", neverSession, ev("approval/asked", { id: "a2", toolName: "pwsh" }));
// direct ask_user_question tool call on main session -> toast
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 1, callId: "c1", name: "ask_user_question", arguments: JSON.stringify({ questions: [{ id: "q1", question: "是否继续？" }] }) }));
// run_code program that calls the ask_user_question tool API -> toast
const code = 'const r = await tools.ask_user_question({questions: [{id: "q2", question: "需要你的批准吗？"}]});';
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 2, callId: "c2", name: "run_code", arguments: JSON.stringify({ code, description: "ask user" }) }));
// run_code without a question -> filtered
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 3, callId: "c3", name: "run_code", arguments: JSON.stringify({ code: "console.log(1)", description: "noop" }) }));
// unrelated tool call -> filtered
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 4, callId: "c4", name: "read", arguments: "{}" }));

console.log("[smoke] events emitted, waiting for toast processes...");
await new Promise((resolve) => setTimeout(resolve, 5000));

const text = readFileSync(logPath, "utf8");
const lines = text.trim().split("\n").filter(Boolean);
console.log("--- notify.log (new entries) ---");
console.log(lines.slice(before).join("\n"));
const entries = lines.slice(before).map((line) => JSON.parse(line));
const count = (kind) => entries.filter((e) => e.event === kind).length;
const ok = count("notify") === 1 && count("approval") === 1 && count("ask-user") === 2 && count("error") === 0;
console.log("[smoke] notify=" + count("notify") + " approval=" + count("approval") + " ask-user=" + count("ask-user") + " error=" + count("error"));
console.log("[smoke] " + (ok ? "PASS" : "FAIL"));
if (!ok) process.exitCode = 1;