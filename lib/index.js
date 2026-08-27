// dsh-notify-windows — DeepSeek Harness plugin: send a Windows toast notification
// whenever the agent needs the user's attention:
//   - turn/end          — a task completed, failed, or was cut off (with an
//                         optional excerpt of the agent's final reply);
//   - approval/asked    — a permission approval is waiting (only when the
//                         session's effective approval policy is "ask");
//   - tool/call         — the agent called the ask_user_question tool (directly
//                         or inside a run_code program) and is waiting.
//
// Click-to-open: when enabled (default) and a session is available, the toast
// becomes clickable and opens the DSH web GUI (preferring an already-open
// browser/App window) deep-linked to that conversation. Disable with
// openOnClick:false or omit the session to keep the legacy non-clickable toast.
//
// Goal rounds (/goal auto-continuation) are quiet by default: only the final
// round that completes or blocks the goal produces a toast.
//
// Zero runtime dependencies: notifications go through the toast sender
// script (./notify.ps1) executed by Windows PowerShell 5.1, whose .NET
// Framework runtime supports the WinRT toast API.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NOTIFY_SCRIPT = fileURLToPath(new URL("./notify.ps1", import.meta.url));
const VERSION = "0.7.0";

// Convert a script path so powershell.exe can read it.
//   - On WSL: powershell.exe is a Windows process and can't read Linux paths
//     (e.g. /home/.../notify.ps1). wslpath -w rewrites it to a UNC path
//     (\\wsl.localhost\...) that Windows can access.
//   - On native Windows: wslpath does not exist, spawnSync fails with a
//     non-zero status, and we fall back to the original path unchanged, so
//     the native-Windows behaviour is preserved exactly.
const winPath = (p) => {
  const r = spawnSync("wslpath", ["-w", p], { encoding: "utf8" });
  return r.status === 0 && r.stdout ? r.stdout.trim() : p;
};

const REASON_TEXT = {
  completed: "任务已完成",
  error: "任务出错",
  "max-tokens": "输出达到 token 上限",
  aborted: "任务已取消",
  interrupted: "任务中断",
  blocked: "任务未开始",
};

export const name = "dsh-notify-windows";

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

/** First non-empty text block of a message, trimmed. */
function textOfMessage(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) return block.text.trim();
  }
  return undefined;
}

/**
 * Scan the session log from the turn/end event back to its turn/start and
 * collect what the notification needs: the driving user message's source,
 * every goal/change operation in the window, and the last assistant reply
 * text (for the excerpt).
 */
function turnWindow(session, turnEnd) {
  const events = session?.events ?? [];
  const turn = turnEnd?.data?.turn;
  let endIndex = events.length - 1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.seq === turnEnd?.seq) { endIndex = i; break; }
  }
  let userSource;
  const goalOps = [];
  let lastAssistantText;
  for (let i = endIndex; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "turn/start" && event.data?.turn === turn) break;
    // Every user/message in the window overwrites: walking backwards, the
    // final value is the FIRST message of the turn — the driving input.
    if (event.type === "user/message" && event.data?.source) userSource = event.data.source;
    if (event.type === "goal/change" && event.data?.operation) goalOps.push(event.data.operation);
    if (event.type === "assistant/message" && event.data?.turn === turn && lastAssistantText === undefined) {
      const text = textOfMessage(event.data.message);
      if (text) lastAssistantText = text;
    }
  }
  return { userSource, goalOps, lastAssistantText };
}

export const apply = (ctx, config = {}) => {
  const cfg = {
    enabled: true,
    reasons: ["completed", "error", "max-tokens"],
    includeSubagents: false,
    notifyOnStart: false,
    notifyOnApproval: true,
    notifyOnAskUser: true,
    notifyOnGoalRounds: false,
    excerpt: true,
    excerptMaxChars: 80,
    appName: "DeepSeek Harness",
    aumid: "DeepSeekHarness.Notify",
    log: true,
    debug: false,
    // Click-to-open feature (v0.7.0):
    openOnClick: true, // when false: never make toasts clickable (never pass -Url)
    preferExisting: true, // true -> -LaunchProtocol 1 (launcher, prefer existing window); false -> 0 (plain open)
    webUrl: "", // manual override of the web GUI base; empty = auto-discover
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

  // Authoritative base URL discovery (verified against rc.8).
  // Always loopback: ctx.webServer.host may be 0.0.0.0, which is not a valid
  // browser target. Use the actual bound port (correct even when config port=0).
  const webBaseUrl = () => {
    if (cfg.webUrl) return cfg.webUrl.replace(/\/+$/, "");
    try {
      const port = ctx.get?.("webServer")?.port; // actual bound port
      if (Number.isInteger(port) && port > 0) return "http://127.0.0.1:" + port;
    } catch {
      // fall through to documented default
    }
    return "http://127.0.0.1:3080"; // documented default (dsh-web-app patch.yml)
  };

  // Per-session deep link. rc.8 ignores the ?session= query but it is harmless
  // and future-proof for frontends that want to jump straight to a conversation.
  const conversationUrl = (sessionId) => {
    const base = webBaseUrl();
    if (!sessionId) return base + "/";
    return base + "/?session=" + encodeURIComponent(sessionId);
  };

  const sendToast = (title, body, opts = {}) => {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      winPath(NOTIFY_SCRIPT),
      "-Title",
      title,
      "-Body",
      body,
      "-Aumid",
      cfg.aumid,
      "-AppName",
      cfg.appName,
    ];
    const sessionId = opts?.sessionId;
    if (cfg.openOnClick && sessionId) {
      const url = conversationUrl(sessionId);
      args.push("-Url", url, "-LaunchProtocol", cfg.preferExisting ? 1 : 0);
    }
    const child = spawn("powershell.exe", args, { stdio: "ignore", windowsHide: true });
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
    return session?.header?.origin === "subagent" || session?.header?.delegationDepth !== undefined;
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
      const window = turnWindow(session, event);

      // /goal 自动推进回合默认静默：仅在目标完成/阻塞的最终回合提醒。
      if (!cfg.notifyOnGoalRounds) {
        const isGoalRound = window.userSource?.kind === "goal" && window.userSource.round > 0;
        const terminal = window.goalOps.some((op) => op === "complete" || op === "block");
        if (isGoalRound && !terminal) return;
      }

      const title = titleFor(session) || cfg.appName;
      let body = REASON_TEXT[reason.kind] ?? "任务已结束";
      if (Number.isInteger(event.data.turn)) body += "（第 " + event.data.turn + " 轮）";
      if (cfg.excerpt && window.lastAssistantText) {
        body += "\n" + truncate(window.lastAssistantText, cfg.excerptMaxChars);
      }
      sendToast(title, body, { sessionId: session?.id });
      const url = cfg.openOnClick && session?.id ? conversationUrl(session?.id) : undefined;
      log({
        event: "notify",
        sessionId: session?.id,
        reason: reason.kind,
        turn: event.data?.turn,
        title,
        body,
        ...(url ? { url } : {}),
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
      sendToast(cfg.appName + " · 需要审批", body, { sessionId: session?.id });
      const url = cfg.openOnClick && session?.id ? conversationUrl(session?.id) : undefined;
      log({
        event: "approval",
        sessionId: session?.id,
        id: data.id,
        toolName: data.toolName,
        reason: data.reason,
        ...(url ? { url } : {}),
      });
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
        sendToast(cfg.appName + " · 需要回答", question ? truncate(question, 100) : "Agent 正在等待你的确认", { sessionId: session?.id });
        const url = cfg.openOnClick && session?.id ? conversationUrl(session?.id) : undefined;
        log({
          event: "ask-user",
          sessionId: session?.id,
          question: question ?? null,
          ...(url ? { url } : {}),
        });
      }
      return;
    }
  });

  log({ event: "start", version: VERSION, enabled: cfg.enabled, reasons: [...reasons], sessionId: null });
  if (cfg.enabled && cfg.notifyOnStart) {
    // Activation toast has no session: leave non-clickable (legacy behavior).
    sendToast(cfg.appName, "任务完成提醒已激活（v" + VERSION + "）");
  }
}
