/**
 * dsh-notify-windows 消融探针（ablation/probe.mjs）
 *
 * 用法：node ablation/probe.mjs <variant-id>
 *
 * 对每个变体在真实 Cordis Context 上挂载插件（config 变体用变体 config；
 * code 变体假设 patch 已应用、用默认 config），派发统一场景事件，断言：
 *   - loadOk：apply 不抛错；
 *   - 正向：保留模块仍产生日志行（corePass）；
 *   - 负向：被消融模块不产生日志行（ablationEffective）。
 *
 * 输出：单行 JSON { variant, loadOk, checks, pass, notes }。
 */
import { Context } from '@deepseek-ai/cordis'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { apply } from '../lib/index.js'

const LOG_PATH = path.join(os.tmpdir(), 'dsh-notify', 'notify.log')

/* ------------------------------------------------------------------ *
 * 变体矩阵：期望断言
 * ------------------------------------------------------------------ */

const VARIANTS = {
  // ---- config 变体（软消融）----
  'M1-config': {
    config: { reasons: [] },
    expect: { notify: 0, approval: 1, 'ask-user': 1 },
    note: 'reasons=[] → turn/end 全部 reason 不通知',
  },
  'M2-config': {
    config: { notifyOnApproval: false },
    expect: { notify: 1, approval: 0, 'ask-user': 1 },
    note: 'notifyOnApproval=false → 审批不通知',
  },
  'M3-config': {
    config: { notifyOnAskUser: false },
    expect: { notify: 1, approval: 1, 'ask-user': 0 },
    note: 'notifyOnAskUser=false → 提问不通知',
  },
  'M4-config': {
    config: { excerpt: false },
    expect: { notify: 1, noExcerpt: true },
    note: 'excerpt=false → notify 行 body 不含摘录',
  },
  'M5-config': {
    config: { openOnClick: false },
    expect: { notify: 1, noUrl: true },
    note: 'openOnClick=false → notify 行无 url 字段',
  },
  'M6-config': {
    config: { notifyOnGoalRounds: true },
    expect: { goalQuiet: false },
    note: 'notifyOnGoalRounds=true → 消融 goal 静默，非终态 goal 轮也通知',
  },
  'M7-config': {
    config: { includeSubagents: true },
    expect: { subNotify: 1 },
    note: 'includeSubagents=true → 消融子代理过滤，子代理会话也通知',
  },
  'M8-config': {
    config: { notifyOnStart: false },
    expect: { startToast: 0 },
    note: 'notifyOnStart=false → 无激活 toast（默认即 false，验证无副作用）',
  },
  'M9-config': {
    config: { log: false },
    expect: { noLog: true },
    note: 'log=false → 消融日志，无任何日志行',
  },
  // ---- code 变体（硬消融，patch 已应用）----
  'M1-code': {
    config: {},
    expect: { notify: 0, approval: 1, 'ask-user': 1 },
    note: '移除 turn/end 分支 → 完成不通知，其余保留',
  },
  'M2-code': {
    config: {},
    expect: { notify: 1, approval: 0, 'ask-user': 1 },
    note: '移除 approval/asked 分支 → 审批不通知，其余保留',
  },
  'M3-code': {
    config: {},
    expect: { notify: 1, approval: 1, 'ask-user': 0 },
    note: '移除 tool/call 分支 → 提问不通知，其余保留',
  },
  'M4-code': {
    config: {},
    expect: { notify: 1, noExcerpt: true },
    note: '移除 excerpt 逻辑 → notify 行 body 不含摘录',
  },
  'M5-code': {
    config: {},
    expect: { notify: 1, noUrl: true },
    note: '移除 openOnClick 逻辑 → notify 行无 url 字段',
  },
}

/* ------------------------------------------------------------------ *
 * 日志辅助
 * ------------------------------------------------------------------ */

function clearLog() {
  try {
    fs.rmSync(path.dirname(LOG_PATH), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function readLog() {
  try {
    return fs
      .readFileSync(LOG_PATH, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function linesWith(lines, event, sessionId) {
  return lines.filter(
    (line) => line.event === event && (sessionId === undefined || line.sessionId === sessionId),
  )
}

/* ------------------------------------------------------------------ *
 * 会话 stub 与事件字形（与 test/probe.test.mjs 一致）
 * ------------------------------------------------------------------ */

let sessionCounter = 0
let seqCounter = 1
function makeSession(overrides = {}) {
  return {
    id: 'sess-' + ++sessionCounter,
    header: { origin: 'main', delegationDepth: 0, cwd: '/tmp' },
    events: [],
    ...overrides,
  }
}

function ev(type, data, extra = {}) {
  return { seq: seqCounter++, time: Date.now(), type, data, ...extra }
}

function emitSessionEvent(ctx, session, event) {
  session.events.push(event)
  ctx.emit(session, 'session/event', session, event)
}

/* ------------------------------------------------------------------ *
 * 统一场景：主会话 completed turn + 审批 + 提问；子代理 turn；goal 轮
 * ------------------------------------------------------------------ */

async function runScenario(ctx) {
  // 1) 主会话 completed turn（含摘录文本）
  const main = makeSession()
  emitSessionEvent(ctx, main, ev('turn/start', { turn: 1 }))
  emitSessionEvent(ctx, main, ev('user/message', {
    role: 'user',
    content: [{ type: 'text', text: 'go' }],
    source: { kind: 'user' },
  }))
  emitSessionEvent(ctx, main, ev('assistant/message', {
    turn: 1,
    step: 0,
    message: { role: 'assistant', content: [{ type: 'text', text: '构建完成，全部测试通过。' }] },
  }))
  emitSessionEvent(ctx, main, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

  // 2) 审批（policy ask）
  const askSession = makeSession()
  askSession.events = [ev('approval/policy', { policy: 'ask' })]
  emitSessionEvent(ctx, askSession, ev('approval/asked', {
    id: 'appr-1',
    toolName: 'bash',
    reason: '需要写入构建产物',
  }))

  // 3) 提问（ask_user_question 直接调用）
  const askUser = makeSession()
  emitSessionEvent(ctx, askUser, ev('tool/call', {
    turn: 1,
    step: 0,
    callId: 'call-1',
    name: 'ask_user_question',
    arguments: JSON.stringify({ questions: [{ id: 'q1', question: '可以继续部署吗？' }] }),
  }))

  // 4) 子代理会话 completed turn
  const sub = makeSession({ header: { origin: 'subagent', delegationDepth: 1, cwd: '/tmp' } })
  emitSessionEvent(ctx, sub, ev('turn/start', { turn: 1 }))
  emitSessionEvent(ctx, sub, ev('user/message', {
    role: 'user',
    content: [{ type: 'text', text: 'sub' }],
    source: { kind: 'user' },
  }))
  emitSessionEvent(ctx, sub, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

  // 5) goal 轮（非终态 edit）
  const goal = makeSession()
  emitSessionEvent(ctx, goal, ev('turn/start', { turn: 1 }))
  emitSessionEvent(ctx, goal, ev('user/message', {
    role: 'user',
    content: [{ type: 'text', text: 'g' }],
    source: { kind: 'goal', goalId: 'g1', revision: 2, round: 1 },
  }))
  emitSessionEvent(ctx, goal, ev('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'edit',
    goal: { id: 'g1', revision: 2, objective: 'x', phase: 'active' },
    roundsStarted: 1,
    createdAt: 1,
    updatedAt: 2,
  }))
  emitSessionEvent(ctx, goal, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

  return { main, askSession, askUser, sub, goal }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

const variantId = process.argv[2]
if (!variantId || !VARIANTS[variantId]) {
  console.error('usage: node ablation/probe.mjs <variant-id>')
  console.error('variants: ' + Object.keys(VARIANTS).join(', '))
  process.exit(2)
}

const variant = VARIANTS[variantId]
const result = { variant: variantId, loadOk: false, checks: {}, pass: false, note: variant.note }

clearLog()
let ctx
try {
  ctx = new Context()
  await ctx.plugin(apply, { log: true, appName: 'ProbeNotify', excerptMaxChars: 10, ...variant.config })
  result.loadOk = true
} catch (err) {
  result.checks.load = 'FAIL: ' + String(err?.message ?? err)
  console.log(JSON.stringify(result))
  process.exit(0)
}

try {
  const { main, askSession, askUser, sub, goal } = await runScenario(ctx)
  const lines = readLog()
  const expect = variant.expect

  // 通用断言
  if (expect.notify !== undefined) {
    const n = linesWith(lines, 'notify', main.id).length
    result.checks['notify(main)'] = n === expect.notify ? 'ok' : `FAIL: expected ${expect.notify}, got ${n}`
  }
  if (expect.approval !== undefined) {
    const n = linesWith(lines, 'approval', askSession.id).length
    result.checks['approval(ask)'] = n === expect.approval ? 'ok' : `FAIL: expected ${expect.approval}, got ${n}`
  }
  if (expect['ask-user'] !== undefined) {
    const n = linesWith(lines, 'ask-user', askUser.id).length
    result.checks['ask-user'] = n === expect['ask-user'] ? 'ok' : `FAIL: expected ${expect['ask-user']}, got ${n}`
  }
  if (expect.noExcerpt !== undefined) {
    const notify = linesWith(lines, 'notify', main.id)[0]
    const hasExcerpt = notify && /构建完成/.test(notify.body)
    result.checks['no-excerpt'] = expect.noExcerpt ? (hasExcerpt ? 'FAIL: excerpt still present' : 'ok') : 'n/a'
  }
  if (expect.noUrl !== undefined) {
    const notify = linesWith(lines, 'notify', main.id)[0]
    result.checks['no-url'] = expect.noUrl ? (notify && notify.url ? 'FAIL: url still present' : 'ok') : 'n/a'
  }
  if (expect.goalQuiet !== undefined) {
    const n = linesWith(lines, 'notify', goal.id).length
    // goalQuiet=false 表示消融了静默 → goal 轮应通知（n>=1）
    result.checks['goal-quiet-ablated'] = expect.goalQuiet ? (n === 0 ? 'ok' : `FAIL: expected quiet, got ${n}`) : (n >= 1 ? 'ok' : `FAIL: expected notify, got ${n}`)
  }
  if (expect.subNotify !== undefined) {
    const n = linesWith(lines, 'notify', sub.id).length
    result.checks['subagent-notify'] = n === expect.subNotify ? 'ok' : `FAIL: expected ${expect.subNotify}, got ${n}`
  }
  if (expect.startToast !== undefined) {
    // 激活 toast 无 sessionId；start 行总是写（log=true）。startToast 检查 notify 行总数中无 sessionId 的行。
    const noSession = lines.filter((l) => l.event === 'notify' && l.sessionId === undefined).length
    result.checks['start-toast'] = noSession === expect.startToast ? 'ok' : `FAIL: expected ${expect.startToast}, got ${noSession}`
  }
  if (expect.noLog !== undefined) {
    result.checks['no-log'] = lines.length === 0 ? 'ok' : `FAIL: expected no log lines, got ${lines.length}`
  }

  result.pass = Object.values(result.checks).every((v) => v === 'ok')
} catch (err) {
  result.checks.scenario = 'FAIL: ' + String(err?.message ?? err)
  result.pass = false
} finally {
  await ctx.dispose?.()
}

console.log(JSON.stringify(result))
