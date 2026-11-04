import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Bg, Cron, Fork, McpServer, McpStatus, Plan, Request, Gate, GateEvent, GateKind, Git, GitFile, Level, Live, LogLine, Mode, Perm, Sys, Todo, Touched, Usage } from '../types'

const PANE = 'prodash'
const MAX_LOGS = 500 // fixed ring: a long session never grows the buffer
const HIST = 24

const logs = atom({ plugin: 'prodash', key: 'logs' } as const, [] as LogLine[], { shape: 'logs-1' })
const forks = atom({ plugin: 'prodash', key: 'forks' } as const, [] as Fork[], { shape: 'forks-2' })
const sys = atom({ plugin: 'prodash', key: 'sys' } as const, { hist: [] } as Sys, { shape: 'sys-1' })
const usage = atom({ plugin: 'prodash', key: 'usage' } as const, { startedAt: 0, tokens: 0 } as Usage, { shape: 'usage-2' })
const mode = atom({ plugin: 'prodash', key: 'mode' } as const, 'main' as Mode)
const perms = atom({ plugin: 'prodash', key: 'perms' } as const, [] as Perm[], { shape: 'perms-1' })
const git = atom({ plugin: 'prodash', key: 'git' } as const, { isRepo: false, ahead: 0, behind: 0, stash: 0, files: [] } as Git, { shape: 'git-1' })
const liveInfo = atom({ plugin: 'prodash', key: 'live' } as const, { reqs: 0, isBusy: false, compactions: 0 } as Live, { shape: 'live-1' })
const EMPTY_GATE: Gate = {
  events: [], total: 0, counts: { a: 0, c: 0, h: 0, p: 0, d: 0 }, cats: { f: 0, s: 0, o: 0 },
  reads: 0, writes: 0, main: 0, forks: 0, rules: [], waitMs: 0, waits: 0,
}
const gate = atom({ plugin: 'prodash', key: 'gate' } as const, EMPTY_GATE, { shape: 'gate-1' })
const todos = atom({ plugin: 'prodash', key: 'todos' } as const, [] as Todo[], { shape: 'todos-2' })
const touched = atom({ plugin: 'prodash', key: 'touched' } as const, [] as Touched[], { shape: 'touched-1' })
const requests = atom({ plugin: 'prodash', key: 'requests' } as const, [] as Request[], { shape: 'requests-1' })
const plan = atom({ plugin: 'prodash', key: 'plan' } as const, null as Plan | null, { shape: 'plan-1' })
const bg = atom({ plugin: 'prodash', key: 'bg' } as const, [] as Bg[], { shape: 'bg-1' })
const mcp = atom({ plugin: 'prodash', key: 'mcp' } as const, [] as McpServer[], { shape: 'mcp-1' })
const crons = atom({ plugin: 'prodash', key: 'crons' } as const, [] as Cron[], { shape: 'crons-1' })

const STATUS_COLOR: Record<string, string> = {
  running: '#5fd75f',
  pending: '#ffd75f',
  waiting: '#ffd75f',
  idle: '#ffd75f',
}
const CYAN = '#5fd7d7'
const LIVE = ['pending', 'running', 'waiting', 'idle']

const bar = (pct: number, width: number) => {
  const n = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}
const spark = (values: number[], width = HIST) =>
  values.slice(-Math.max(1, width)).map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.max(0, Math.round((v / 100) * 7)))]).join('')
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`
}
// 56m 13s / 1h 4m / 9s
const span = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const hhmmss = (at: number) => new Date(at).toTimeString().slice(0, 8)
const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)
const loadColor = (pct: number) => (pct >= 90 ? '#ff5f5f' : pct >= 70 ? '#ffaf00' : '#5fd75f')
const push = (hist: number[], v: number) => [...hist, v].slice(-HIST)

// `git status --porcelain=v2 --branch --show-stash` -> Git (without repo/last/pr).
export function parseStatus(out: string): Git {
  const g: Git = { isRepo: true, ahead: 0, behind: 0, stash: 0, files: [] }
  for (const line of out.split('\n')) {
    const f = line.split(' ')
    if (line.startsWith('# branch.head ')) g.branch = f[2]
    else if (line.startsWith('# branch.upstream ')) g.upstream = f[2]
    else if (line.startsWith('# branch.ab ')) { g.ahead = Math.abs(Number(f[2])); g.behind = Math.abs(Number(f[3])) }
    else if (line.startsWith('# stash ')) g.stash = Number(f[2])
    else if (f[0] === '1') g.files.push({ xy: f[1] ?? '', path: f.slice(8).join(' ') })
    else if (f[0] === '2') g.files.push({ xy: f[1] ?? '', path: f.slice(9).join(' ').split('\t')[0] ?? '' })
    else if (f[0] === 'u') g.files.push({ xy: 'UU', path: f.slice(10).join(' ') })
    else if (f[0] === '?') g.files.push({ xy: '??', path: f.slice(1).join(' ') })
  }
  return g
}
const fileColor = (xy: string) =>
  xy === '??' ? '#ff875f' : xy === 'UU' ? '#ff5f5f' : xy[0] !== '.' ? '#5fd75f' : '#ffd75f'

// claude-opus-5-5[1m] -> Opus 5.5
const modelName = (id: string) =>
  id.replace(/\[.*\]$/, '').replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a: string, b: string) => `${n[0]?.toUpperCase()}${n.slice(1)} ${a}.${b}`)
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const kTok1 = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e3).toFixed(1)}k`)
const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`)
// ISO reset time -> "3h53m" / "1d0h"
const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return m >= 1440 ? `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h${m % 60}m`
}

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep']
const SHELL_TOOLS = ['Bash', 'PowerShell']
const toolCat = (tool: string): 'f' | 's' | 'o' => (FILE_TOOLS.includes(tool) ? 'f' : SHELL_TOOLS.includes(tool) ? 's' : 'o')
const GATE_COLOR: Record<GateKind, string> = { a: '#6c6c6c', c: '#8787ff', h: '#5fd75f', p: '#ffd75f', d: '#ff5f5f' }
const GATE_MAX = 300
const DENIAL = /doesn't want to proceed|rejected|denied|not allowed|permission/i

// Settle a pending ask once its call has run: approved by the classifier or a person, or denied.
function settle(g: Gate, id: string, kind: GateKind, now: number): Gate {
  const ev = g.events.find(x => x.id === id && x.kind === 'p')
  if (!ev) return g
  const waitMs = now - ev.at
  const counts = { ...g.counts, p: Math.max(0, g.counts.p - 1), [kind]: g.counts[kind] + 1 }
  return { ...g, counts, waitMs: g.waitMs + waitMs, waits: g.waits + 1, events: g.events.map(x => (x === ev ? { ...x, kind, waitMs } : x)) }
}

type Patch = { lines: string[] }[]
// +/- lines of a structured patch
const patchCount = (patch: Patch | undefined) => {
  let add = 0, del = 0
  for (const h of patch ?? []) for (const l of h.lines) {
    if (l.startsWith('+')) add++
    else if (l.startsWith('-')) del++
  }
  return { add, del }
}

// Plan steps: numbered lines win, else checkboxes, else top-level bullets.
function parsePlan(text: string): Plan['steps'] {
  const lines = text.split('\n')
  const grab = (re: RegExp) => lines.flatMap(l => {
    const m = re.exec(l)
    return m ? [{ text: (m[2] ?? '').replace(/\*\*/g, '').trim(), isChecked: /x/i.test(m[1] ?? '') }] : []
  }).filter(x => x.text)
  const numbered = grab(/^\s{0,1}\d+[.)]\s+()(.+)$/)
  if (numbered.length) return numbered.slice(0, 30)
  const boxes = grab(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/)
  if (boxes.length) return boxes.slice(0, 30)
  return grab(/^[-*]\s+()(.+)$/).slice(0, 30)
}
const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3)
// A step is done when a completed todo/task shares half of its words (or its box is checked).
function stepState(step: Plan['steps'][number], list: Todo[]): 'done' | 'doing' | 'todo' {
  if (step.isChecked) return 'done'
  const ws = words(step.text)
  if (!ws.length) return 'todo'
  const match = (t: Todo) => { const tw = new Set(words(t.content)); return ws.filter(w => tw.has(w)).length / ws.length >= 0.5 }
  if (list.some(t => t.status === 'completed' && match(t))) return 'done'
  if (list.some(t => t.status === 'in_progress' && match(t))) return 'doing'
  return 'todo'
}

// mcp__<server>__<tool> -> <server>
const mcpServer = (tool: string) => (tool.startsWith('mcp__') ? tool.slice(5).split('__')[0] ?? '' : '')
const MCP_GLYPH: Record<McpStatus, [string, string]> = {
  connected: ['●', '#5fd75f'], pending: ['◌', '#ffd75f'], failed: ['✗', '#ff5f5f'], 'needs-auth': ['⚿', '#ffaf00'], disabled: ['○', '#6c6c6c'],
}
const blankServer = (name: string, status: McpStatus): McpServer => ({ name, status, tools: 0, calls: 0, errors: 0, totalMs: 0 })
// Set reported statuses (WaitForMcpServers / ToolSearch), adding servers not seen yet.
function mcpMark(list: McpServer[], marks: [string, McpStatus, string?][]): McpServer[] {
  const out = [...list]
  for (const [name, status, error] of marks) {
    const k = out.findIndex(x => x.name === name)
    const one = { ...(k >= 0 ? out[k]! : blankServer(name, status)), status, ...(error ? { error } : {}) }
    if (k >= 0) out[k] = one
    else out.push(one)
  }
  return out
}

// What a tool call is about, in a few words for the console.
const detail = (e: Record<string, unknown>) => {
  const v = e.command ?? e.file_path ?? e.pattern ?? e.path ?? e.url ?? e.description ?? e.query ?? ''
  return String(v).replace(/\s+/g, ' ').slice(0, 80)
}

// Background work: a failure is dropped, never an unhandled rejection.
function quiet(p: Promise<unknown>) {
  p.catch(() => undefined)
}

// Gate writes run one after another so a check and its outcome never race.
let gateQ: Promise<unknown> = Promise.resolve()
function gateWrite($: EngineInterface, fn: (g: Gate) => Gate) {
  gateQ = gateQ.then(() => update($, gate, fn)).catch(() => undefined)
  return gateQ
}

// Hot-path data kept in module memory and written to state in batches (flushSoon / turn.complete).
const logBuf: LogLine[] = []
const permMap = new Map<string, Perm>()
let flushQueued = false

function log(_$: EngineInterface, level: Level, text: string, isSub = false) {
  logBuf.push({ at: Date.now(), level, text, isSub })
  if (logBuf.length > MAX_LOGS) logBuf.splice(0, logBuf.length - MAX_LOGS)
}
function countTool(tool: string, denied: boolean) {
  const one = permMap.get(tool) ?? { tool, ok: 0, denied: 0 }
  permMap.set(tool, { ...one, ok: one.ok + (denied ? 0 : 1), denied: one.denied + (denied ? 1 : 0) })
}
function flushNow($: EngineInterface) {
  return Promise.all([
    update($, logs, () => logBuf.slice()),
    update($, perms, () => [...permMap.values()].sort((a, b) => b.ok + b.denied - a.ok - a.denied)),
  ])
}
// At most one batch write per second while tools run.
function flushSoon($: EngineInterface) {
  if (flushQueued) return
  flushQueued = true
  $.clock.after(1000, () => {
    flushQueued = false
    quiet(flushNow($))
  })
}

async function board($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) {
  const res = (result ?? {}) as Record<string, unknown>
  const now = Date.now()
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const path = String(res.filePath ?? input.file_path ?? input.notebook_path ?? '')
    if (!path) return
    let { add, del } = patchCount(res.structuredPatch as Patch | undefined)
    const isNew = res.type === 'create'
    if (isNew && add === 0) add = String(res.content ?? input.content ?? '').split('\n').length
    if (tool === 'NotebookEdit' && add + del === 0) add = 1
    await update($, touched, list => {
      const old = list.find(f => f.path === path)
      const one: Touched = old
        ? { ...old, add: old.add + add, del: old.del + del, edits: old.edits + 1, at: now }
        : { path, add, del, edits: 1, isNew, at: now }
      return [...list.filter(f => f.path !== path), one].slice(-200)
    })
  } else if (tool === 'ExitPlanMode' && typeof res.plan === 'string') {
    const steps = parsePlan(res.plan)
    if (steps.length) await update($, plan, () => ({ at: now, steps }))
  } else if (tool === 'TaskCreate') {
    const t = res.task as { id?: string; subject?: string } | undefined
    if (t?.id) await update($, todos, list => [...list.filter(x => x.id !== t.id), { id: t.id, content: t.subject ?? '', status: 'pending' }])
  } else if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
    const id = input.taskId, st = input.status as string | undefined, sub = input.subject as string | undefined
    await update($, todos, list => (st === 'deleted'
      ? list.filter(x => x.id !== id)
      : list.map(x => (x.id === id ? { ...x, status: st ?? x.status, content: sub ?? x.content } : x))))
  } else if ((tool === 'Bash' || tool === 'PowerShell') && typeof res.backgroundTaskId === 'string') {
    const id = res.backgroundTaskId
    await update($, bg, list => [...list.filter(b => b.id !== id), { id, kind: 'shell', desc: String(input.description ?? input.command ?? id).slice(0, 120), status: 'running', since: now }])
  } else if (tool === 'Monitor' && typeof res.taskId === 'string') {
    const id = res.taskId
    await update($, bg, list => [...list.filter(b => b.id !== id), { id, kind: 'monitor', desc: String(input.description ?? id), status: 'running', since: now }])
  } else if (tool === 'TaskStop') {
    const id = String(input.task_id ?? input.shell_id ?? res.task_id ?? '')
    await update($, bg, list => list.filter(b => b.id !== id))
  } else if (tool === 'CronCreate' && typeof res.id === 'string') {
    const c: Cron = {
      id: res.id, schedule: String(res.humanSchedule ?? input.cron ?? ''), prompt: String(input.prompt ?? ''),
      recurring: res.recurring === true, nextFireAt: typeof res.nextFireAt === 'number' ? res.nextFireAt : undefined,
    }
    await update($, crons, list => [...list.filter(x => x.id !== c.id), c])
  } else if (tool === 'WaitForMcpServers') {
    const r = res as { connected?: string[]; failed?: string[]; stillPending?: string[]; needsAuth?: string[]; disabled?: string[] }
    const marks: [string, McpStatus][] = [
      ...(r.connected ?? []).map(n => [n, 'connected'] as [string, McpStatus]),
      ...(r.failed ?? []).map(n => [n, 'failed'] as [string, McpStatus]),
      ...(r.stillPending ?? []).map(n => [n, 'pending'] as [string, McpStatus]),
      ...(r.needsAuth ?? []).map(n => [n, 'needs-auth'] as [string, McpStatus]),
      ...(r.disabled ?? []).map(n => [n, 'disabled'] as [string, McpStatus]),
    ]
    if (marks.length) await update($, mcp, list => mcpMark(list, marks))
  } else if (tool === 'ToolSearch' && (res.pending_mcp_servers || res.failed_mcp_servers)) {
    const pend = (res.pending_mcp_servers ?? []) as string[]
    const fail = (res.failed_mcp_servers ?? []) as { name: string; error?: string; errorCode?: string }[]
    await update($, mcp, list => mcpMark(list, [
      ...pend.map(n => [n, 'pending'] as [string, McpStatus]),
      ...fail.map(f => [f.name, 'failed', f.error ?? f.errorCode] as [string, McpStatus, string?]),
    ]))
  } else if (tool === 'CronDelete') {
    await update($, crons, list => list.filter(x => x.id !== input.id))
  } else if (tool === 'CronList' && Array.isArray(res.jobs)) {
    const jobs = res.jobs as { id: string; cron: string; humanSchedule: string; prompt: string; recurring?: boolean; nextFireAt?: number }[]
    await update($, crons, () => jobs.map(j => ({ id: j.id, schedule: j.humanSchedule || j.cron, prompt: j.prompt, recurring: j.recurring === true, nextFireAt: j.nextFireAt })))
  }
}

export const register: Register = on => {
  // Module vars rebuild on reload; they only label log lines.
  const names = new Map<string, string>()
  let modes: string[] = []
  // ids of calls waiting on an ask (-> when asked); module memory so a plain call never touches state
  const pending = new Map<string, number>()
  // last status seen per agent: the poll diffs against this instead of reading state
  const forkStatus = new Map<string, string>()
  let sessionCwd = ''
  let lastUsageKey = ''
  let lastStatus = ''


  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prodash', description: 'Open the Dashboard Pro pane' })
    await update($, usage, u => ({ ...u, startedAt: Date.now() }))
    sessionCwd = await $.session.cwd()
    if (logBuf.length === 0) logBuf.push(...(await read($, logs)))
    if (permMap.size === 0) for (const p of await read($, perms)) permMap.set(p.tool, p)

    // Agents: every 250ms while a fork is alive (spawn marks one at once), every 1s otherwise.
    let tick = 0
    $.clock.every(250, async () => {
      const anyLive = [...forkStatus.values()].some(st => LIVE.includes(st))
      if (!anyLive && tick++ % 4) return
      const list = await $.agent.list()
      const changed = list.length !== forkStatus.size || list.some(a => forkStatus.get(a.id) !== a.status)
      if (!changed) return
      for (const a of list) {
        names.set(a.id, a.description || a.name || a.type)
        const was = forkStatus.get(a.id)
        if (was && was !== a.status && (a.status === 'failed' || a.status === 'killed'))
          log($, a.status === 'failed' ? 'ERROR' : 'WARN', `${names.get(a.id)}: ${a.status}`, true)
        if (was && was !== a.status && a.status === 'completed') log($, 'SUCCESS', `${names.get(a.id)}: completed`, true)
      }
      forkStatus.clear()
      for (const a of list) forkStatus.set(a.id, a.status)
      const now = Date.now()
      // merge into the current value so concurrent tools/tokens increments are kept
      await update($, forks, cur => list.map(a => {
        const old = cur.find(f => f.id === a.id)
        return { id: a.id, name: names.get(a.id) ?? a.id, status: a.status, since: old?.since ?? now, tools: old?.tools ?? 0, lastIn: old?.lastIn ?? 0, out: old?.out ?? 0 }
      }))
    })

    // Usage: write only when a figure changed; otherwise just redraw so the clocks tick.
    $.clock.every(1000, async () => {
      const u = await $.session.usage()
      const ctx = u.context.percent
      const key = JSON.stringify([u.startedAt, ctx, u.context.tokens, u.context.window, u.rateLimits, u.cost?.usd])
      if (key !== lastUsageKey) {
        lastUsageKey = key
        await update($, usage, old => ({
          ...old,
          startedAt: u.startedAt || old.startedAt,
          ctx,
          ctxTokens: u.context.tokens,
          ctxWindow: u.context.window,
          limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
          usd: u.cost?.usd,
        }))
      } else $.ui.invalidate('ui.render')
      const live = [...forkStatus.values()].filter(st => LIVE.includes(st))
      const text = `prodash: ctx ${ctx ?? 0}% · agents ${live.filter(st => st === 'running').length}/${live.length}`
      if (text !== lastStatus) {
        lastStatus = text
        $.ui.status(text)
      }
    })

    // System load: Windows via CIM. shortcut: Windows only, add /proc or vm_stat for other OSes.
    let sysBusy = false
    const sample = async () => {
      if (sysBusy) return
      sysBusy = true
      const r = await $.process.run(
        ['powershell', '-NoProfile', '-Command',
          '$c=(Get-CimInstance Win32_Processor|Measure-Object LoadPercentage -Average).Average;$o=Get-CimInstance Win32_OperatingSystem;"$c $($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)"'],
        { timeoutMs: 8000 },
      ).catch(() => undefined).finally(() => { sysBusy = false })
      const [c, total, free] = (r?.stdout.trim().split(/\s+/) ?? []).map(Number)
      if (c === undefined || Number.isNaN(c)) return
      await update($, sys, s => ({
        load: c,
        memTotal: (total ?? 0) / 1048576,
        memUsed: ((total ?? 0) - (free ?? 0)) / 1048576,
        hist: push(s.hist, c),
      }))
    }
    quiet(sample())
    // shortcut: one short-lived PowerShell per sample; a long-lived streaming process would cost less CPU.
    $.clock.every(10000, () => quiet(sample()))

    // Git: status every 5s (30s outside a repo); log only when HEAD moves; remote + PR every 60s.
    const cwd = sessionCwd
    const run = (argv: string[]) =>
      $.process.run(argv, { cwd, timeoutMs: 8000 }).then(r => (r.exitCode === 0 ? r.stdout.trim() : undefined), () => undefined)
    let pr: string | undefined
    let repo: string | undefined
    let gitBusy = false, gitTick = 0, isRepo = true, lastOid = '', last: string | undefined, lastGit = ''
    const gitSample = async () => {
      if (gitBusy || (!isRepo && gitTick++ % 6)) return
      gitBusy = true
      try {
        const st = await run(['git', 'status', '--porcelain=v2', '--branch', '--show-stash'])
        isRepo = st !== undefined
        const oid = /^# branch\.oid (\S+)/m.exec(st ?? '')?.[1] ?? ''
        if (oid !== lastOid) {
          lastOid = oid
          last = oid && oid !== '(initial)' ? await run(['git', 'log', '-1', '--format=%h %s (%cr)']) : undefined
        }
        const g: Git = st === undefined ? { isRepo: false, ahead: 0, behind: 0, stash: 0, files: [] } : parseStatus(st)
        g.last = last || undefined
        g.repo = repo
        g.pr = pr
        const json = JSON.stringify(g)
        if (json !== lastGit) {
          lastGit = json
          await update($, git, () => g)
        }
      } finally {
        gitBusy = false
      }
    }
    const prSample = async () => {
      const remote = isRepo ? await run(['git', 'remote', 'get-url', 'origin']) : undefined
      repo = remote?.replace(/\.git$/, '').replace(/^.*[:/]([^/:]+\/[^/]+)$/, '$1')
      const out = repo ? await run(['gh', 'pr', 'view', '--json', 'number,state,title', '--template', '#{{.number}} {{.state}} {{.title}}']) : undefined
      pr = out || undefined
      lastOid = '' // let the next status re-read the last commit (it may say "(5 minutes ago)")
    }
    if ((await read($, requests)).length === 0) {
      const msgs = await $.session.messages().catch(() => [])
      const seed: Request[] = []
      for (const m of msgs) {
        const text = m.text.replace(/\s+/g, ' ').trim()
        if (m.role === 'user' && text && !text.startsWith('<')) seed.push({ text: text.slice(0, 200), tools: 0, isDone: true })
        else if (m.role === 'assistant' && seed.length) seed[seed.length - 1]!.tools += m.toolUses.length
      }
      if (seed.length) await update($, requests, () => seed.slice(-50))
    }
    const mcpSample = async () => {
      const tools = await $.tool.list().catch(() => undefined)
      if (!tools) return
      const count = new Map<string, number>()
      for (const t of tools) if (t.mcp || t.name.startsWith('mcp__')) {
        const name = mcpServer(t.name)
        if (name) count.set(name, (count.get(name) ?? 0) + 1)
      }
      const old = await read($, mcp)
      const fresh: McpServer[] = [...count].map(([name, n]) => ({ ...(old.find(x => x.name === name) ?? blankServer(name, 'connected')), status: 'connected', tools: n, error: undefined }))
      // keep reported non-connected servers (failed, pending...) that have no tools
      for (const x of old) if (!count.has(x.name) && x.status !== 'connected') fresh.push(x)
      if (JSON.stringify(fresh) !== JSON.stringify(old)) await update($, mcp, () => fresh)
    }
    quiet(mcpSample())
    $.clock.every(30000, () => quiet(mcpSample()))
    const model = await $.session.model().catch(() => undefined)
    if (model) await update($, liveInfo, l => ({ ...l, model: l.model ?? model }))
    quiet(prSample().then(gitSample))
    $.clock.every(5000, () => quiet(gitSample()))
    $.clock.every(60000, () => quiet(prSample()))

    void $.ui.open({ id: PANE, title: 'Claude Dashboard Pro', columns: 999, rows: 40 })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    quiet(update($, liveInfo, l => ({ ...l, isBusy: true })))
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  // Each model request: count it, note model/effort, time its first chunk (TTFT).
  on('turn.step', async function* ($, e, next) {
    const t0 = Date.now()
    quiet(update($, liveInfo, l => ({
      ...l,
      reqs: l.reqs + 1,
      ...(e.agentId ? {} : { model: e.model, effort: e.effort === undefined ? l.effort : String(e.effort) }),
    })))
    const it = next(e)
    let first = true
    let step = await it.next()
    while (!step.done) {
      if (first && !e.agentId) {
        first = false
        const ttftMs = Date.now() - t0
        quiet(update($, liveInfo, l => ({ ...l, ttftMs })))
      }
      const c = step.value as { kind?: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null }
      if (e.agentId && c.kind === 'stop' && c.usage) {
        const u = c.usage
        const id = e.agentId
        quiet(update($, forks, list => list.map(f => (f.id === id
          ? { ...f, lastIn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, out: f.out + u.output_tokens }
          : f))))
      }
      yield step.value
      step = await it.next()
    }
    return step.value
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (!e.tool_use_id) return r // a plugin's query, not a call
    const tool = String(e.tool)
    const kind: GateKind = r.decision === 'allow' ? 'a' : r.decision === 'deny' ? 'd' : 'p'
    const via = r.decision === 'ask'
      ? (!r.plugin && modes.includes('auto') ? 'classifier' : 'person')
      : r.rule ? 'rule' : r.setting ? 'setting' : r.hook ? 'hook' : 'mode'
    if (kind === 'p') pending.set(e.tool_use_id, Date.now())
    const ev: GateEvent = {
      id: e.tool_use_id, at: Date.now(), tool, cat: toolCat(tool), kind, via,
      detail: detail((e.input ?? {}) as Record<string, unknown>),
      reason: r.reason, rule: r.rule, agent: e.agentId, isReadOnly: e.isReadOnly === true,
    }
    gateWrite($, g => {
      const rules = r.rule
        ? [...g.rules.filter(x => x.rule !== r.rule), { rule: r.rule, n: (g.rules.find(x => x.rule === r.rule)?.n ?? 0) + 1 }].sort((a, b) => b.n - a.n).slice(0, 20)
        : g.rules
      return {
        ...g,
        events: [...g.events, ev].slice(-GATE_MAX),
        total: g.total + 1,
        counts: { ...g.counts, [kind]: g.counts[kind] + 1 },
        cats: { ...g.cats, [ev.cat]: g.cats[ev.cat] + 1 },
        reads: g.reads + (ev.isReadOnly ? 1 : 0),
        writes: g.writes + (ev.isReadOnly ? 0 : 1),
        main: g.main + (e.agentId ? 0 : 1),
        forks: g.forks + (e.agentId ? 1 : 0),
        rules,
      }
    })
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('classic.Stop', async ($, e, next) => {
    const tasks = (e.background_tasks ?? []).filter(t => t.type !== 'subagent')
    const now = Date.now()
    await update($, bg, old => tasks.map(t => ({
      id: t.id, kind: t.type, desc: t.description || t.command || t.id, status: t.status,
      since: old.find(o => o.id === t.id)?.since ?? now,
    })))
    if (e.session_crons)
      await update($, crons, old => (e.session_crons ?? []).map(c => ({
        id: c.id, schedule: old.find(o => o.id === c.id)?.schedule ?? c.schedule, prompt: c.prompt, recurring: c.recurring,
        nextFireAt: old.find(o => o.id === c.id)?.nextFireAt,
      })))
    return next(e)
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    await update($, liveInfo, l => ({ ...l, compactions: l.compactions + 1 }))
    return r
  })

  on('command.run', { command: 'prodash' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude Dashboard Pro', focus: true, columns: 999, rows: 40 })
    return { text: 'Dashboard Pro opened. Keys 1–4 trigger the action bar.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.text.trim()) log($, 'USER', `you: ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    if (e.text.trim() && !e.command)
      quiet(update($, requests, list => [...list, { at: Date.now(), text: e.text.replace(/\s+/g, ' ').slice(0, 200), tools: 0, isDone: false }].slice(-50)))
    return next(e)
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    log($, 'INFO', `${String((e as { description?: string }).description ?? 'agent')}: spawned → fork`)
    const id = (r as { agentId?: string }).agentId
    if (id && !forkStatus.has(id)) forkStatus.set(id, 'pending')
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('tool.call', async ($, e, next) => {
    const raw = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const who = e.agentId ? names.get(e.agentId) ?? 'fork' : 'main'
    if (tool === 'TodoWrite' && Array.isArray(raw.todos))
      quiet(update($, todos, list => [...list.filter(t => t.id), ...(raw.todos as Todo[]).map(t => ({ content: t.content, status: t.status }))]))
    if (!e.agentId) quiet(update($, requests, list => (list.length ? list.map((q, i) => (i === list.length - 1 && !q.isDone ? { ...q, tools: q.tools + 1 } : q)) : list)))
    if (e.agentId) quiet(update($, forks, list => list.map(f => (f.id === e.agentId ? { ...f, tools: f.tools + 1 } : f))))

    const t0 = Date.now()
    const r = await next(e)
    const denied = 'deny' in r && r.deny !== undefined
    const srv = mcpServer(tool)
    if (srv) {
      const ms = Date.now() - t0, failed = denied || (r as { isError?: boolean }).isError === true
      quiet(update($, mcp, list => {
        const one = list.find(x => x.name === srv) ?? blankServer(srv, 'connected')
        const upd = { ...one, calls: one.calls + 1, errors: one.errors + (failed ? 1 : 0), totalMs: one.totalMs + ms, lastAt: Date.now() }
        return list.some(x => x.name === srv) ? list.map(x => (x.name === srv ? upd : x)) : [...list, upd]
      }))
    }
    if (!denied) void board($, tool, raw, (r as { result?: unknown }).result).catch(() => undefined)
    const id = e.tool_use_id
    // Only a call that waited on an ask writes here (keeps tool calls cheap).
    if (pending.delete(id)) {
      const rr = r as { isError?: boolean; text?: string }
      // shortcut: no event says "the ask was refused"; an errored result worded as a refusal stands for it.
      const refused = denied || (rr.isError === true && DENIAL.test(rr.text ?? ''))
      await gateWrite($, g => {
        const ev = g.events.find(x => x.id === id && x.kind === 'p')
        return ev ? settle(g, id, refused ? 'd' : ev.via === 'classifier' ? 'c' : 'h', Date.now()) : g
      })
    }
    const isError = !denied && (r as { isError?: boolean }).isError === true
    log($, denied ? 'WARN' : isError ? 'ERROR' : 'SUCCESS',
      `${who}: ${tool} → ${denied ? `denied (${r.deny})` : detail(raw)}`, !!e.agentId)
    countTool(tool, denied)
    flushSoon($)
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r.usage
    const cost = (await $.session.usage()).cost?.usd
    const old15 = Date.now() - 15 * 60_000
    for (const [id, at] of pending) if (at < old15) pending.delete(id)
    await Promise.all([
      flushNow($),
      e.agentId ? undefined : update($, liveInfo, l => ({ ...l, isBusy: false })),
      e.agentId ? undefined : update($, requests, list => list.map((q, i) => (i === list.length - 1 && !q.isDone ? { ...q, isDone: true, durationMs: e.durationMs } : q))),
      update($, usage, old => ({
      ...old,
      tokens: old.tokens + (u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0),
      lastTurnUsd: cost !== undefined && old.usd !== undefined ? Math.max(0, cost - (old.turnBaseUsd ?? 0)) : old.lastTurnUsd,
      turnBaseUsd: cost,
      usd: cost,
    })),
    ])
    return r
  })

  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    modes = [...e.props.modes]
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const W = e.props.bodyColumns
    const H = Math.max(12, e.viewport?.rows ?? 30)
    const [s, u, fl, m, lv, gh, servers] = await Promise.all([read($, sys), read($, usage), read($, forks), read($, mode), read($, liveInfo), read($, git), read($, mcp)])
    const live = fl.filter(f => LIVE.includes(f.status))
    const count = (st: string) => live.filter(f => f.status === st).length
    const running = count('running'), waiting = count('waiting') + count('pending'), idle = count('idle')
    const now = Date.now()
    // w: the box's outer width in cells, so its title can be centered on the top border
    const box = (title: string, grow: number, body: RenderChildren, w = W) => {
      const t = title.slice(0, Math.max(1, w - 6))
      const left = Math.max(1, Math.floor((w - (t.length + 2)) / 2))
      // The title is painted over the top border from a borderless wrapper (row 0 of the wrapper is
      // the border row): the terminal clips what a bordered box draws outside its own content.
      return (
        <Box flexDirection="column" flexGrow={grow} width={w === W ? undefined : w} flexShrink={0} minWidth={0}>
          <Box flexDirection="column" borderStyle="round" borderColor={CYAN} paddingX={1} flexGrow={1} minWidth={0}>
            {body}
          </Box>
          <Box position="absolute" top={0} left={left} width={t.length + 2}>
            <Text wrap="truncate-end"><Text> </Text><Text color={CYAN} bold>{t}</Text><Text> </Text></Text>
          </Box>
        </Box>
      )
    }
    const wThird = Math.floor(W / 3)
    const load = s.load ?? 0
    const status = s.load === undefined ? 'SYNCING' : load >= 90 ? 'DEGRADED' : 'ONLINE'
    const histo = live.map(f => (f.status === 'running' ? '■' : '□')).join('') || '·'

    const inner = Math.max(8, Math.floor(W / 3) - 4) // System Status takes 1/3; border + padding take 4
    const wide = Math.max(16, Math.floor((W * 2) / 3) - 4)
    const header = (
      <Box flexDirection="row">
        {box('SYSTEM STATUS', 1, <Box flexDirection="column">
          <Text wrap="truncate-end"><Text color={status === 'ONLINE' ? '#5fd75f' : status === 'DEGRADED' ? '#ff5f5f' : '#ffd75f'}>● {status}</Text></Text>
          <Text wrap="truncate-end">CPU <Text color={loadColor(load)}>{bar(load, Math.max(3, inner - 9))}</Text> {s.load === undefined ? 'n/a' : `${load}%`}</Text>
          <Text wrap="truncate-end">RAM {s.memTotal ? `${(s.memUsed ?? 0).toFixed(1)}/${s.memTotal.toFixed(0)}G` : 'n/a'}</Text>
          <Text wrap="truncate-end"><Text color="#5fd75f">{spark(s.hist, inner)}</Text></Text>
        </Box>, wThird)}
        {box('AGENT OVERVIEW', 2, <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text wrap="truncate-end" color="#ff875f" bold>{lv.model ? modelName(lv.model) : '—'}{gh.branch ? ` · ${gh.branch}` : ''}</Text>
            <Text color={lv.isBusy ? '#5fd75f' : '#8a8a8a'}>{lv.isBusy ? '● busy' : '○ idle'}</Text>
          </Box>
          <Text wrap="truncate-end">effort <Text color="#ff875f">{'▮'.repeat(EFFORTS.indexOf(lv.effort ?? '') + 1)}{'▯'.repeat(5 - EFFORTS.indexOf(lv.effort ?? '') - 1)}</Text> <Text bold>{lv.effort ?? '—'}</Text>{modes.length ? `  mode ${modes.join(',')}` : ''}  {lv.reqs} req</Text>
          <Text wrap="truncate-end">ctx <Text color="#ff875f">{bar(u.ctx ?? 0, Math.max(4, Math.min(12, wide - 28)))}</Text> <Text bold>{u.ctx ?? 0}%</Text> {u.ctxTokens !== undefined && u.ctxWindow ? `${kTok(u.ctxTokens)}/${kTok(u.ctxWindow)}` : ''}{lv.compactions ? <Text color="#ffd75f"> ↺{lv.compactions}</Text> : ''}</Text>
          <Text wrap="truncate-end"><Text bold>${(u.usd ?? 0).toFixed(2)}</Text>{(u.limits ?? []).map(r => {
            const label = r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? '7d' : r.kind
            return <Text>  {label} <Text color="#ff875f">{bar(r.pct, 5)}</Text> {Math.round(r.pct)}% <Text dimColor>↻{until(r.resetsAt, now)}</Text></Text>
          })}</Text>
          <Text wrap="truncate-end">last req <Text dimColor>ttft</Text> {lv.ttftMs === undefined ? '—' : `${(lv.ttftMs / 1000).toFixed(1)}s`}   <Text color="#5fd75f">R {running}</Text> <Text color="#ffd75f">W {waiting}</Text> <Text color="#ffd75f">I {idle}</Text> T {fl.length}</Text>
        </Box>, W - wThird)}
      </Box>
    )

    const save = async () => {
      const list = logBuf
      const path = `${sessionCwd}/prodash-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
      await $.fs.write(path, list.map(l => `[${hhmmss(l.at)}] [${l.level}] ${l.text}`).join('\n') + '\n')
      $.ui.toast(`Log saved: ${path}`)
    }
    const go = (to: Mode) => () => update($, mode, cur => (cur === to ? 'main' : to))
    const actions = (
      <Box borderStyle="round" borderColor={CYAN} justifyContent="space-around" flexWrap="wrap">
        <Button key="a1" hotkey="1" label="AGENT SELECT" onPress={go('agents')} />
        <Button key="a2" hotkey="2" label="GATE PERMS" onPress={go('perms')} />
        <Button key="a3" hotkey="3" label="SAVE LOG" onPress={save} />
        <Button key="a4" hotkey="4" label="PROJECT BOARD" onPress={go('board')} />
      </Box>
    )

    const MCP_ROWS = 5
    const shownMcp = [...servers].sort((a, b) => (a.status === 'connected' ? 1 : 0) - (b.status === 'connected' ? 1 : 0) || b.calls - a.calls).slice(0, MCP_ROWS)
    const nConn = servers.filter(x => x.status === 'connected').length
    const nTools = servers.reduce((n, x) => n + x.tools, 0)
    const nBad = servers.filter(x => x.status === 'failed' || x.status === 'needs-auth').length
    const mcpBox = box('MCP SERVERS', 1, <Box flexDirection="column">
      <Text wrap="truncate-end"><Text color="#5fd75f">{nConn} connected</Text> · {nTools} tools{nBad ? <Text color="#ff5f5f"> · {nBad} failed</Text> : ''}{servers.length - nConn - nBad > 0 ? <Text color="#ffd75f"> · {servers.length - nConn - nBad} other</Text> : ''}</Text>
      {servers.length === 0 && <Text dimColor>no MCP servers connected</Text>}
      {shownMcp.map(x => {
        const [g, c] = MCP_GLYPH[x.status]
        return (
          <Box key={`mcp-${x.name}`} justifyContent="space-between">
            <Text wrap="truncate-end"><Text color={c}>{g}</Text> {x.name} <Text dimColor>{x.status === 'connected' ? `${x.tools} tools` : x.status}</Text>{x.error ? <Text color="#ff875f"> — {x.error}</Text> : ''}</Text>
            <Box flexShrink={0} marginLeft={1}><Text dimColor>{x.calls} calls · {x.errors} err{x.calls ? ` · avg ${(x.totalMs / x.calls / 1000).toFixed(1)}s` : ''}{x.lastAt ? ` · ${span(now - x.lastAt)} ago` : ''}</Text></Box>
          </Box>
        )
      })}
      {servers.length > MCP_ROWS && <Text dimColor>… +{servers.length - MCP_ROWS} servers</Text>}
    </Box>, W - wThird)
    const metricsBox = box('METRICS', 1, <Box flexDirection="column">
          <Text wrap="truncate-end">TIME {clock(now - (u.startedAt || now))}</Text>
          <Text wrap="truncate-end">TOKENS {tokens(u.tokens)}</Text>
          <Text wrap="truncate-end">COST ${(u.usd ?? 0).toFixed(2)}</Text>
          <Text wrap="truncate-end">TURN ${(u.lastTurnUsd ?? 0).toFixed(2)}</Text>
        </Box>, wThird)
    // MCP and Session Metrics share a row: it is as tall as the taller of the two
    const room = Math.max(3, H - 14 - Math.max(6, 3 + Math.max(1, shownMcp.length) + (servers.length > MCP_ROWS ? 1 : 0)))
    const back = <Button key="back" label="BACK" onPress={() => update($, mode, () => 'main' as Mode)} />
    let body: RenderChildren

    if (m === 'agents') {
      body = box('AGENT SELECT — opens the agent transcript', 1, <Box flexDirection="column">
        {fl.length === 0 && <Text dimColor>No subagents in this session.</Text>}
        {fl.slice(-room).map(f => (
          <Button key={`ag-${f.id}`} plain onPress={() => $.ui.view({ agentId: f.id })}>
            {f.name.slice(0, 40)} <Text color={STATUS_COLOR[f.status] ?? '#8a8a8a'}>({f.status.toUpperCase()})</Text> <Text dimColor>{f.tools} tools</Text>
          </Button>
        ))}
        <Button key="main-view" plain onPress={() => $.ui.view({})}>← main conversation</Button>
        {back}
      </Box>)
    } else if (m === 'perms') {
      const [list, g] = await Promise.all([read($, perms), read($, gate)])
      const cols = Math.max(10, W - 4)
      const strip = g.events.slice(-cols * 2)
      const rows = [strip.slice(0, Math.max(0, strip.length - cols)), strip.slice(-cols)].filter(x => x.length)
      const sq = (k: GateKind, label: string, n: number) => <Text><Text color={GATE_COLOR[k]}>{k === 'd' ? '✗' : '■'}</Text> {n} {label}  </Text>
      const avgWait = g.waits ? `${(g.waitMs / g.waits / 1000).toFixed(1)}s` : '—'
      const recent = g.events.filter(x => x.kind !== 'a').slice(-Math.max(3, room - 16)).reverse()
      const VIA: Record<string, string> = { c: 'classifier', h: 'approved', p: 'pending', d: 'denied' }
      body = box('GATE PERMS', 1, <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text color="#5fd75f" bold>GATE · permissions</Text>
          <Text dimColor>{g.total} checks</Text>
        </Box>
        {rows.length === 0 && <Text dimColor>No permission checks yet.</Text>}
        {rows.map(r => {
          // one Text per run of the same color, not one per square
          const runs: [GateKind, number][] = []
          for (const x of r) {
            const lastRun = runs[runs.length - 1]
            if (lastRun && lastRun[0] === x.kind) lastRun[1]++
            else runs.push([x.kind, 1])
          }
          return <Text wrap="truncate-end">{runs.map(([k, n]) => <Text color={GATE_COLOR[k]}>{'■'.repeat(n)}</Text>)}</Text>
        })}
        <Text wrap="wrap">{sq('a', 'allowed', g.counts.a)}{sq('c', 'classifier', g.counts.c)}{sq('h', 'approved', g.counts.h)}{sq('p', 'pending', g.counts.p)}{sq('d', 'denied', g.counts.d)}</Text>
        <Text wrap="truncate-end"><Text bold>f:</Text> file {g.cats.f}  <Text bold>s:</Text> shell {g.cats.s}  <Text bold>o:</Text> other {g.cats.o}   <Text dimColor>read {g.reads} · write {g.writes}</Text></Text>
        <Text wrap="truncate-end">main {g.main} · forks {g.forks}   <Text dimColor>avg approval wait</Text> {avgWait}   <Text dimColor>auto-approve rate</Text> {g.total ? Math.round(((g.counts.a + g.counts.c) / g.total) * 100) : 0}%</Text>
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            <Text color={CYAN} bold>TOP RULES</Text>
            {g.rules.length === 0 && <Text dimColor>no rule decided yet</Text>}
            {g.rules.slice(0, 5).map(x => <Text wrap="truncate-end"><Text dimColor>{String(x.n).padStart(4)}×</Text> {x.rule}</Text>)}
          </Box>
          <Box flexDirection="column" flexGrow={1} minWidth={0} marginLeft={2}>
            <Text color={CYAN} bold>TOP TOOLS</Text>
            {list.length === 0 && <Text dimColor>no tool calls yet</Text>}
            {list.slice(0, 5).map(x => (
              <Text wrap="truncate-end">{x.tool.padEnd(14).slice(0, 14)} <Text color="#5fd75f">✓{x.ok}</Text> <Text color={x.denied ? '#ff5f5f' : '#6c6c6c'}>✗{x.denied}</Text></Text>
            ))}
          </Box>
        </Box>
        <Text color={CYAN} bold>RECENT ASKS & DENIALS</Text>
        {recent.length === 0 && <Text dimColor>nothing asked or denied yet</Text>}
        {recent.map(x => (
          <Text wrap="truncate-end"><Text color="#6c6c6c">[{hhmmss(x.at)}]</Text> <Text color={GATE_COLOR[x.kind]}>{VIA[x.kind]}</Text> {x.tool} <Text dimColor>{x.detail}</Text>{x.waitMs !== undefined ? <Text dimColor> · {(x.waitMs / 1000).toFixed(1)}s</Text> : ''}{x.reason && x.kind === 'd' ? <Text color="#ff875f"> — {x.reason}</Text> : ''}</Text>
        ))}
        {back}
      </Box>)
    } else if (m === 'board') {
      const [list, files, reqs, pl, bgs, cr, cwd] = await Promise.all([
        read($, todos), read($, touched), read($, requests), read($, plan), read($, bg), read($, crons), sessionCwd,
      ])
      const isWide = W >= 110
      const cap = Math.max(2, Math.floor((room - 8) / (isWide ? 3 : 5)))
      const title = (t: string, extra?: string) => <Text color={CYAN} bold wrap="truncate-end">{t}{extra ? <Text dimColor bold={false}>  {extra}</Text> : ''}</Text>
      const rel = (p: string) => (p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[\\/]/, '') : p)

      const states = (pl?.steps ?? []).map(st => stepState(st, list))
      const done = states.filter(x => x === 'done').length
      const tc = (st: string) => list.filter(t => t.status === st).length
      const planSec = <Box flexDirection="column">
        {title('PLAN', pl ? `${done}/${pl.steps.length}  ${'▰'.repeat(Math.round((done / Math.max(1, pl.steps.length)) * 10))}${'▱'.repeat(10 - Math.round((done / Math.max(1, pl.steps.length)) * 10))}` : undefined)}
        {!pl && <Text dimColor>no approved plan yet</Text>}
        {pl && pl.steps.slice(0, cap).map((st, k) => (
          <Text wrap="truncate-end"><Text color={states[k] === 'done' ? '#5fd75f' : states[k] === 'doing' ? '#5fafff' : '#6c6c6c'}>{states[k] === 'done' ? '✓' : states[k] === 'doing' ? '◐' : '○'}</Text> <Text dimColor={states[k] === 'done'}>{st.text}</Text></Text>
        ))}
        {pl && pl.steps.length > cap && <Text dimColor>… +{pl.steps.length - cap} steps</Text>}
        {list.length > 0 && <Text wrap="truncate-end" dimColor>tasks: <Text color="#ffd75f">{tc('pending')} todo</Text> · <Text color="#5fafff">{tc('in_progress')} doing</Text> · <Text color="#5fd75f">{tc('completed')} done</Text>{list.find(t => t.status === 'in_progress') ? `  ▸ ${list.find(t => t.status === 'in_progress')?.content}` : ''}</Text>}
      </Box>

      const fadd = files.reduce((n, f) => n + f.add, 0), fdel = files.reduce((n, f) => n + f.del, 0)
      const filesSec = <Box flexDirection="column">
        {title('FILES TOUCHED', files.length ? `${files.length} files  +${fadd} −${fdel}` : undefined)}
        {files.length === 0 && <Text dimColor>no edits this session</Text>}
        {[...files].sort((a, b) => b.at - a.at).slice(0, cap).map(f => (
          <Text wrap="truncate-start"><Text color="#5fd75f">+{f.add}</Text> <Text color="#ff5f5f">−{f.del}</Text>{f.isNew ? <Text color="#ffd75f"> new</Text> : ''} {rel(f.path)}</Text>
        ))}
      </Box>

      const timeSec = <Box flexDirection="column">
        {title('TIMELINE', reqs.length ? `${reqs.length} requests` : undefined)}
        {reqs.length === 0 && <Text dimColor>no requests yet</Text>}
        {reqs.slice(-cap).reverse().map(q => (
          <Text wrap="truncate-end"><Text color="#6c6c6c">{q.at ? hhmmss(q.at).slice(0, 5) : '--:--'}</Text> <Text color={q.isDone ? '#5fd75f' : '#ffd75f'}>{q.isDone ? '✓' : '◐'}</Text> <Text dimColor>{String(q.tools).padStart(3)} tools{q.durationMs !== undefined ? ` ${span(q.durationMs)}` : ''}</Text>  {q.text}</Text>
        ))}
      </Box>

      const bgSec = <Box flexDirection="column">
        {title('BACKGROUND', bgs.length ? `${bgs.length} running` : undefined)}
        {bgs.length === 0 && <Text dimColor>no shells or monitors in flight</Text>}
        {bgs.slice(0, cap).map(b => (
          <Text wrap="truncate-end"><Text color="#5fd75f">●</Text> <Text color="#5fafff">{b.kind.padEnd(8)}</Text>{b.desc} <Text dimColor>{span(now - b.since)}</Text></Text>
        ))}
      </Box>

      const cronSec = <Box flexDirection="column">
        {title('SCHEDULED', cr.length ? `${cr.length} jobs` : undefined)}
        {cr.length === 0 && <Text dimColor>nothing scheduled</Text>}
        {cr.slice(0, cap).map(c => (
          <Text wrap="truncate-end"><Text color="#ffd75f">⏰</Text> {c.schedule}{c.recurring ? '' : ' (once)'}  <Text dimColor>{c.prompt.replace(/\s+/g, ' ')}</Text>{c.nextFireAt ? <Text dimColor> · next {hhmmss(c.nextFireAt).slice(0, 5)}</Text> : ''}</Text>
        ))}
      </Box>

      body = box('PROJECT BOARD', 1, <Box flexDirection="column">
        {isWide
          ? <Box flexDirection="row">
              <Box flexDirection="column" flexGrow={1} minWidth={0}>{planSec}{filesSec}</Box>
              <Box flexDirection="column" flexGrow={1} minWidth={0} marginLeft={2}>{timeSec}{bgSec}{cronSec}</Box>
            </Box>
          : <Box flexDirection="column">{planSec}{filesSec}{timeSec}{bgSec}{cronSec}</Box>}
        {back}
      </Box>)
    } else {
      const g = gh
      const fileRows = Math.max(2, Math.min(8, Math.floor((room - 6) / 2)))
      const nStaged = g.files.filter(f => f.xy !== '??' && f.xy !== 'UU' && f.xy[0] !== '.').length
      const nMod = g.files.filter(f => f.xy !== '??' && f.xy !== 'UU' && f.xy[1] !== '.').length
      const nNew = g.files.filter(f => f.xy === '??').length
      const gitBox = box(g.isRepo ? `GITHUB · ${g.repo ?? 'no remote'}` : 'GITHUB', 0, g.isRepo ? <Box flexDirection="column">
        <Text wrap="truncate-end">⎇ <Text color="#5fafff" bold>{g.branch ?? '?'}</Text>{g.upstream ? ` → ${g.upstream}` : ' (no upstream)'} <Text color="#5fd75f">↑{g.ahead}</Text> <Text color="#ff875f">↓{g.behind}</Text>{g.stash ? `  stash ${g.stash}` : ''}</Text>
        {g.pr && <Text wrap="truncate-end">PR <Text color="#af87ff">{g.pr}</Text></Text>}
        <Text wrap="truncate-end" dimColor>{g.last ?? 'no commits'}</Text>
        <Text wrap="truncate-end">PENDING: <Text color="#5fd75f">{nStaged} staged</Text> · <Text color="#ffd75f">{nMod} modified</Text> · <Text color="#ff875f">{nNew} new</Text>{g.files.length === 0 ? ' — clean' : ''}</Text>
        {g.files.slice(0, fileRows).map((f: GitFile) => <Text wrap="truncate-start"><Text color={fileColor(f.xy)}>{f.xy.replace(/\./g, ' ')}</Text> {f.path}</Text>)}
        {g.files.length > fileRows && <Text dimColor>… +{g.files.length - fileRows} file(s)</Text>}
      </Box> : <Text dimColor>Current folder is not a git repository.</Text>)
      const gitRows = g.isRepo ? 4 + Math.min(fileRows + 1, g.files.length) + (g.pr ? 1 : 0) : 1
      const forkRoom = Math.max(2, room - gitRows - 3)
      // One row per loop: main first, then each fork; ● marks the one in view, a press opens its transcript.
      const viewed = e.props.view.agentId
      const rowW = Math.max(20, W - 4)
      const row = (key: string, kind: string, name: string, right: string, isOn: boolean, isEnded: boolean, onPress: () => unknown) => {
        // Time and tokens sit outside the Button with a fixed width, so a long name is what gets cut.
        const nameW = Math.max(4, rowW - 2 - 6 - right.length - 4)
        const shown = name.length > nameW ? `${name.slice(0, nameW - 1)}…` : name
        return (
          <Box key={`r-${key}`} justifyContent="space-between">
            <Button key={key} plain onPress={onPress}>
              <Text color={isOn ? '#ffffff' : '#8a8a8a'}>{isOn ? '●' : '○'} </Text>
              <Text bold={isOn} dimColor={!isOn}>{kind.padEnd(6)}</Text>
              <Text bold={isOn} dimColor={!isOn || isEnded}>{shown}</Text>
            </Button>
            {right && <Box flexShrink={0} marginLeft={1}><Text dimColor={!isOn}>{right}</Text></Box>}
          </Box>
        )
      }
      const forksBox = box('ACTIVE FORKS', 1, <Box flexDirection="column">
        {row('f-main', 'main', '', `${span(now - (u.startedAt || now))} · ↓ ${kTok1(u.tokens)} tokens`, viewed === undefined, false, () => $.ui.view({}))}
        {fl.slice(-forkRoom).map(f => row(
          `f-${f.id}`, 'fork', f.name,
          `${span(now - f.since)} · ↓ ${kTok1(f.lastIn + f.out)} tokens`,
          viewed === f.id, !LIVE.includes(f.status),
          () => $.ui.view({ agentId: f.id }),
        ))}
      </Box>)
      body = <Box flexDirection="column">{gitBox}{forksBox}</Box>
    }

    return (
      <Box flexDirection="column" width={W}>
        {header}
        <Box flexDirection="row">
          {mcpBox}
          {metricsBox}
        </Box>
        {actions}
        {body}
      </Box>
    )
  })
}
