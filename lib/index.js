// dsh-notify — DeepSeek Harness plugin: send a Windows toast notification
// whenever an agent turn ends (a task completes, fails, or is cut off).
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NOTIFY_SCRIPT = fileURLToPath(new URL("./notify.ps1", import.meta.url));

const REASON_TEXT = {
  completed: "任务已完成",
  error: "任务出错",
  "max-tokens": "输出达到 token 上限",
  aborted: "任务已取消",
  interrupted: "任务中断",
  blocked: "任务未开始",
};

export const name = "dsh-notify";

export default function dshNotify(ctx, config = {}) {
  const cfg = {
    enabled: true,
    reasons: ["completed", "error", "max-tokens"],
    includeSubagents: false,
    notifyOnStart: false,
    appName: "DeepSeek Harness",
    aumid: "DeepSeekHarness.Notify",
    log: true,
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

  ctx.on("session/event", (session, event) => {
    if (!cfg.enabled) return;
    if (event.type !== "turn/end") return;
    const reason = event.data?.reason;
    if (typeof reason?.kind !== "string" || !reasons.has(reason.kind)) return;
    if (!cfg.includeSubagents && (session?.header?.origin === "subagent" || session?.header?.depth !== undefined)) return;

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
  });

  log({ event: "start", enabled: cfg.enabled, reasons: [...reasons], sessionId: null });
  if (cfg.enabled && cfg.notifyOnStart) {
    sendToast(cfg.appName, "任务完成提醒已激活");
  }
}
