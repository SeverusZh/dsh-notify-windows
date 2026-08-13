// dsh-notify — DeepSeek Harness plugin: send a Windows toast notification
// whenever the agent needs the user's attention:
//   - turn/end          — a task completed, failed, or was cut off;
//   - approval/asked    — a permission approval is waiting (only when the
//                         session's effective approval policy is "ask");
//   - tool/call         — the agent called the ask_user_question tool and is
//                         waiting for an answer.
//
// Zero runtime dependencies: notifications go through the toast sender
// script (./notify.ps1) executed by Windows PowerShell 5.1, whose .NET
// Framework runtime supports the WinRT toast API.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NOTIFY_SCRIPT = fileURLToPath(new URL("./notify.ps1", import.meta.url));
const VERSION = "0.4.0";

const REASON_TEXT = {
  completed: "任务已完成",
  error: "任务出错",
  "max-tokens": "输出达到 token 上限",
  aborted: "任务已取消",
  interrupted: "任务中断",
  blocked: "任务未开始",
};

export const name = "dsh-notify";

function truncate(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** First question text of an ask_user_question tool call, if parseable. */
function extractAskQuestion(argumentsJson) {
  try {
    const parsed = JSON.parse(argumentsJson);
    const first = Array.isArray(parsed?.questions) ? parsed.questions[0] : undefined;
    return typeof first?.question === "string" ? first.question : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This deployment invokes every tool through run_code programs, so a real
 * question never appears as a model-level ask_user_question tool call.
 * Detect the nested call inside a run_code program's code and pull out the
 * first question text.
 */
function extractQuestionFromCode(argumentsJson) {
  try {
    const parsed = JSON.parse(argumentsJson);
    const code = typeof parsed?.code === "string" ? parsed.code : "";
    const callIndex = code.search(/tools\.ask_user_question\s*\(/);
    if (callIndex < 0) return undefined;
    const region = code.slice(callIndex, callIndex + 8000);
    const matches = [...region.matchAll(/question\s*:\s*["']([^"']{2,200})["']/g)];
    return matches.length > 0 ? matches[0][1] : undefined;
  } catch {
    return undefined;
  }
}

export default function dshNotify(ctx, config = {}) {
  const cfg = {
    enabled: true,
    reasons: ["completed", "error", "max-tokens"],
    includeSubagents: false,
    notifyOnStart: false,
    notifyOnApproval: true,
    notifyOnAskUser: true,
    appName: "DeepSeek Harness",
    aumid: "DeepSeekHarness.Notify",
    log: true,
    debug: false,
    ...config,
  };
  const reasons = new Set(cfg.reasons);
  const logPath = join(tmpdir(), "dsh-notify", "notify.log");

  const log = (entry) => {
    if (!cfg.log) return;
    try {
      mkdirSync(join(tmpdir(), "dsh-notify"), { recursive: true });
      appendFileSync(logPath, JSON.stringify({ time: Date.now(), ...entry }) + "\n");
    } catch {
      // diagnostics must never break the agent loop
    }
  };

  const sendToast = (title, body) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        NOTIFY_SCRIPT,
        "-Title",
        title,
        "-Body",
        body,
        "-Aumid",
        cfg.aumid,
        "-AppName",
        cfg.appName,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    child.on("error", (error) => {
      log({ event: "error", message: String(error?.message ?? error) });
      ctx.logger?.warn?.("dsh-notify: 启动通知进程失败", error);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        log({ event: "error", code });
        ctx.logger?.warn?.("dsh-notify: 通知进程退出码 " + code);
      }
    });
  };

  const titleFor = (session) => {
    try {
      return ctx.sessionTitle?.get?.(session)?.title;
    } catch {
      return undefined;
    }
  };

  /** True for subagent sessions when subagents are excluded. */
  const isFilteredSession = (session) => {
    if (cfg.includeSubagents) return false;
    return session?.header?.origin === "subagent" || session?.header?.depth !== undefined;
  };

  /** Last approval/policy event of the session, or undefined (defaults to ask). */
  const effectivePolicy = (session) => {
    const events = session?.events ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === "approval/policy") return event.data?.policy;
    }
    return undefined;
  };

  ctx.on("session/event", (session, event) => {
    if (!cfg.enabled) return;
    if (cfg.debug) {
      log({ event: "debug", type: event.type, name: event.data?.name ?? null, sessionId: session?.id });
    }
    if (isFilteredSession(session)) return;

    if (event.type === "turn/end") {
      const reason = event.data?.reason;
      if (typeof reason?.kind !== "string" || !reasons.has(reason.kind)) return;
      const title = titleFor(session) || cfg.appName;
      const body = REASON_TEXT[reason.kind] ?? "任务已结束";
      sendToast(title, body + (Number.isInteger(event.data.turn) ? "（第 " + event.data.turn + " 轮）" : ""));
      log({
        event: "notify",
        sessionId: session?.id,
        reason: reason.kind,
        turn: event.data?.turn,
        title,
        body,
      });
      return;
    }

    if (event.type === "approval/asked" && cfg.notifyOnApproval) {
      // Never notify when the session policy auto-rejects: nothing waits for
      // the user, so a toast would be noise.
      if (effectivePolicy(session) === "never") return;
      const data = event.data ?? {};
      const body = typeof data.toolName === "string"
        ? (typeof data.reason === "string" && data.reason.length > 0
          ? "工具 " + data.toolName + "：" + truncate(data.reason, 100)
          : "工具 " + data.toolName)
        : "有一项操作等待你的批准";
      sendToast(cfg.appName + " · 需要审批", body);
      log({ event: "approval", sessionId: session?.id, id: data.id, toolName: data.toolName, reason: data.reason });
      return;
    }

    if (event.type === "tool/call" && cfg.notifyOnAskUser) {
      const data = event.data ?? {};
      let question;
      if (data.name === "ask_user_question") {
        question = extractAskQuestion(data.arguments);
      } else if (data.name === "run_code" && typeof data.arguments === "string" && data.arguments.includes("ask_user_question")) {
        question = extractQuestionFromCode(data.arguments);
      }
      if (question !== undefined || data.name === "ask_user_question") {
        sendToast(cfg.appName + " · 需要回答", question ? truncate(question, 100) : "Agent 正在等待你的确认");
        log({ event: "ask-user", sessionId: session?.id, question: question ?? null });
      }
      return;
    }
  });

  log({ event: "start", version: VERSION, enabled: cfg.enabled, reasons: [...reasons], sessionId: null });
  if (cfg.enabled && cfg.notifyOnStart) {
    sendToast(cfg.appName, "任务完成提醒已激活（v" + VERSION + "）");
  }
}