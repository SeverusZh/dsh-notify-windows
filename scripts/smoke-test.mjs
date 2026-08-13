// Smoke test for dsh-notify-windows v0.5.0: applies the plugin to a bare cordis
// Context and feeds it synthetic session events. Expected: four real Windows
// toasts (completion with excerpt, goal-final completion, approval, question)
// plus filtered cases (subagent, never-policy, unrelated call, quiet goal
// round).
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

let seqCounter = 1;
const ev = (type, data) => ({ type, seq: seqCounter++, time: Date.now(), data });
const asst = (turn, text) => ev("assistant/message", { turn, step: 1, message: { id: "m" + turn, role: "assistant", content: [{ type: "text", text }], source: { kind: "model" } } });
const turnEnd = (turn, kind) => ev("turn/end", { turn, reason: { kind } });

// 1) normal completed turn WITH assistant text -> toast with excerpt
const mainSession = { id: "smoke-main", header: {}, events: [] };
mainSession.events.push(ev("turn/start", { turn: 1 }));
mainSession.events.push(ev("user/message", { id: "u1", role: "user", content: [{ type: "text", text: "帮我构建一个插件" }], source: { kind: "user" } }));
mainSession.events.push(asst(1, "插件已构建完成，包含提醒、审批与提问通知三个能力，并通过了冒烟测试。"));
mainSession.events.push(turnEnd(1, "completed"));
ctx.emit("session/event", mainSession, mainSession.events[mainSession.events.length - 1]);

// 2) subagent session -> filtered
const subSession = { id: "smoke-sub", header: { origin: "subagent", depth: 1 }, events: [] };
ctx.emit("session/event", subSession, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));

// 3) quiet goal round (goal continuation, no terminal goal/change) -> filtered
const goalQuiet = { id: "smoke-goal-quiet", header: {}, events: [] };
goalQuiet.events.push(ev("turn/start", { turn: 5 }));
goalQuiet.events.push(ev("user/message", { id: "g1", role: "user", content: [{ type: "text", text: "Continue working toward the objective..." }], source: { kind: "goal", goalId: "g", revision: 1, round: 5 } }));
goalQuiet.events.push(asst(5, "本轮继续推进目标。"));
goalQuiet.events.push(turnEnd(5, "completed"));
ctx.emit("session/event", goalQuiet, goalQuiet.events[goalQuiet.events.length - 1]);

// 4) final goal round (goal/change complete in window) -> toast
const goalFinal = { id: "smoke-goal-final", header: {}, events: [] };
goalFinal.events.push(ev("turn/start", { turn: 6 }));
goalFinal.events.push(ev("user/message", { id: "g2", role: "user", content: [{ type: "text", text: "Continue working toward the objective..." }], source: { kind: "goal", goalId: "g", revision: 2, round: 6 } }));
goalFinal.events.push(ev("goal/change", { operation: "complete", goal: { id: "g", revision: 2 } }));
goalFinal.events.push(asst(6, "目标已完成。"));
goalFinal.events.push(turnEnd(6, "completed"));
ctx.emit("session/event", goalFinal, goalFinal.events[goalFinal.events.length - 1]);

// 5) approval/asked on main session (default policy = ask) -> toast
ctx.emit("session/event", mainSession, ev("approval/asked", { id: "a1", toolName: "pwsh", reason: "需要更宽的沙箱权限" }));

// 6) approval/asked on a never-policy session -> filtered
const neverSession = { id: "smoke-never", header: {}, events: [{ type: "approval/policy", data: { policy: "never" } }] };
ctx.emit("session/event", neverSession, ev("approval/asked", { id: "a2", toolName: "pwsh" }));

// 7) direct ask_user_question tool call -> toast
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 1, callId: "c1", name: "ask_user_question", arguments: JSON.stringify({ questions: [{ id: "q1", question: "是否继续？" }] }) }));

// 8) run_code program that calls the ask_user_question tool API -> toast
const code = 'const r = await tools.ask_user_question({questions: [{id: "q2", question: "需要你的批准吗？"}]});';
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 2, callId: "c2", name: "run_code", arguments: JSON.stringify({ code, description: "ask user" }) }));

// 9) unrelated tool call -> filtered
ctx.emit("session/event", mainSession, ev("tool/call", { turn: 3, step: 3, callId: "c3", name: "read", arguments: "{}" }));

console.log("[smoke] events emitted, waiting for toast processes...");
await new Promise((resolve) => setTimeout(resolve, 6000));

const text = readFileSync(logPath, "utf8");
const linesOfLog = text.trim().split("\n").filter(Boolean);
console.log("--- notify.log (new entries) ---");
console.log(linesOfLog.slice(before).join("\n"));
const entries = linesOfLog.slice(before).map((line) => JSON.parse(line));
const count = (kind) => entries.filter((e) => e.event === kind).length;
const completedNotifies = entries.filter((e) => e.event === "notify");
const excerptOk = completedNotifies.some((e) => (e.body ?? "").includes("插件已构建完成"));
const goalQuietOk = !entries.some((e) => e.sessionId === "smoke-goal-quiet");
const ok = count("notify") === 2 && count("approval") === 1 && count("ask-user") === 2 && count("error") === 0 && excerptOk && goalQuietOk;
console.log("[smoke] notify=" + count("notify") + " approval=" + count("approval") + " ask-user=" + count("ask-user") + " error=" + count("error") + " excerptOk=" + excerptOk + " goalQuietOk=" + goalQuietOk);
console.log("[smoke] " + (ok ? "PASS" : "FAIL"));
if (!ok) process.exitCode = 1;
