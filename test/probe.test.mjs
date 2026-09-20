/**
 * dsh-notify-windows —— 真实-Cordis 探针（test/probe.test.mjs）
 *
 * 在真实 @deepseek-ai/cordis Context 上挂载插件（apply(ctx, config)），用
 * alpha.4（0.1.2-alpha.4）核实过的会话事件字形合成 session stub，经
 * `session/event` 火线派发（与宿主一致：`ctx.emit(sessionCarrier,
 * 'session/event', session, event)`），断言插件 JSONL 日志（<tmpdir>/dsh-notify/notify.log）
 * 的 notify / approval / ask-user 行与过滤行为。
 *
 * 事件字形核对源（harness-src @ 0.1.2-alpha.4）：
 *   - turn/end:      { turn, reason: { kind: 'completed'|'error'|'max-tokens'|... } }
 *   - user/message:  UserMessage（source.kind 'goal' 带 round）
 *   - goal/change:   { kind:'goal/change', version:1, operation: 'complete'|'block'|... }
 *   - assistant/message: { turn, step, message }
 *   - tool/call:     { turn, step, callId, name, arguments }
 *   - approval/asked:  { id, toolName, callId?, reason? }
 *   - approval/policy: { policy: 'ask'|'never', source? }
 *   - session.header:  { origin?: 'subagent', delegationDepth?: number }
 *
 * Linux（本机 WSL）无 Windows toast 通道，sendToast 静默失败——本探针只断言
 * 日志行，不断言真实 toast。
 *
 * 运行：node --test test/probe.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'

import { apply, sessionEvents } from '../lib/index.js'

const LOG_PATH = path.join(os.tmpdir(), 'dsh-notify', 'notify.log')

/* ------------------------------------------------------------------ *
 * 日志辅助
 * ------------------------------------------------------------------ */

function clearLog() {
  try {
    fs.rmSync(path.dirname(LOG_PATH), { recursive: true, force: true })
  } catch {
    // 目录不存在等，忽略
  }
}

/** 读取全部 JSONL 行（文件不存在 → []）。 */
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

/** 按事件名 + sessionId 过滤日志行。 */
function linesWith(lines, event, sessionId) {
  return lines.filter(
    (line) => line.event === event && (sessionId === undefined || line.sessionId === sessionId),
  )
}

/* ------------------------------------------------------------------ *
 * 会话 stub 与事件字形
 * ------------------------------------------------------------------ */

// 会话 id 与事件 seq 使用独立计数器：ev() 的 seqCounter 会被场景事件序列重置，
// 若共用会让 makeSession 的 id 撞车（linesWith 按 sessionId 过滤时无法区分）。
let sessionCounter = 0
let seqCounter = 1
function makeSession(overrides = {}) {
  return {
    id: 'sess-' + (++sessionCounter),
    header: { origin: 'main', delegationDepth: 0, cwd: '/tmp' },
    events: [],
    ...overrides,
  }
}

/**
 * DSH 0.1.2-alpha.4+ 式会话：无公开 `events` 属性（该属性自 0.1.2-alpha.4 起已被移除），
 * 历史经 `snapshotEvents()` 按需读取（契约核实自 npm 上 `@deepseek-ai/dsh-session`
 * 0.1.2-alpha.4 / 0.1.5-rc.2 的 lib/index.js 与 lib/types/index.d.ts：
 *  `snapshotEvents(...): readonly SessionEvent[]`）。用 class 方法而非箭头函数：
 * this 绑定若被写坏，测试必须变红。_log 仅供测试写入。
 */
class ModernSession {
  constructor(overrides = {}) {
    this.id = 'sess-' + (++sessionCounter)
    this.header = { origin: 'main', delegationDepth: 0, cwd: '/tmp' }
    this._log = []
    Object.assign(this, overrides)
  }
  snapshotEvents() {
    return this._log.slice()
  }
}
function makeModernSession(overrides = {}) {
  return new ModernSession(overrides)
}

function ev(type, data, extra = {}) {
  return { seq: seqCounter++, time: Date.now(), type, data, ...extra }
}

/** 一个完整 turn 的会话事件序列（alpha.4 字形）。 */
function completedTurnEvents({ turn = 1, userSource = { kind: 'user' }, goalOps = [], lastText = '构建完成，全部测试通过。' } = {}) {
  seqCounter = 1
  const events = [
    ev('turn/start', { turn }),
    ev('user/message', { role: 'user', content: [{ type: 'text', text: '跑一下构建' }], source: userSource }),
    ...goalOps.map((operation) => ev('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation,
      goal: { id: 'g1', revision: 2, objective: 'x', phase: 'active' },
      roundsStarted: 1,
      createdAt: 1,
      updatedAt: 2,
    })),
    ev('assistant/message', {
      turn,
      step: 0,
      message: { role: 'assistant', content: [{ type: 'text', text: lastText }] },
    }),
    ev('turn/end', { turn, reason: { kind: 'completed' } }),
  ]
  return events
}

/* ------------------------------------------------------------------ *
 * 装配
 * ------------------------------------------------------------------ */

async function boot(cfg = {}) {
  const ctx = new Context()
  await ctx.plugin(apply, { log: true, appName: 'ProbeNotify', ...cfg })
  return ctx
}

/**
 * 与宿主一致：以 session 为载体的 session/event 派发。真实宿主的 session
 * append 先把事件写入会话日志再经火线广播，故此处同步把事件推入
 * session.events（插件的 turnWindow / effectivePolicy 正向扫描该数组）。
 */
function emitSessionEvent(ctx, session, event) {
  session.events.push(event)
  ctx.emit(session, 'session/event', session, event)
}

/** 同上，但写入 0.1.2-alpha.4+ 式会话的私有日志（经 snapshotEvents() 暴露）。 */
function emitModernSessionEvent(ctx, session, event) {
  session._log.push(event)
  ctx.emit(session, 'session/event', session, event)
}

/* ------------------------------------------------------------------ *
 * 探针用例
 * ------------------------------------------------------------------ */

test('probe: 插件激活写 start 行，turn/end completed → notify 行（含标题/轮次/截断摘要）', async () => {
  clearLog()
  const ctx = await boot({ excerptMaxChars: 10 })
  try {
    const session = makeSession()
    emitSessionEvent(ctx, session, ev('turn/start', { turn: 1 }))
    emitSessionEvent(ctx, session, ev('user/message', {
      role: 'user',
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    emitSessionEvent(ctx, session, ev('assistant/message', {
      turn: 1,
      step: 0,
      message: { role: 'assistant', content: [{ type: 'text', text: '构建完成，全部测试通过。' }] },
    }))
    emitSessionEvent(ctx, session, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

    const lines = readLog()
    assert.ok(linesWith(lines, 'start').length === 1, 'activation must write a start line')
    const notifies = linesWith(lines, 'notify', session.id)
    assert.equal(notifies.length, 1, 'completed turn must notify')
    assert.equal(notifies[0].reason, 'completed')
    assert.equal(notifies[0].turn, 1)
    assert.match(notifies[0].body, /任务已完成/)
    // excerpt 截断：excerptMaxChars=10 → 前 10 字 + 省略号，且来自最后一条 assistant/message。
    assert.match(notifies[0].body, /构建完成，全部测试通…/)
    assert.equal(notifies[0].title, 'ProbeNotify')
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: turn/end 原因不在 reasons 配置内 → 不通知', async () => {
  clearLog()
  const ctx = await boot({ reasons: ['completed', 'error'] })
  try {
    const session = makeSession()
    emitSessionEvent(ctx, session, ev('turn/start', { turn: 1 }))
    emitSessionEvent(ctx, session, ev('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }))
    const lines = readLog()
    assert.equal(linesWith(lines, 'notify', session.id).length, 0)
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: 子代理会话过滤（includeSubagents=false 默认）——深度 ≥1 过滤、恢复主会话（深度 0）通知', async () => {
  clearLog()
  const ctx = await boot()
  try {
    const main = makeSession() // 持久化恢复的主会话：delegationDepth 0
    for (const event of completedTurnEvents()) emitSessionEvent(ctx, main, event)

    const sub = makeSession({ header: { origin: 'subagent', delegationDepth: 1, cwd: '/tmp' } })
    for (const event of completedTurnEvents({ lastText: '子代理结果' })) emitSessionEvent(ctx, sub, event)

    const lines = readLog()
    assert.equal(linesWith(lines, 'notify', main.id).length, 1, 'restored main session must notify')
    assert.equal(linesWith(lines, 'notify', sub.id).length, 0, 'subagent session must be filtered')
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: includeSubagents=true 时子代理会话也通知', async () => {
  clearLog()
  const ctx = await boot({ includeSubagents: true })
  try {
    const sub = makeSession({ header: { origin: 'subagent', delegationDepth: 2, cwd: '/tmp' } })
    for (const event of completedTurnEvents()) emitSessionEvent(ctx, sub, event)
    const lines = readLog()
    assert.equal(linesWith(lines, 'notify', sub.id).length, 1)
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: approval/asked + 有效策略 ask → approval 行；策略 never → 抑制', async () => {
  clearLog()
  const ctx = await boot()
  try {
    const askSession = makeSession()
    askSession.events = [
      ev('approval/policy', { policy: 'ask' }),
    ]
    emitSessionEvent(ctx, askSession, ev('approval/asked', {
      id: 'appr-ask-1',
      toolName: 'bash',
      reason: '需要写入构建产物',
    }))

    const neverSession = makeSession()
    neverSession.events = [
      ev('approval/policy', { policy: 'never' }),
    ]
    emitSessionEvent(ctx, neverSession, ev('approval/asked', {
      id: 'appr-never-1',
      toolName: 'bash',
      reason: '自动拒绝',
    }))

    const lines = readLog()
    const approvals = linesWith(lines, 'approval', askSession.id)
    assert.equal(approvals.length, 1, 'ask policy must notify')
    assert.equal(approvals[0].id, 'appr-ask-1')
    assert.equal(approvals[0].toolName, 'bash')
    assert.match(approvals[0].reason, /构建产物/)
    assert.equal(linesWith(lines, 'approval', neverSession.id).length, 0, 'never policy must suppress')
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: goal 轮静默——终态 op complete → 通知；非终态 op → 抑制', async () => {
  clearLog()
  const ctx = await boot() // notifyOnGoalRounds 默认 false
  try {
    // 终态：goal 轮 + complete → 通知。
    const done = makeSession()
    for (const event of completedTurnEvents({
      userSource: { kind: 'goal', goalId: 'g1', revision: 2, round: 1 },
      goalOps: ['complete'],
    })) emitSessionEvent(ctx, done, event)

    // 非终态：goal 轮 + edit → 抑制。
    const running = makeSession()
    for (const event of completedTurnEvents({
      userSource: { kind: 'goal', goalId: 'g1', revision: 2, round: 2 },
      goalOps: ['edit'],
    })) emitSessionEvent(ctx, running, event)

    // 对照：人工 prompt 轮（非 goal）→ 通知。
    const human = makeSession()
    for (const event of completedTurnEvents()) emitSessionEvent(ctx, human, event)

    const lines = readLog()
    assert.equal(linesWith(lines, 'notify', done.id).length, 1, 'terminal goal round must notify')
    assert.equal(linesWith(lines, 'notify', running.id).length, 0, 'non-terminal goal round must stay quiet')
    assert.equal(linesWith(lines, 'notify', human.id).length, 1, 'human turn must notify')
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: ask_user_question 直接调用 → ask-user 行并提取问题；run_code 内嵌调用 → 提取；其它工具 → 无', async () => {
  clearLog()
  const ctx = await boot()
  try {
    const direct = makeSession()
    emitSessionEvent(ctx, direct, ev('tool/call', {
      turn: 1,
      step: 0,
      callId: 'call-1',
      name: 'ask_user_question',
      arguments: JSON.stringify({ questions: [{ id: 'q1', question: '可以继续部署吗？' }] }),
    }))

    const embedded = makeSession()
    emitSessionEvent(ctx, embedded, ev('tool/call', {
      turn: 1,
      step: 0,
      callId: 'call-2',
      name: 'run_code',
      arguments: JSON.stringify({
        code: 'const answer = tools.ask_user_question({ questions: [{ id: "q", question: "部署到生产？" }] });',
      }),
    }))

    const other = makeSession()
    emitSessionEvent(ctx, other, ev('tool/call', {
      turn: 1,
      step: 0,
      callId: 'call-3',
      name: 'bash',
      arguments: JSON.stringify({ command: 'ls' }),
    }))

    const lines = readLog()
    const directLines = linesWith(lines, 'ask-user', direct.id)
    assert.equal(directLines.length, 1)
    assert.equal(directLines[0].question, '可以继续部署吗？')
    const embeddedLines = linesWith(lines, 'ask-user', embedded.id)
    assert.equal(embeddedLines.length, 1)
    assert.equal(embeddedLines[0].question, '部署到生产？')
    assert.equal(linesWith(lines, 'ask-user', other.id).length, 0)
  } finally {
    await ctx.dispose?.()
  }
})

/* ------------------------------------------------------------------ *
 * sessionEvents()：跨 DSH 世代的历史读取
 * ------------------------------------------------------------------ */

test('sessionEvents: 旧 API（session.events）命中 → 直接返回该数组', () => {
  const events = [{ seq: 1 }]
  assert.equal(sessionEvents({ events }), events, 'legacy array must be used as-is')
})

test('sessionEvents: 新 API（snapshotEvents()）命中 → 返回数组', () => {
  const events = [{ seq: 2 }]
  assert.deepEqual(sessionEvents({ snapshotEvents: () => events }), events)
})

test('sessionEvents: 两者均不可用 → []（session 缺失亦不崩）', () => {
  assert.deepEqual(sessionEvents({}), [])
  assert.deepEqual(sessionEvents(undefined), [])
  assert.deepEqual(sessionEvents({ events: undefined, snapshotEvents: undefined }), [])
})

test('sessionEvents: snapshotEvents() 抛错 → 返回 []，绝不向上抛', () => {
  const throwing = { snapshotEvents: () => { throw new Error('host-side read failed') } }
  assert.deepEqual(sessionEvents(throwing), [])
  // 旧 API 非数组（字段存在但非数组）时同样回退新 API，而非把非数组当真值用。
  const events = [{ seq: 3 }]
  assert.equal(sessionEvents({ events: null, snapshotEvents: () => events }), events)
})

test('sessionEvents: 读取失败经 onUnavailable 上报（降级不再静默）', () => {
  const seen = []
  const report = (reason) => seen.push(reason)
  // 两条失败路径都必须上报：既没有旧 API、也没有新 API / 新 API 抛错。
  assert.deepEqual(sessionEvents({}, report), [])
  assert.deepEqual(sessionEvents({ snapshotEvents: () => { throw new Error('host-side read failed') } }, report), [])
  assert.equal(seen.length, 2)
  assert.match(seen[0], /neither events nor snapshotEvents/)
  assert.match(seen[1], /host-side read failed/)
  // 成功路径不得误报。
  let calls = 0
  sessionEvents({ events: [] }, () => { calls += 1 })
  sessionEvents({ snapshotEvents: () => [] }, () => { calls += 1 })
  assert.equal(calls, 0)
})

/* ------------------------------------------------------------------ *
 * 0.1.2-alpha.4+ 式会话端到端：仅 snapshotEvents() 时功能不降级
 * ------------------------------------------------------------------ */

test('probe: 0.1.2-alpha.4+ 式会话（仅 snapshotEvents()）— 摘要、/goal 终态、never 策略仍生效', async () => {
  clearLog()
  const ctx = await boot({ excerptMaxChars: 10 })
  try {
    // 摘要：turnWindow 经 snapshotEvents() 读到 assistant/message。
    const excerptSession = makeModernSession()
    for (const event of completedTurnEvents({ lastText: '构建完成，全部测试通过。' })) {
      emitModernSessionEvent(ctx, excerptSession, event)
    }

    // /goal 终态：userSource.kind='goal' 必须能被读到，complete 才通知。
    const goalDone = makeModernSession()
    for (const event of completedTurnEvents({
      userSource: { kind: 'goal', goalId: 'g1', revision: 2, round: 1 },
      goalOps: ['complete'],
    })) emitModernSessionEvent(ctx, goalDone, event)

    // /goal 非终态：应静默（读不到 userSource 时会误发，故此用例同时锁定降级回归）。
    const goalRunning = makeModernSession()
    for (const event of completedTurnEvents({
      userSource: { kind: 'goal', goalId: 'g1', revision: 2, round: 2 },
      goalOps: ['edit'],
    })) emitModernSessionEvent(ctx, goalRunning, event)

    // never 策略：effectivePolicy 经 snapshotEvents() 读到 approval/policy。
    const neverSession = makeModernSession()
    neverSession._log.push(ev('approval/policy', { policy: 'never' }))
    emitModernSessionEvent(ctx, neverSession, ev('approval/asked', {
      id: 'appr-never-modern',
      toolName: 'bash',
      reason: '自动拒绝',
    }))

    const lines = readLog()
    const notifies = linesWith(lines, 'notify', excerptSession.id)
    assert.equal(notifies.length, 1, 'modern session must still notify')
    assert.match(notifies[0].body, /构建完成，全部测试通…/, 'excerpt must come from snapshotEvents()')
    assert.equal(linesWith(lines, 'notify', goalDone.id).length, 1, 'terminal goal round must notify')
    assert.equal(linesWith(lines, 'notify', goalRunning.id).length, 0, 'non-terminal goal round must stay quiet')
    assert.equal(linesWith(lines, 'approval', neverSession.id).length, 0, 'never policy must suppress')
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: snapshotEvents() 抛错时通知照发，并写 history-unavailable 行（降级不静默）', async () => {
  clearLog()
  const ctx = await boot({ excerptMaxChars: 10 })
  try {
    const session = makeModernSession({
      snapshotEvents() {
        throw new Error('host-side read failed')
      },
    })
    for (const event of completedTurnEvents({ lastText: '这段历史读不到。' })) {
      emitModernSessionEvent(ctx, session, event)
    }

    const lines = readLog()
    assert.equal(linesWith(lines, 'notify', session.id).length, 1, 'notification path must survive a read failure')
    const degraded = linesWith(lines, 'history-unavailable', session.id)
    assert.ok(degraded.length >= 1, 'a failed history read must be logged')
    assert.match(degraded[0].reason, /host-side read failed/)
  } finally {
    await ctx.dispose?.()
  }
})

test('probe: approval 路径读历史失败也留痕（锁定 effectivePolicy 回调接线）', async () => {
  clearLog()
  const ctx = await boot()
  try {
    // 只派发 approval/asked（不发 turn/end）：此时唯一的 history-unavailable 来源就是
    // effectivePolicy —— 回调接线若丢失，本用例必须变红。
    const session = makeModernSession({
      snapshotEvents() {
        throw new Error('host-side read failed')
      },
    })
    emitModernSessionEvent(ctx, session, ev('approval/asked', {
      id: 'appr-throwing',
      toolName: 'bash',
      reason: '读不到历史',
    }))

    const lines = readLog()
    assert.equal(linesWith(lines, 'approval', session.id).length, 1, 'unknown policy falls back to ask -> notify')
    const degraded = linesWith(lines, 'history-unavailable', session.id)
    assert.ok(degraded.length >= 1, 'effectivePolicy must report the failed history read')
  } finally {
    await ctx.dispose?.()
  }
})
