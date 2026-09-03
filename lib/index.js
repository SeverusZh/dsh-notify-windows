// dsh-notify-windows — DeepSeek Harness plugin: send a Windows toast when the
// agent needs attention: turn/end (completed/failed/cut off, with optional
// excerpt), approval/asked (only when the effective policy is "ask"), and
// tool/call ask_user_question (directly or inside run_code). Toasts are
// clickable by default (openOnClick) and deep-link to the conversation; goal
// rounds are quiet unless the final round completes or blocks. Zero runtime
// dependencies: toasts go through ./notify.ps1 via Windows PowerShell 5.1.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NOTIFY_SCRIPT = fileURLToPath(new URL("./notify.ps1", import.meta.url));
const VERSION = "0.7.3";

// wslpath rewrites Linux paths to \\wsl.localhost\... so powershell.exe (a
// Windows process) can read them; on native Windows wslpath is absent and the
// path is used unchanged. Cached once: NOTIFY_SCRIPT never changes.
const winPath = (p) => {
  const r = spawnSync("wslpath", ["-w", p], { encoding: "utf8" });
  return r.status === 0 && r.stdout ? r.stdout.trim() : p;
};
const NOTIFY_SCRIPT_WIN = winPath(NOTIFY_SCRIPT);

// Prefer the fixed /mnt/c location on WSL (minimal PATH under systemd/cron/ssh
// would make spawn("powershell.exe") fail with ENOENT); fall back to PATH on
// native Windows where /mnt/c does not exist.
const WSL_POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const resolvePowerShell = () => (existsSync(WSL_POWERSHELL) ? WSL_POWERSHELL : "powershell.exe");
const POWERSHELL = resolvePowerShell();

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

/** JSON.parse that never throws. */
const safeParse = (json) => {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};

/** First question text of an ask_user_question tool call, if parseable. */
function extractAskQuestion(argumentsJson) {
  const parsed = safeParse(argumentsJson);
  const first = Array.isArray(parsed?.questions) ? parsed.questions[0] : undefined;
  return typeof first?.question === "string" ? first.question : undefined;
}

/**
 * This deployment invokes every tool through run_code programs, so a real
 * question never appears as a model-level ask_user_question call. Detect the
 * nested call inside the program code and pull out the first question text.
 */
function extractQuestionFromCode(argumentsJson) {
  const parsed = safeParse(argumentsJson);
  const code = typeof parsed?.code === "string" ? parsed.code : "";
  const callIndex = code.search(/tools\.ask_user_question\s*\(/);
  if (callIndex < 0) return undefined;
  const region = code.slice(callIndex, callIndex + 8000);
  const matches = [...region.matchAll(/question\s*:\s*["']([^"']{2,200})["']/g)];
  return matches.length > 0 ? matches[0][1] : undefined;
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
    // Walking backwards, the final value is the FIRST message of the turn.
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
    openOnClick: true, // false: never make toasts clickable (never pass -Url)
    preferExisting: true, // true -> -LaunchProtocol 1; false -> 0
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

  // Always loopback: ctx.webServer.host may be 0.0.0.0, which is not a valid
  // browser target. Use the actual bound port (correct even when config port=0).
  const webBaseUrl = () => {
    if (cfg.webUrl) return cfg.webUrl.replace(/\/+$/, "");
    const port = ctx.get?.("webServer")?.port;
    return Number.isInteger(port) && port > 0 ? "http://127.0.0.1:" + port : "http://127.0.0.1:3080";
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
      NOTIFY_SCRIPT_WIN,
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
      args.push("-Url", conversationUrl(sessionId), "-LaunchProtocol", cfg.preferExisting ? 1 : 0);
    }
    // PowerShell 5.1 exits 0 even when -File cannot load the script, so the
    // exit code alone cannot tell success: notify.ps1 prints "toast shown"
    // only after the WinRT Show() call returns — that is our success marker.
    const child = spawn(POWERSHELL, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      log({ event: "error", message: String(error?.message ?? error) });
      ctx.logger?.warn?.("dsh-notify: 启动通知进程失败", error);
    });
    child.on("exit", (code) => {
      const shown = /toast shown/.test(stdout);
      if (code !== 0 || !shown) {
        log({
          event: "error",
          code,
          shown,
          stdout: stdout.slice(0, 500),
          stderr: stderr.slice(0, 500),
        });
        ctx.logger?.warn?.("dsh-notify: 通知进程未成功显示 toast" + (code !== null ? "（退出码 " + code + "）" : ""));
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

  /**
   * True for subagent sessions when subagents are excluded. DSH stamps
   * delegationDepth on the session header: main sessions carry 0 (and RESTORED
   * headers always include it), subagents >= 1. Testing `!== undefined` would
   * misclassify every restored main session as a subagent and silently kill
   * all notifications after a dsh web restart.
   */
  const isFilteredSession = (session) => {
    if (cfg.includeSubagents) return false;
    return session?.header?.origin === "subagent" || (session?.header?.delegationDepth ?? 0) > 0;
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

  /** Log a session event with the click-to-open url when applicable. */
  const logEvent = (event, sessionId, entry) => {
    const url = cfg.openOnClick && sessionId ? conversationUrl(sessionId) : undefined;
    log({ event, sessionId, ...entry, ...(url ? { url } : {}) });
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
      logEvent("notify", session?.id, {
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
      sendToast(cfg.appName + " · 需要审批", body, { sessionId: session?.id });
      logEvent("approval", session?.id, {
        id: data.id,
        toolName: data.toolName,
        reason: data.reason,
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
        logEvent("ask-user", session?.id, { question: question ?? null });
      }
      return;
    }
  });

  // Startup self-check: if the notification channel is broken (powershell.exe
  // unreachable or notify.ps1 missing), say so immediately instead of letting
  // every toast fail silently later.
  const channelOk = existsSync(NOTIFY_SCRIPT) && (POWERSHELL === "powershell.exe" || existsSync(POWERSHELL));
  log({
    event: "start",
    version: VERSION,
    enabled: cfg.enabled,
    reasons: [...reasons],
    powershell: POWERSHELL,
    notifyScript: NOTIFY_SCRIPT_WIN,
    channelOk,
    sessionId: null,
  });
  if (cfg.enabled && !channelOk) {
    ctx.logger?.warn?.("dsh-notify: 通知通道不可用（powershell.exe 或 notify.ps1 缺失），桌面通知将不会发送");
  }
  if (cfg.enabled && cfg.notifyOnStart) {
    // Activation toast has no session: leave non-clickable (legacy behavior).
    sendToast(cfg.appName, "任务完成提醒已激活（v" + VERSION + "）");
  }
}
