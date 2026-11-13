import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Bg, Cron, Ctx, Fork, McpServer, McpStatus, Palette, PaletteKey, ThemeCfg, ThemeState, Plan, Request, Gate, GateEvent, GateKind, Git, GitFile, Level, Live, LogLine, Mode, Perm, Sys, Todo, Touched, Usage } from '../types'

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
const ctxInfo = atom({ plugin: 'prodash', key: 'ctx' } as const, { used: 0, max: 0, rows: [], mcp: {}, memory: [], skills: [], skillsTotal: 0, model: '' } as Ctx, { shape: 'ctx-2' })
const theme = atom({ plugin: 'prodash', key: 'theme' } as const, { name: 'default', base: 'default', custom: {} } as ThemeState, { shape: 'theme-1' })
const themeCfg = atom({ plugin: 'prodash', key: 'themeCfg' } as const, { force: false, scope: 'global', root: '' } as ThemeCfg, { shape: 'themecfg-1' })
const crons = atom({ plugin: 'prodash', key: 'crons' } as const, [] as Cron[], { shape: 'crons-1' })

const CYAN = '#5fd7d7'

// Themes: every color the pane draws is written as its default hex and mapped through tc() at draw time.
// The hex each role is written as in this file (code tokens, not a theme): tc() maps them to the theme in force.
const TOKENS: Palette = { border: '#5fd7d7', ok: '#5fd75f', warn: '#ffd75f', bad: '#ff5f5f', info: '#5fafff', accent: '#ff875f', amber: '#ffaf00', dim: '#6c6c6c', dim2: '#8a8a8a', gold: '#d7af5f', purple: '#af87ff', violet: '#8787ff', white: '#ffffff', user: '#ffff87' }
// Soft presets (low saturation, mid luminance); vivid keeps the original bright colors.
const THEMES: Record<string, Palette> = {
  default: { border: '#5f7f7f', ok: '#87af87', warn: '#d7c087', bad: '#d78787', info: '#87afd7', accent: '#d7875f', amber: '#d7a65f', dim: '#5f5f5f', dim2: '#808080', gold: '#c0a878', purple: '#afa0d7', violet: '#9a9adf', white: '#d0d0d0', user: '#e0dca0' },
  matrix: { border: '#2fa84f', ok: '#5fd77f', warn: '#b6e39a', bad: '#d78787', info: '#6fe08f', accent: '#4fc06f', amber: '#a8d77f', dim: '#2f5a3a', dim2: '#4f8a5e', gold: '#8fdf8f', purple: '#7fd7a8', violet: '#6fc08f', white: '#c8f0d0', user: '#d0f0b8' },
  dracula: { border: '#7c6f9e', ok: '#7fbf8f', warn: '#d6d29a', bad: '#d68a8a', info: '#8fc3cf', accent: '#d4a373', amber: '#d4a373', dim: '#55597a', dim2: '#71769a', gold: '#d6d29a', purple: '#c48fb0', violet: '#a596d1', white: '#e2e2dc', user: '#d6d29a' },
  nord: { border: '#6f8f99', ok: '#9cb08a', warn: '#d9c08e', bad: '#b9787f', info: '#8199b3', accent: '#c48b75', amber: '#d9c08e', dim: '#4c566a', dim2: '#66718a', gold: '#d9c08e', purple: '#a58aa3', violet: '#7387a8', white: '#d8dee9', user: '#d9c08e' },
  amber: { border: '#8a6a3a', ok: '#d4b06a', warn: '#e0c896', bad: '#c97a5a', info: '#d4b27f', accent: '#c9935a', amber: '#d4a24f', dim: '#5e4a2c', dim2: '#7d6340', gold: '#ddc08f', purple: '#c9a77f', violet: '#b8915a', white: '#e6d6b8', user: '#eadcbf' },
  cyberpunk: { border: '#a35a7a', ok: '#6fb3bd', warn: '#d6cf7a', bad: '#d06a85', info: '#6aa8b0', accent: '#b06aa8', amber: '#d4a066', dim: '#4f4560', dim2: '#6c6085', gold: '#d6cf7a', purple: '#b06aa8', violet: '#8a7bc4', white: '#dcdcec', user: '#d6cf7a' },
  mono: { border: '#6c6c6c', ok: '#b8b8b8', warn: '#a8a8a8', bad: '#d0d0d0', info: '#a0a0a0', accent: '#c6c6c6', amber: '#b0b0b0', dim: '#4e4e4e', dim2: '#707070', gold: '#a8a8a8', purple: '#9a9a9a', violet: '#8e8e8e', white: '#d0d0d0', user: '#c6c6c6' },
  vivid: { ...TOKENS },
}
const ROLE_OF = new Map(Object.entries(TOKENS).map(([k, v]) => [v, k as PaletteKey]))
const EDITABLE: PaletteKey[] = ['border', 'ok', 'warn', 'bad', 'info', 'accent', 'dim', 'white']
const SWATCHES: [string, string][] = [
  ['rose', '#d78787'], ['rust', '#c97a5a'], ['clay', '#d7875f'], ['sand', '#d7c087'], ['honey', '#d7a65f'], ['olive', '#a8c27f'],
  ['sage', '#87af87'], ['mint', '#8fc9a0'], ['teal', '#6fb3bd'], ['slate', '#5f7f7f'], ['sky', '#87afd7'], ['steel', '#8199b3'],
  ['lavender', '#afa0d7'], ['iris', '#9a9adf'], ['mauve', '#c48fb0'], ['snow', '#d0d0d0'], ['ash', '#808080'], ['smoke', '#5f5f5f'],
]
const HEX = /^#?([0-9a-f]{6})$/i
// The palette in force for the current draw (set at the top of the pane's render).
let pal: Palette = THEMES.default!
const tc = (hex: string) => {
  const role = ROLE_OF.get(hex)
  return role ? pal[role] : hex
}
const resolveTheme = (t: ThemeState): Palette =>
  t.name === 'custom' ? { ...(THEMES[t.base] ?? THEMES.default!), ...t.custom } : THEMES[t.name] ?? THEMES.default!
const isTheme = (v: unknown): v is ThemeState =>
  !!v && typeof v === 'object' && typeof (v as ThemeState).name === 'string' && typeof (v as ThemeState).base === 'string' && typeof (v as ThemeState).custom === 'object'
const LIVE = ['pending', 'running', 'waiting', 'idle']

const bar = (pct: number, width: number) => {
  const n = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}
const spark = (values: number[], width = HIST) =>
  values.slice(-Math.max(1, width)).map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.max(0, Math.round((v / 100) * 7)))]).join('')
// 56m 13s / 1h 4m / 9s
const span = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const hhmmss = (at: number) => new Date(at).toTimeString().slice(0, 8)
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
// origin URL (https, ssh://, scp-style) -> provider label + repo path (GitLab subgroups kept, Azure "/_git/" dropped).
export function parseRemote(url: string): { host: string; repo: string } {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m) return { host: 'GIT', repo: url.trim() }
  const hostName = m[1]!
  const host = /github/i.test(hostName) ? 'GITHUB' : /gitlab/i.test(hostName) ? 'GITLAB' : /bitbucket/i.test(hostName) ? 'BITBUCKET'
    : /dev\.azure\.com|visualstudio\.com/i.test(hostName) ? 'AZURE DEVOPS' : hostName.toUpperCase()
  return { host, repo: m[2]!.replace(/^v3\//, '').replace('/_git/', '/') }
}
// Open PR/MR for the current branch through the provider's own CLI (Bitbucket: its public REST API over the host's
// http call); silently none when the CLI is missing or signed out.
export async function prFor(
  run: (argv: string[]) => Promise<string | undefined>,
  fetchText: (url: string) => Promise<string | undefined>,
  { host, repo }: { host: string; repo: string },
): Promise<string | undefined> {
  if (host === 'GITHUB') return run(['gh', 'pr', 'view', '--json', 'number,state,title', '--template', '#{{.number}} {{.state}} {{.title}}'])
  if (host === 'GITLAB') {
    const mr = JSON.parse((await run(['glab', 'mr', 'view', '-F', 'json'])) || 'null')
    return mr && `!${mr.iid} ${String(mr.state).toUpperCase()} ${mr.title}`
  }
  const branch = await run(['git', 'branch', '--show-current'])
  if (!branch) return undefined
  if (host === 'AZURE DEVOPS') {
    const args = ['repos', 'pr', 'list', '--source-branch', branch, '--status', 'active', '--query', '[0].[pullRequestId,status,title]', '-o', 'tsv']
    // shortcut: run by name with no shell; where az is only a .cmd script (Windows) it may not start, and the PR line stays hidden.
    const [id, state, ...title] = ((await run(['az', ...args])) ?? '').split('\t')
    return id ? `#${id} ${state?.toUpperCase()} ${title.join(' ')}` : undefined
  }
  if (host === 'BITBUCKET') {
    // shortcut: no official CLI, so the unauthenticated REST API covers public repos only; add a token when private ones are needed.
    const q = encodeURIComponent(`source.branch.name="${branch}" AND state="OPEN"`)
    const res = JSON.parse((await fetchText(`https://api.bitbucket.org/2.0/repositories/${repo}/pullrequests?q=${q}&fields=values.id,values.state,values.title`)) || 'null')
    const p = res?.values?.[0]
    return p && `#${p.id} ${p.state} ${p.title}`
  }
  return undefined
}
// The CIM query's three CSV tables -> CPU % (average over processors), RAM in KB, and GPU % as Task Manager shows it:
// each engine type's utilization summed, the busiest type wins, capped at 100; undefined when there are no GPU counters.
export function parseSys(out: string): { cpu: number; memTotal: number; memFree: number; gpu?: number } | undefined {
  let header = ''
  const cpus: number[] = []
  let memTotal = 0, memFree = 0
  const byType = new Map<string, number>()
  for (const line of out.split(/\r?\n/)) {
    const cells = line.trim().split('","').map(c => c.replace(/^"|"$/g, ''))
    if (!line.trim()) continue
    if (cells[0] === 'LoadPercentage' || cells[0] === 'TotalVisibleMemorySize' || cells[0] === 'Name') { header = cells[0]; continue }
    if (header === 'LoadPercentage') cpus.push(Number(cells[0]))
    else if (header === 'TotalVisibleMemorySize') { memTotal = Number(cells[0]); memFree = Number(cells[1]) }
    else if (header === 'Name') {
      const type = /engtype_(.+)$/.exec(cells[0] ?? '')?.[1]
      if (type) byType.set(type, (byType.get(type) ?? 0) + (Number(cells[1]) || 0))
    }
  }
  const cpuOk = cpus.filter(n => !Number.isNaN(n))
  if (!cpuOk.length) return undefined
  return {
    cpu: Math.round(cpuOk.reduce((a, b) => a + b, 0) / cpuOk.length),
    memTotal, memFree,
    gpu: byType.size ? Math.min(100, Math.max(...byType.values())) : undefined,
  }
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
// ISO reset time -> local "14:30", or "Thu 14:30" with the weekday
const resetAt = (iso: string, withDay: boolean) => {
  const d = new Date(iso)
  return `${withDay ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ` : ''}${d.toTimeString().slice(0, 5)}`
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
  for (const hunk of patch ?? []) for (const l of hunk.lines) {
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
type TodoWords = { status: string; words: Set<string> }
function stepState(step: Plan['steps'][number], list: TodoWords[]): 'done' | 'doing' | 'todo' {
  if (step.isChecked) return 'done'
  const ws = words(step.text)
  if (!ws.length) return 'todo'
  const match = (t: TodoWords) => ws.filter(w => t.words.has(w)).length / ws.length >= 0.5
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
const detail = (input: Record<string, unknown>) => {
  const v = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.description ?? input.query ?? ''
  return String(v).replace(/\s+/g, ' ').slice(0, 80)
}

// A fork's current activity from its latest tool call: the tool and what it is about.
function forkActivity(tool: string, input: Record<string, unknown>, task?: string) {
  if (/^(Task|Todo)/.test(tool)) return task
  const d = detail(input)
  return (d ? `${tool.replace(/^mcp__/, '')} ${d}` : tool).slice(0, 120)
}

// Background work: a failure is dropped, never an unhandled rejection.
function quiet(p: Promise<unknown>) {
  p.catch(() => undefined)
}

// Per-call data lives in module memory; flushNow writes only the keys marked dirty, at most once a
// second (flushSoon) and at the end of each turn. A plain tool call never writes state itself.
type Dirty = 'perms' | 'gate' | 'mcp' | 'forks' | 'requests' | 'live'
// act: what the fork is doing now; task: the activeForm of its task in progress, which wins over act.
type ForkCount = { tools: number; lastIn: number; out: number; act?: string; task?: string }
type McpStat = { calls: number; errors: number; totalMs: number; lastAt?: number }
const logBuf: LogLine[] = []
const permMap = new Map<string, Perm>()
const forkCounts = new Map<string, ForkCount>()
const mcpStats = new Map<string, McpStat>()
const dirty = new Set<Dirty>()
let gateMem: Gate = EMPTY_GATE
let reqTools = 0 // tool calls of the open request not yet written
let reqsDelta = 0 // model requests not yet written
let livePatch: Partial<Live> = {}

function log(level: Level, text: string, isSub = false) {
  logBuf.push({ at: Date.now(), level, text: text.slice(0, 300), isSub })
  if (logBuf.length > MAX_LOGS) logBuf.splice(0, logBuf.length - MAX_LOGS)
}
function countTool(tool: string, denied: boolean) {
  const one = permMap.get(tool) ?? { tool, ok: 0, denied: 0 }
  permMap.set(tool, { ...one, ok: one.ok + (denied ? 0 : 1), denied: one.denied + (denied ? 1 : 0) })
}
function forkCount(id: string): ForkCount {
  let c = forkCounts.get(id)
  if (!c) forkCounts.set(id, (c = { tools: 0, lastIn: 0, out: 0 }))
  return c
}
function flushNow($: EngineInterface, withLogs = false) {
  const keys = new Set(dirty)
  dirty.clear()
  const jobs: Promise<unknown>[] = []
  if (withLogs) jobs.push(update($, logs, () => logBuf.slice()))
  if (keys.has('perms')) jobs.push(update($, perms, () => [...permMap.values()].sort((a, b) => b.ok + b.denied - a.ok - a.denied)))
  if (keys.has('gate')) jobs.push(update($, gate, () => gateMem))
  if (keys.has('mcp')) jobs.push(update($, mcp, list => {
    const out = list.map(x => ({ ...x, ...mcpStats.get(x.name) }))
    for (const [name, st] of mcpStats) if (!out.some(x => x.name === name)) out.push({ ...blankServer(name, 'connected'), ...st })
    return out
  }))
  if (keys.has('forks')) jobs.push(update($, forks, list => list.map(f => {
    const c = forkCounts.get(f.id)
    return c ? { ...f, tools: c.tools, lastIn: c.lastIn, out: c.out, act: c.task ?? c.act ?? f.act } : f
  })))
  if (keys.has('requests')) {
    const n = reqTools
    reqTools = 0
    jobs.push(update($, requests, list => list.map((q, i) => (i === list.length - 1 && !q.isDone ? { ...q, tools: q.tools + n } : q))))
  }
  if (keys.has('live')) {
    const d = reqsDelta, patch = livePatch
    reqsDelta = 0
    livePatch = {}
    jobs.push(update($, liveInfo, l => ({ ...l, ...patch, reqs: l.reqs + d })))
  }
  return Promise.all(jobs)
}

let lastCtx = ''
// /context's breakdown, estimated locally ('summary' sends no request); written only when it changed
async function ctxSample($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!b) return
  const byServer: Ctx['mcp'] = {}
  for (const t of b.mcpTools) {
    const k = mcpServer(t.name)
    if (!k) continue
    const x = (byServer[k] ??= { tokens: 0, loaded: 0, inCtx: 0 })
    x.tokens += t.tokens
    if (t.isLoaded) { x.loaded++; x.inCtx += t.tokens }
  }
  const v: Ctx = { used: b.totalTokens, max: b.rawMaxTokens, rows: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind }))
    .sort((a, z) => Number(a.kind === 'free') - Number(z.kind === 'free') || z.tokens - a.tokens), mcp: byServer,
    memory: b.memoryFiles.map(f => ({ path: f.path, type: f.type, tokens: f.tokens })).sort((a, z) => z.tokens - a.tokens),
    skills: (b.skills?.skillFrontmatter ?? []).map(k => ({ name: k.name, tokens: k.tokens })).sort((a, z) => z.tokens - a.tokens).slice(0, 30),
    skillsTotal: b.skills?.totalSkills ?? 0,
    compactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    model: b.model }
  const json = JSON.stringify(v)
  if (json !== lastCtx) { lastCtx = json; await update($, ctxInfo, () => v) }
}

const DEFAULT_THEME: ThemeState = { name: 'default', base: 'default', custom: {} }
const repoThemeKey = (root: string) => `prodash.theme.repo:${root}`
// Which theme draws the pane: forced global, else the repo's own, else global.
export const themeInForce = (c: ThemeCfg): ThemeState => (c.force ? c.global : c.repo ?? c.global) ?? DEFAULT_THEME
// Which theme the THEME view edits: global when forced or scoped global, else the repo's.
const themeTarget = (c: ThemeCfg) => (c.force || c.scope === 'global' ? 'global' : 'repo') as 'global' | 'repo'

async function setThemeCfg($: EngineInterface, fn: (c: ThemeCfg) => ThemeCfg) {
  const c = await update($, themeCfg, fn)
  await update($, theme, () => themeInForce(c))
  return c
}
async function setTheme($: EngineInterface, fn: (t: ThemeState) => ThemeState) {
  const cur = await read($, theme)
  const c = await setThemeCfg($, c => {
    const target = themeTarget(c)
    // the theme on screen is the starting point when it is the one being edited (or the repo has none yet)
    const from = (target === 'global') === (c.force || !c.repo) ? cur : c[target] ?? (target === 'global' ? DEFAULT_THEME : cur)
    return { ...c, [target]: fn(from) }
  })
  const target = themeTarget(c)
  await $.store.set(target === 'global' ? 'prodash.theme' : repoThemeKey(c.root), c[target]).catch(() => undefined)
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
    // cap: drop the oldest completed tasks past 100
    if (t?.id) await update($, todos, list => {
      const kept = [...list.filter(x => x.id !== t.id), { id: t.id!, content: t.subject ?? '', status: 'pending' }]
      while (kept.length > 100) {
        const k = kept.findIndex(x => x.status === 'completed')
        kept.splice(k >= 0 ? k : 0, 1)
      }
      return kept
    })
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


  on('session.measure', async ($, e, next) => {
    quiet(ctxSample($))
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prodash', description: 'Open the Pro Dash pane' }).catch(() => undefined)
    await update($, usage, u => ({ ...u, startedAt: u.startedAt || Date.now() })).catch(() => undefined)
    sessionCwd = await $.session.cwd().catch(() => '')
    const root = (await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: sessionCwd, timeoutMs: 8000 })
      .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')) || sessionCwd
    const [g, r, f] = await Promise.all(['prodash.theme', repoThemeKey(root), 'prodash.theme.force'].map(k => $.store.get(k).catch(() => undefined)))
    const cfg: ThemeCfg = { global: isTheme(g) ? g : undefined, repo: isTheme(r) ? r : undefined, force: f === true, scope: isTheme(r) ? 'repo' : 'global', root }
    await setThemeCfg($, () => cfg).catch(() => undefined)
    // seed module memory from what an earlier load stored
    await Promise.all([
      read($, logs).then(v => { if (!logBuf.length) logBuf.push(...v) }),
      read($, perms).then(v => { if (!permMap.size) for (const x of v) permMap.set(x.tool, x) }),
      read($, gate).then(v => { if (!gateMem.total) gateMem = v }),
      read($, mcp).then(v => { if (!mcpStats.size) for (const x of v) if (x.calls) mcpStats.set(x.name, { calls: x.calls, errors: x.errors, totalMs: x.totalMs, lastAt: x.lastAt }) }),
      read($, forks).then(v => { for (const f of v) if (!forkCounts.has(f.id)) forkCounts.set(f.id, { tools: f.tools, lastIn: f.lastIn, out: f.out, act: f.act }) }),
    ]).catch(() => undefined)

    // Agents: every 250ms while a fork is alive, every 1s otherwise; a new fork shows up on the next poll.
    let tick = 0
    const pollAgents = async () => {
      const anyLive = [...forkStatus.values()].some(st => LIVE.includes(st))
      if (!anyLive && tick++ % 4) return
      const list = await $.agent.list()
      const changed = list.length !== forkStatus.size || list.some(a => forkStatus.get(a.id) !== a.status)
      if (!changed) return
      for (const id of [...names.keys()]) if (!list.some(a => a.id === id)) names.delete(id)
      for (const id of [...forkCounts.keys()]) if (!list.some(a => a.id === id)) forkCounts.delete(id)
      for (const a of list) {
        names.set(a.id, a.description || a.name || a.type)
        const was = forkStatus.get(a.id)
        if (!was) log('INFO', `${names.get(a.id)}: spawned → fork`)
        if (was && was !== a.status && (a.status === 'failed' || a.status === 'killed'))
          log(a.status === 'failed' ? 'ERROR' : 'WARN', `${names.get(a.id)}: ${a.status}`, true)
        if (was && was !== a.status && a.status === 'completed') log('SUCCESS', `${names.get(a.id)}: completed`, true)
      }
      forkStatus.clear()
      for (const a of list) forkStatus.set(a.id, a.status)
      const now = Date.now()
      // merge into the current value so concurrent tools/tokens increments are kept
      await update($, forks, cur => {
        const byId = new Map(cur.map(f => [f.id, f]))
        return list.map(a => {
          const old = byId.get(a.id)
          const c = forkCounts.get(a.id)
          return { id: a.id, name: names.get(a.id) ?? a.id, status: a.status, since: old?.since ?? now, tools: c?.tools ?? old?.tools ?? 0, lastIn: c?.lastIn ?? old?.lastIn ?? 0, out: c?.out ?? old?.out ?? 0, act: c?.task ?? c?.act ?? old?.act }
        })
      })
    }
    $.clock.every(250, () => quiet(pollAgents()))

    // Usage: write only when a figure changed; otherwise just redraw so the clocks tick.
    const pollUsage = async () => {
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
    }
    $.clock.every(1000, () => {
      quiet(pollUsage())
      if (dirty.size) quiet(flushNow($)) // what hooks left in memory (counters, gate, forks) is written once a second
    })

    // System load: Windows via CIM. shortcut: Windows only, add /proc or vm_stat for other OSes.
    let sysBusy = false
    const sample = async () => {
      if (sysBusy) return
      sysBusy = true
      // Read-only CIM query, fixed text, cmdlets only (no variables or script blocks): three CSV tables, read by parseSys.
      const r = await $.process.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Processor | Select-Object LoadPercentage | ConvertTo-Csv -NoTypeInformation; Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Csv -NoTypeInformation; Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Select-Object Name,UtilizationPercentage | ConvertTo-Csv -NoTypeInformation'],
        { timeoutMs: 8000 },
      ).catch(() => undefined).finally(() => { sysBusy = false })
      const m = parseSys(r?.stdout ?? '')
      if (!m) return
      await update($, sys, s => ({
        load: m.cpu,
        gpu: m.gpu,
        memTotal: m.memTotal / 1048576,
        memUsed: (m.memTotal - m.memFree) / 1048576,
        hist: push(s.hist, m.cpu),
      }))
    }
    quiet(sample())
    // shortcut: one short-lived PowerShell per sample; a long-lived streaming process would cost less CPU.
    $.clock.every(15000, () => quiet(sample()))

    // Git: status every 5s (30s outside a repo); log only when HEAD moves; remote + PR every 60s.
    const cwd = sessionCwd
    const run = (argv: string[]) =>
      $.process.run(argv, { cwd, timeoutMs: 8000 }).then(r => (r.exitCode === 0 ? r.stdout.trim() : undefined), () => undefined)
    let pr: string | undefined
    let repo: string | undefined
    let host: string | undefined
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
        g.host = host
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
      const r = remote ? parseRemote(remote) : undefined
      repo = r?.repo
      host = r?.host
      const fetchText = (url: string) => $.http.fetch(url).then(x => (x.ok ? x.text : undefined), () => undefined)
      pr = (r && await prFor(run, fetchText, r).catch(() => undefined)) || undefined
      lastOid = '' // let the next status re-read the last commit (it may say "(5 minutes ago)")
    }
    if ((await read($, requests).catch(() => [1])).length === 0) {
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
    quiet(ctxSample($))
    $.clock.every(30000, () => quiet(Promise.all([mcpSample(), ctxSample($)])))
    const model = await $.session.model().catch(() => undefined)
    if (model) await update($, liveInfo, l => ({ ...l, model: l.model ?? model }))
    quiet(prSample().then(gitSample))
    $.clock.every(10000, () => quiet(gitSample()))
    $.clock.every(60000, () => quiet(prSample()))

    quiet($.ui.open({ id: PANE, title: 'Pro Dash', columns: 999, rows: 40 }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    quiet(update($, liveInfo, l => ({ ...l, isBusy: true })))
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  // Each model request: count it, note model/effort.
  on('turn.step', async function* ($, e, next) {
    reqsDelta++
    if (!e.agentId) livePatch = { ...livePatch, model: e.model, ...(e.effort === undefined ? {} : { effort: String(e.effort) }) }
    dirty.add('live')
    const it = next(e)
    let step = await it.next()
    while (!step.done) {
      const c = step.value as { kind?: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null }
      if (e.agentId && c.kind === 'stop' && c.usage) {
        const u = c.usage
        const fc = forkCount(e.agentId)
        fc.lastIn = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        fc.out += u.output_tokens
        dirty.add('forks')
      }
      yield step.value
      step = await it.next()
    }
    return step.value
  })

  // The Perms view's record of one call's permission check. The mod has no hook on tool.check: the tool.call hook
  // asks $.tool.check for the session's verdict (a query: nothing runs, no dialog, no classifier) and records it here.
  type Verdict = { decision: string; reason?: string; rule?: string; setting?: unknown; hook?: unknown; plugin?: unknown }
  const recordCheck = (verdict: Verdict, id: string, tool: string, input: Record<string, unknown>, agentId: string | undefined, isReadOnly: boolean, at: number) => {
    const kind: GateKind = verdict.decision === 'allow' ? 'a' : verdict.decision === 'deny' ? 'd' : 'p'
    const via = verdict.decision === 'ask'
      ? (!verdict.plugin && modes.includes('auto') ? 'classifier' : 'person')
      : verdict.rule ? 'rule' : verdict.setting ? 'setting' : verdict.hook ? 'hook' : 'mode'
    if (kind === 'p') pending.set(id, at)
    const ev: GateEvent = {
      id, at, tool, cat: toolCat(tool), kind, via, detail: detail(input),
      reason: verdict.reason?.slice(0, 200), rule: verdict.rule, agent: agentId, isReadOnly,
    }
    const g = gateMem
    const rules = verdict.rule
      ? [...g.rules.filter(x => x.rule !== verdict.rule), { rule: verdict.rule, n: (g.rules.find(x => x.rule === verdict.rule)?.n ?? 0) + 1 }].sort((a, b) => b.n - a.n).slice(0, 20)
      : g.rules
    gateMem = {
      ...g,
      events: [...g.events, ev].slice(-GATE_MAX),
      total: g.total + 1,
      counts: { ...g.counts, [kind]: g.counts[kind] + 1 },
      cats: { ...g.cats, [ev.cat]: g.cats[ev.cat] + 1 },
      reads: g.reads + (isReadOnly ? 1 : 0),
      writes: g.writes + (isReadOnly ? 0 : 1),
      main: g.main + (agentId ? 0 : 1),
      forks: g.forks + (agentId ? 1 : 0),
      rules,
    }
    dirty.add('gate')
  }

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
    await update($, liveInfo, l => ({ ...l, compactions: l.compactions + 1 })).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('command.run', { command: 'prodash' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Pro Dash', focus: true, columns: 999, rows: 40 })
    return { text: 'Pro Dash opened. Keys 1–5 trigger the action bar.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.text.trim()) log('USER', `you: ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    if (e.text.trim() && !e.command)
      quiet(update($, requests, list => [...list, { at: Date.now(), text: e.text.replace(/\s+/g, ' ').slice(0, 200), tools: 0, isDone: false }].slice(-50)))
    return next(e)
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('tool.call', async ($, e, next) => {
    const raw = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const who = e.agentId ? names.get(e.agentId) ?? 'fork' : 'main'
    if (tool === 'TodoWrite' && Array.isArray(raw.todos))
      quiet(update($, todos, list => [...list.filter(t => t.id), ...(raw.todos as Todo[]).map(t => ({ content: t.content, status: t.status }))]))
    if (!e.agentId) {
      reqTools++
      dirty.add('requests')
    } else {
      const fc = forkCount(e.agentId)
      fc.tools++
      fc.act = forkActivity(tool, raw, fc.task)
      if (/^Task(Create|Update)$/.test(tool)) fc.task = raw.status === 'in_progress' && raw.activeForm ? String(raw.activeForm).slice(0, 120) : raw.status === 'completed' ? undefined : fc.task
      dirty.add('forks')
    }

    const t0 = Date.now()
    // the verdict the call will get, asked before it is checked (tool.call runs ahead of the permission check)
    const verdict = e.tool_use_id ? await $.tool.check({ tool, input: raw } as never).catch(() => undefined) : undefined
    const r = await next(e)
    if (verdict) recordCheck(verdict as Verdict, e.tool_use_id, tool, raw, e.agentId, (r as { isReadOnly?: boolean }).isReadOnly === true, t0)
    const denied = 'deny' in r && r.deny !== undefined
    const srv = mcpServer(tool)
    if (srv) {
      const ms = Date.now() - t0, failed = denied || (r as { isError?: boolean }).isError === true
      const st = mcpStats.get(srv) ?? { calls: 0, errors: 0, totalMs: 0 }
      mcpStats.set(srv, { calls: st.calls + 1, errors: st.errors + (failed ? 1 : 0), totalMs: st.totalMs + ms, lastAt: Date.now() })
      dirty.add('mcp')
    }
    if (!denied) void board($, tool, raw, (r as { result?: unknown }).result).catch(() => undefined)
    const id = e.tool_use_id
    // Only a call that waited on an ask writes here (keeps tool calls cheap).
    if (pending.delete(id)) {
      const rr = r as { isError?: boolean; text?: string }
      // shortcut: no event says "the ask was refused"; an errored result worded as a refusal stands for it.
      const refused = denied || (rr.isError === true && DENIAL.test(rr.text ?? ''))
      const ev = gateMem.events.find(x => x.id === id && x.kind === 'p')
      if (ev) {
        gateMem = settle(gateMem, id, refused ? 'd' : ev.via === 'classifier' ? 'c' : 'h', Date.now())
        dirty.add('gate')
      }
    }
    const isError = !denied && (r as { isError?: boolean }).isError === true
    log(denied ? 'WARN' : isError ? 'ERROR' : 'SUCCESS',
      `${who}: ${tool} → ${denied ? `denied (${r.deny})` : detail(raw)}`, !!e.agentId)
    countTool(tool, denied)
    dirty.add('perms')
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r.usage
    const cost = (await $.session.usage().catch(() => undefined))?.cost?.usd
    // an ask whose call never came back within 15 min was refused before it ran
    const old15 = Date.now() - 15 * 60_000
    for (const [id, at] of pending) if (at < old15) {
      pending.delete(id)
      gateMem = settle(gateMem, id, 'd', Date.now())
      dirty.add('gate')
    }
    // the batch first: it adds the open request's tool calls before the request is closed
    await flushNow($, true).catch(() => undefined)
    await Promise.all([
      e.agentId ? undefined : update($, liveInfo, l => ({ ...l, isBusy: false })),
      e.agentId ? undefined : update($, requests, list => list.map((q, i) => (i === list.length - 1 && !q.isDone ? { ...q, isDone: true, durationMs: e.durationMs } : q))),
      update($, usage, old => ({
      ...old,
      tokens: old.tokens + (u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0),
      usd: cost,
    })),
    ]).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    modes = [...e.props.modes]
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const W = e.props.bodyColumns
    const H = Math.max(12, e.viewport?.rows ?? 30)
    const [s, u, fl, m, lv, gh, servers, th, cx] = await Promise.all([read($, sys), read($, usage), read($, forks), read($, mode), read($, liveInfo), read($, git), read($, mcp), read($, theme), read($, ctxInfo)])
    pal = resolveTheme(th)
    const live = fl.filter(f => LIVE.includes(f.status))
    const now = Date.now()
    // w: the box's outer width in cells, so its title can be centered on the top border
    const box = (title: string, grow: number, body: RenderChildren, w = W) => {
      const t = title.slice(0, Math.max(1, w - 6))
      const left = Math.max(1, Math.floor((w - (t.length + 2)) / 2))
      // The title is painted over the top border from a borderless wrapper (row 0 of the wrapper is
      // the border row): the terminal clips what a bordered box draws outside its own content.
      return (
        <Box flexDirection="column" flexGrow={grow} width={w === W ? undefined : w} flexShrink={0} minWidth={0}>
          <Box flexDirection="column" borderStyle="round" borderColor={tc(CYAN)} paddingX={1} flexGrow={1} minWidth={0}>
            {body}
          </Box>
          <Box position="absolute" top={0} left={left} width={t.length + 2}>
            <Text wrap="truncate-end"><Text> </Text><Text color={tc(CYAN)} bold>{t}</Text><Text> </Text></Text>
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
          <Text wrap="truncate-end"><Text color={tc(status === 'ONLINE' ? '#5fd75f' : status === 'DEGRADED' ? '#ff5f5f' : '#ffd75f')}>● {status}</Text></Text>
          <Text wrap="truncate-end">CPU <Text color={tc(loadColor(load))}>{bar(load, Math.max(3, inner - 9))}</Text> {s.load === undefined ? 'n/a' : `${load}%`}</Text>
          <Text wrap="truncate-end">GPU <Text color={tc(loadColor(s.gpu ?? 0))}>{bar(s.gpu ?? 0, Math.max(3, inner - 9))}</Text> {s.gpu === undefined ? 'n/a' : `${s.gpu}%`}</Text>
          <Text wrap="truncate-end">RAM {s.memTotal ? `${(s.memUsed ?? 0).toFixed(1)}/${s.memTotal.toFixed(0)}G` : 'n/a'}</Text>
          <Text wrap="truncate-end"><Text color={tc('#5fd75f')}>{spark(s.hist, inner)}</Text></Text>
        </Box>, wThird)}
        {box('AGENT OVERVIEW', 2, <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text wrap="truncate-end" color={tc('#ff875f')} bold>{lv.model ? modelName(lv.model) : '—'}{gh.branch ? ` · ${gh.branch}` : ''}</Text>
            <Text color={tc(lv.isBusy ? '#5fd75f' : '#8a8a8a')}>{lv.isBusy ? '● busy' : '○ idle'}</Text>
          </Box>
          <Text wrap="truncate-end">effort <Text color={tc('#ff875f')}>{'▮'.repeat(EFFORTS.indexOf(lv.effort ?? '') + 1)}{'▯'.repeat(5 - EFFORTS.indexOf(lv.effort ?? '') - 1)}</Text> <Text bold>{lv.effort ?? '—'}</Text>{modes.length ? `  mode ${modes.join(',')}` : ''}  <Text bold>${(u.usd ?? 0).toFixed(2)}</Text> <Text dimColor>· {lv.reqs} req</Text></Text>
          <Text wrap="truncate-end">ctx <Text color={tc('#ff875f')}>{bar(u.ctx ?? 0, Math.max(4, Math.min(12, wide - 28)))}</Text> <Text bold>{u.ctx ?? 0}%</Text> {u.ctxTokens !== undefined && u.ctxWindow ? `${kTok(u.ctxTokens)}/${kTok(u.ctxWindow)}` : ''}{lv.compactions ? <Text color={tc('#ffd75f')}> ↺{lv.compactions}</Text> : ''}</Text>
          {/* one row per window, both always drawn; the API reports a window only once a response carried its reading */}
          {([['five_hour', '5h  '], ['seven_day', 'week']] as const).map(([kind, label]) => {
            const r = (u.limits ?? []).find(x => x.kind === kind)
            return <Text key={`lim-${kind}`} wrap="truncate-end">{label} {r
              ? <Text><Text color={tc(loadColor(r.pct))}>{bar(r.pct, 5)}</Text> <Text bold color={tc(loadColor(r.pct))}>{`${Math.round(r.pct)}%`.padStart(4)}</Text>{r.resetsAt ? <Text dimColor>  resets {resetAt(r.resetsAt, kind === 'seven_day')} ({until(r.resetsAt, now)})</Text> : ''}</Text>
              : <Text dimColor>no reading yet</Text>}</Text>
          })}
        </Box>, W - wThird)}
      </Box>
    )

    const go = (to: Mode) => () => update($, mode, cur => (cur === to ? 'main' : to))
    // plain buttons draw as `1: Forks`, so all six fit one row; the open view is the bright one
    const ACTIONS: [string, Mode][] = [['Forks', 'agents'], ['Perms', 'perms'], ['Board', 'board'], ['MCP', 'mcp'], ['Context', 'context'], ['Theme', 'theme']]
    const actions = box('ACTION BAR', 0, <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
      {ACTIONS.map(([label, to], i) => (
        <Button key={`a${i + 1}`} hotkey={String(i + 1)} label={label} plain dimColor={m !== to} onPress={go(to)} />
      ))}
    </Box>)

    // ---- Context / MCP: the main view shows the top rows of each at equal size; keys 4 and 5 show everything
    const TOP = 4
    const half = Math.floor(W / 2)
    const CTX_COLORS = ['#5f87ff', '#ff875f', '#00af87', '#d7af00', '#af87ff', '#5fd7d7', '#d75f87', '#87af5f']
    const usedRows = cx.rows.filter(r => r.kind === 'used')
    const colorOf = (r: Ctx['rows'][number]) => (r.kind === 'used' ? CTX_COLORS[usedRows.indexOf(r) % CTX_COLORS.length]! : r.kind === 'buffer' ? '#6c6c6c' : '#3a3a3a')
    const pctOf = (n: number) => `${((n / (cx.max || 1)) * 100).toFixed(1)}%`
    const ctxPct = cx.max ? Math.round((cx.used / cx.max) * 100) : 0
    const stack = (width: number) => {
      const parts = usedRows.map(r => ({ n: Math.round((r.tokens / (cx.max || 1)) * width), c: colorOf(r) }))
      const free = Math.max(0, width - parts.reduce((n, x) => n + x.n, 0))
      return <Text wrap="truncate-end">{parts.map((x, i) => <Text key={`cb-${i}`} color={tc(x.c)}>{'█'.repeat(x.n)}</Text>)}<Text dimColor>{'░'.repeat(free)}</Text></Text>
    }
    const ctxRow = (r: Ctx['rows'][number], i: number) => (
      <Box key={`cx-${i}`} justifyContent="space-between">
        <Text wrap="truncate-end"><Text color={tc(colorOf(r))}>■</Text> <Text dimColor={r.kind !== 'used'}>{r.name}</Text></Text>
        <Box flexShrink={0} marginLeft={1}><Text dimColor={r.kind === 'deferred'}>{kTok1(r.tokens).padStart(6)} {(r.kind === 'deferred' ? '—' : pctOf(r.tokens)).padStart(5)}</Text></Box>
      </Box>
    )
    const ctxHead = (
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">{ctxPct}% used</Text>
        <Box flexShrink={0} marginLeft={1}><Text dimColor>{kTok1(cx.used)} / {kTok(cx.max)}</Text></Box>
      </Box>
    )
    const freeRow = cx.rows.find(r => r.kind === 'free')
    const ctxBox = box('CONTEXT', 1, <Box flexDirection="column">
      {cx.rows.length === 0 && <Text dimColor>no breakdown yet</Text>}
      {cx.rows.length > 0 && ctxHead}
      {cx.rows.length > 0 && stack(Math.max(8, half - 4))}
      {usedRows.slice(0, TOP).map((r, i) => ctxRow(r, i))}
      {freeRow && ctxRow(freeRow, 99)}
    </Box>, half)

    const mcpTok = (name: string) => cx.mcp[name]?.tokens ?? 0
    const sortedMcp = [...servers].sort((a, b) => (a.status === 'connected' ? 1 : 0) - (b.status === 'connected' ? 1 : 0) || mcpTok(b.name) - mcpTok(a.name) || b.calls - a.calls)
    const nConn = servers.filter(x => x.status === 'connected').length
    const nTools = servers.reduce((n, x) => n + x.tools, 0)
    const nBad = servers.filter(x => x.status === 'failed' || x.status === 'needs-auth').length
    const allTok = Object.values(cx.mcp).reduce((n, t) => n + t.tokens, 0)
    const inCtxTok = Object.values(cx.mcp).reduce((n, t) => n + t.inCtx, 0)
    const mcpSummary = <Text wrap="truncate-end"><Text color={tc('#5fd75f')}>{nConn} connected</Text> · {nTools} tools{allTok ? ` · ${kTok1(allTok)}` : ''}{nBad ? <Text color={tc('#ff5f5f')}> · {nBad} failed</Text> : ''}{servers.length - nConn - nBad > 0 ? <Text color={tc('#ffd75f')}> · {servers.length - nConn - nBad} other</Text> : ''}</Text>
    const MCP_TOP = TOP + 1 // the Context box has a bar line the MCP box does not
    const mcpBox = box('MCP SERVERS', 1, <Box flexDirection="column">
      {mcpSummary}
      {servers.length === 0 && <Text dimColor>no MCP servers connected</Text>}
      {sortedMcp.slice(0, MCP_TOP).map(x => {
        const [g, c] = MCP_GLYPH[x.status]
        return (
          <Box key={`mcp-${x.name}`} justifyContent="space-between">
            <Text wrap="truncate-end"><Text color={tc(c)}>{g}</Text> {x.name}</Text>
            <Box flexShrink={0} marginLeft={1}>{x.status === 'connected' ? <Text>{(cx.mcp[x.name] ? kTok1(mcpTok(x.name)) : '—').padStart(6)}</Text> : <Text color={tc(c)}>{x.status}</Text>}</Box>
          </Box>
        )
      })}
      {servers.length > MCP_TOP && <Text dimColor>… +{servers.length - MCP_TOP} more · 4 for all</Text>}
    </Box>, W - half)
    // the MCP / Context row (TOP + 3 lines and two borders), left out where its own detail view is open
    const hasRow = m !== 'mcp' && m !== 'context'
    const room = Math.max(3, H - 14 - (hasRow ? TOP + 5 : 0))
    const back = <Button key="back" label="BACK" onPress={() => update($, mode, () => 'main' as Mode)} />
    let body: RenderChildren

    // One row per loop: main first, then each fork; ● marks the one in view, a press opens its transcript.
    const viewed = e.props.view.agentId
    const rowW = Math.max(20, W - 4)
    const row = (key: string, kind: string, name: string, right: string, isOn: boolean, isEnded: boolean, onPress: () => unknown, act = '') => {
      // Time and tokens sit outside the Button with a fixed width, so a long name is what gets cut.
      const nameW = Math.max(4, rowW - 2 - 6 - right.length - 4)
      const shown = name.length > nameW ? `${name.slice(0, nameW - 1)}…` : name
      // The activity takes what is left after the name.
      const actW = nameW - shown.length - 3
      const doing = act && actW >= 6 ? (act.length > actW ? `${act.slice(0, actW - 1)}…` : act) : ''
      return (
        <Box key={`r-${key}`} justifyContent="space-between">
          <Button key={key} plain onPress={onPress}>
            <Text color={tc(isOn ? '#ffffff' : '#8a8a8a')}>{isOn ? '●' : '○'} </Text>
            <Text bold={isOn} dimColor={!isOn}>{kind.padEnd(6)}</Text>
            <Text bold={isOn} dimColor={!isOn || isEnded}>{shown}</Text>
            {doing && <Text color={tc('#6c6c6c')}> · {doing}</Text>}
          </Button>
          {right && <Box flexShrink={0} marginLeft={1}><Text dimColor={!isOn}>{right}</Text></Box>}
        </Box>
      )
    }
    // main, then the last `limit` forks; withTools adds each fork's tool calls (the full-screen list)
    const forkRows = (limit: number, withTools: boolean) => [
      row('f-main', 'main', '', `${span(now - (u.startedAt || now))} · ↓ ${kTok1(u.tokens)} tokens`, viewed === undefined, false, () => $.ui.view({})),
      ...fl.slice(-limit).map(f => row(
        `f-${f.id}`, 'fork', f.name,
        `${withTools ? `${f.tools} tools · ` : ''}${span(now - f.since)} · ↓ ${kTok1(f.lastIn + f.out)} tokens`,
        viewed === f.id, !LIVE.includes(f.status),
        () => $.ui.view({ agentId: f.id }),
        LIVE.includes(f.status) ? f.act : '',
      )),
    ]

    if (m === 'agents') {
      // Active Forks at full height, with each fork's tool calls
      const limit = Math.max(2, room - 4)
      body = box('FORKS — opens the agent transcript', 1, <Box flexDirection="column">
        {forkRows(limit, true)}
        {fl.length === 0 && <Text dimColor>No subagents in this session.</Text>}
        {fl.length > limit && <Text dimColor>… +{fl.length - limit} earlier</Text>}
        {back}
      </Box>)
    } else if (m === 'perms') {
      const [list, g] = await Promise.all([read($, perms), read($, gate)])
      const cols = Math.max(10, W - 4)
      const strip = g.events.slice(-cols * 2)
      const rows = [strip.slice(0, Math.max(0, strip.length - cols)), strip.slice(-cols)].filter(x => x.length)
      const sq = (k: GateKind, label: string, n: number) => <Text><Text color={tc(GATE_COLOR[k])}>{k === 'd' ? '✗' : '■'}</Text> {n} {label}  </Text>
      const avgWait = g.waits ? `${(g.waitMs / g.waits / 1000).toFixed(1)}s` : '—'
      const recent = g.events.filter(x => x.kind !== 'a').slice(-Math.max(3, room - 16)).reverse()
      const VIA: Record<string, string> = { c: 'classifier', h: 'approved', p: 'pending', d: 'denied' }
      body = box('PERMISSIONS', 1, <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text color={tc('#5fd75f')} bold>GATE · permissions</Text>
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
          return <Text wrap="truncate-end">{runs.map(([k, n]) => <Text color={tc(GATE_COLOR[k])}>{'■'.repeat(n)}</Text>)}</Text>
        })}
        <Text wrap="wrap">{sq('a', 'allowed', g.counts.a)}{sq('c', 'classifier', g.counts.c)}{sq('h', 'approved', g.counts.h)}{sq('p', 'pending', g.counts.p)}{sq('d', 'denied', g.counts.d)}</Text>
        <Text wrap="truncate-end"><Text bold>f:</Text> file {g.cats.f}  <Text bold>s:</Text> shell {g.cats.s}  <Text bold>o:</Text> other {g.cats.o}   <Text dimColor>read {g.reads} · write {g.writes}</Text></Text>
        <Text wrap="truncate-end">main {g.main} · forks {g.forks}   <Text dimColor>avg approval wait</Text> {avgWait}   <Text dimColor>auto-approve rate</Text> {g.total ? Math.round(((g.counts.a + g.counts.c) / g.total) * 100) : 0}%</Text>
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            <Text color={tc(CYAN)} bold>TOP RULES</Text>
            {g.rules.length === 0 && <Text dimColor>no rule decided yet</Text>}
            {g.rules.slice(0, 5).map(x => <Text wrap="truncate-end"><Text dimColor>{String(x.n).padStart(4)}×</Text> {x.rule}</Text>)}
          </Box>
          <Box flexDirection="column" flexGrow={1} minWidth={0} marginLeft={2}>
            <Text color={tc(CYAN)} bold>TOP TOOLS</Text>
            {list.length === 0 && <Text dimColor>no tool calls yet</Text>}
            {list.slice(0, 5).map(x => (
              <Text wrap="truncate-end">{x.tool.padEnd(14).slice(0, 14)} <Text color={tc('#5fd75f')}>✓{x.ok}</Text> <Text color={tc(x.denied ? '#ff5f5f' : '#6c6c6c')}>✗{x.denied}</Text></Text>
            ))}
          </Box>
        </Box>
        <Text color={tc(CYAN)} bold>RECENT ASKS & DENIALS</Text>
        {recent.length === 0 && <Text dimColor>nothing asked or denied yet</Text>}
        {recent.map(x => (
          <Text wrap="truncate-end"><Text color={tc('#6c6c6c')}>[{hhmmss(x.at)}]</Text> <Text color={tc(GATE_COLOR[x.kind])}>{VIA[x.kind]}</Text> {x.tool} <Text dimColor>{x.detail}</Text>{x.waitMs !== undefined ? <Text dimColor> · {(x.waitMs / 1000).toFixed(1)}s</Text> : ''}{x.reason && x.kind === 'd' ? <Text color={tc('#ff875f')}> — {x.reason}</Text> : ''}</Text>
        ))}
        {back}
      </Box>)
    } else if (m === 'mcp') {
      // every server: status, tools loaded / total, calls, errors, latency, last use, schema tokens and what of them is in context now
      body = box('MCP', 1, <Box flexDirection="column">
        <Text wrap="truncate-end">{mcpSummary}{allTok ? <Text dimColor> · {kTok1(inCtxTok)} in context now, {kTok1(allTok - inCtxTok)} deferred</Text> : ''}</Text>
        {servers.length === 0 && <Text dimColor>no MCP servers connected</Text>}
        {sortedMcp.slice(0, Math.max(2, room - 3)).map(x => {
          const [g, c] = MCP_GLYPH[x.status]
          const t = cx.mcp[x.name]
          return (
            <Box key={`mcpd-${x.name}`} justifyContent="space-between">
              <Text wrap="truncate-end"><Text color={tc(c)}>{g}</Text> <Text bold>{x.name}</Text> <Text dimColor>{x.status === 'connected' ? `${t ? `${t.loaded}/` : ''}${x.tools} tools loaded` : x.status}</Text>{x.error ? <Text color={tc('#ff875f')}> — {x.error}</Text> : ''}</Text>
              <Box flexShrink={0} marginLeft={1}><Text dimColor>{x.calls} calls · {x.errors} err{x.calls ? ` · avg ${(x.totalMs / x.calls / 1000).toFixed(1)}s` : ''}{x.lastAt ? ` · ${span(now - x.lastAt)} ago` : ''}</Text><Text bold>{(t ? kTok1(t.tokens) : '—').padStart(7)}</Text></Box>
            </Box>
          )
        })}
        {servers.length > Math.max(2, room - 3) && <Text dimColor>… +{servers.length - Math.max(2, room - 3)} servers</Text>}
        {back}
      </Box>)
    } else if (m === 'context') {
      // every category, then memory files and the heaviest skills
      const rowsN = cx.rows.length
      const left = Math.max(2, room - rowsN - 8)
      const memN = Math.min(cx.memory.length, Math.max(1, Math.floor(left / 2)))
      const skillN = Math.min(cx.skills.length, Math.max(1, left - memN))
      const home = (p: string) => p.replace(/\\/g, '/').replace(/^.*\/(\.claude\/.*)$/, '~/$1')
      body = box('CONTEXT', 1, <Box flexDirection="column">
        {rowsN === 0 && <Text dimColor>no breakdown yet</Text>}
        {rowsN > 0 && <Box justifyContent="space-between">
          <Text bold wrap="truncate-end">{ctxPct}% used <Text dimColor>· {cx.model ? modelName(cx.model) : ''}{cx.compactAt ? ` · autocompact at ${kTok1(cx.compactAt)}` : ' · autocompact off'}</Text></Text>
          <Box flexShrink={0} marginLeft={1}><Text dimColor>{kTok1(cx.used)} / {kTok(cx.max)}</Text></Box>
        </Box>}
        {rowsN > 0 && stack(Math.max(8, W - 4))}
        {cx.rows.map((r, i) => ctxRow(r, i))}
        {cx.memory.length > 0 && <Text bold>MEMORY FILES <Text dimColor>{cx.memory.length} · {kTok1(cx.memory.reduce((n, f) => n + f.tokens, 0))}</Text></Text>}
        {cx.memory.slice(0, memN).map((f, i) => (
          <Box key={`mem-${i}`} justifyContent="space-between">
            <Text wrap="truncate-start"><Text dimColor>{f.type.padEnd(8)}</Text>{home(f.path)}</Text>
            <Box flexShrink={0} marginLeft={1}><Text>{kTok1(f.tokens).padStart(6)}</Text></Box>
          </Box>
        ))}
        {cx.skills.length > 0 && <Text bold>SKILLS <Text dimColor>{cx.skillsTotal} · heaviest first</Text></Text>}
        {cx.skills.slice(0, skillN).map((k, i) => (
          <Box key={`sk-${i}`} justifyContent="space-between">
            <Text wrap="truncate-end">{k.name}</Text>
            <Box flexShrink={0} marginLeft={1}><Text>{kTok1(k.tokens).padStart(6)}</Text></Box>
          </Box>
        ))}
        {back}
      </Box>)
    } else if (m === 'theme') {
      const cfg = await read($, themeCfg)
      const target = themeTarget(cfg)
      const inForce = cfg.force ? 'global' : cfg.repo ? 'repo' : 'global'
      // the theme being edited: what is on screen, or the stored one for the other scope
      const et = target === inForce ? th : cfg[target] ?? (target === 'global' ? DEFAULT_THEME : th)
      const repoName = cfg.root.split(/[\\/]/).filter(Boolean).pop() ?? 'repo'
      const radio = (sel: boolean, label: string) => <Text><Text color={sel ? pal.ok : pal.dim}>{sel ? '●' : '○'}</Text> <Text bold={sel} dimColor={cfg.force}>{label}</Text></Text>
      const swatch = (p: Palette) => <Text>{(['border', 'ok', 'warn', 'bad', 'info', 'accent', 'purple', 'dim'] as PaletteKey[]).map(k => <Text color={p[k]}>■</Text>)}</Text>
      const presetRow = (name: string, p: Palette) => (
        <Button key={`th-${name}`} plain onPress={() => setTheme($, t => ({ ...t, name, base: name === 'custom' ? t.base : name }))}>
          <Text color={et.name === name ? pal.ok : pal.dim}>{et.name === name ? '●' : '○'} </Text>
          <Text bold={et.name === name}>{name.padEnd(11)}</Text>
          {swatch(p)}
        </Button>
      )
      const setRole = (role: PaletteKey, value: string) => {
        const m = HEX.exec(value.trim())
        if (!m) return $.ui.toast(`Not a color: "${value.slice(0, 20)}" — use #rrggbb`)
        return setTheme($, t => ({ ...t, name: 'custom', custom: { ...t.custom, [role]: `#${m[1]!.toLowerCase()}` } }))
      }
      body = box('THEME', 1, <Box flexDirection="column">
        <Text>in use: <Text bold>{th.name}</Text> <Text dimColor>({cfg.force ? 'global, forced' : inForce})</Text></Text>
        <Box flexDirection="row" gap={2}>
          <Text bold color={pal.border}>SCOPE</Text>
          <Button key="th-scope-repo" plain onPress={() => !cfg.force && setThemeCfg($, c => ({ ...c, scope: 'repo' }))}>{radio(target === 'repo', `This repo (${repoName})`)}</Button>
          <Button key="th-scope-global" plain onPress={() => !cfg.force && setThemeCfg($, c => ({ ...c, scope: 'global' }))}>{radio(target === 'global', 'Global')}</Button>
          <Button key="th-force" plain onPress={async () => {
            const c = await setThemeCfg($, c => ({ ...c, force: !c.force }))
            await $.store.set('prodash.theme.force', c.force).catch(() => undefined)
          }}><Text><Text color={cfg.force ? pal.ok : pal.dim}>{cfg.force ? '[x]' : '[ ]'}</Text> Force global theme</Text></Button>
        </Box>
        <Text bold color={pal.border}>PRESETS</Text>
        {Object.entries(THEMES).map(([name, p]) => presetRow(name, p))}
        {presetRow('custom', resolveTheme({ ...et, name: 'custom' }))}
        <Box marginTop={1} justifyContent="space-between">
          <Text bold color={pal.border}>CUSTOM <Text dimColor bold={false}>(starts from {et.base}; pick a color or type #rrggbb + Enter)</Text></Text>
        </Box>
        {EDITABLE.map(role => {
          const cur = resolveTheme({ ...et, name: 'custom' })[role]
          return (
            <Box key={`role-${role}`} flexDirection="row" gap={1}>
              <Text>{role.padEnd(7)} <Text color={cur}>■■</Text> <Text dimColor>{cur}</Text>{et.custom[role] ? <Text color={pal.accent}> *</Text> : '  '}</Text>
              <Select key={`sel-${role}`} options={SWATCHES.map(([label, value]) => ({ label: `${label} ${value}`, value }))} value={SWATCHES.find(x => x[1] === cur)?.[1]} onSelect={v => setRole(role, v)} />
              <Input key={`in-${role}`} placeholder="#rrggbb" onSubmit={v => setRole(role, v)} />
            </Box>
          )
        })}
        <Box gap={2}>
          <Button key="th-reset" label="RESET CUSTOM" onPress={() => setTheme($, t => ({ ...t, custom: {} }))} />
          {cfg.repo && <Button key="th-use-global" label="USE GLOBAL IN THIS REPO" onPress={async () => {
            const c = await setThemeCfg($, c => ({ ...c, repo: undefined, scope: 'global' }))
            await $.store.set(repoThemeKey(c.root), null).catch(() => undefined)
          }} />}
          {back}
        </Box>
      </Box>)
    } else if (m === 'board') {
      const [list, files, reqs, pl, bgs, cr, cwd] = await Promise.all([
        read($, todos), read($, touched), read($, requests), read($, plan), read($, bg), read($, crons), sessionCwd,
      ])
      const isWide = W >= 110
      const cap = Math.max(2, Math.floor((room - 8) / (isWide ? 3 : 5)))
      const title = (t: string, extra?: string) => <Text color={tc(CYAN)} bold wrap="truncate-end">{t}{extra ? <Text dimColor bold={false}>  {extra}</Text> : ''}</Text>
      const rel = (p: string) => (p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[\\/]/, '') : p)

      const tw = list.map(t => ({ status: t.status, words: new Set(words(t.content)) })) // once per draw
      const states = (pl?.steps ?? []).map(st => stepState(st, tw))
      const done = states.filter(x => x === 'done').length
      const taskCount = (st: string) => list.filter(t => t.status === st).length
      const planSec = <Box flexDirection="column">
        {title('PLAN', pl ? `${done}/${pl.steps.length}  ${'▰'.repeat(Math.round((done / Math.max(1, pl.steps.length)) * 10))}${'▱'.repeat(10 - Math.round((done / Math.max(1, pl.steps.length)) * 10))}` : undefined)}
        {!pl && <Text dimColor>no approved plan yet</Text>}
        {pl && pl.steps.slice(0, cap).map((st, k) => (
          <Text wrap="truncate-end"><Text color={tc(states[k] === 'done' ? '#5fd75f' : states[k] === 'doing' ? '#5fafff' : '#6c6c6c')}>{states[k] === 'done' ? '✓' : states[k] === 'doing' ? '◐' : '○'}</Text> <Text dimColor={states[k] === 'done'}>{st.text}</Text></Text>
        ))}
        {pl && pl.steps.length > cap && <Text dimColor>… +{pl.steps.length - cap} steps</Text>}
        {list.length > 0 && <Text wrap="truncate-end" dimColor>tasks: <Text color={tc('#ffd75f')}>{taskCount('pending')} todo</Text> · <Text color={tc('#5fafff')}>{taskCount('in_progress')} doing</Text> · <Text color={tc('#5fd75f')}>{taskCount('completed')} done</Text>{list.find(t => t.status === 'in_progress') ? `  ▸ ${list.find(t => t.status === 'in_progress')?.content}` : ''}</Text>}
      </Box>

      const fadd = files.reduce((n, f) => n + f.add, 0), fdel = files.reduce((n, f) => n + f.del, 0)
      const filesSec = <Box flexDirection="column">
        {title('FILES TOUCHED', files.length ? `${files.length} files  +${fadd} −${fdel}` : undefined)}
        {files.length === 0 && <Text dimColor>no edits this session</Text>}
        {[...files].sort((a, b) => b.at - a.at).slice(0, cap).map(f => (
          <Text wrap="truncate-start"><Text color={tc('#5fd75f')}>+{f.add}</Text> <Text color={tc('#ff5f5f')}>−{f.del}</Text>{f.isNew ? <Text color={tc('#ffd75f')}> new</Text> : ''} {rel(f.path)}</Text>
        ))}
      </Box>

      const timeSec = <Box flexDirection="column">
        {title('TIMELINE', reqs.length ? `${reqs.length} requests` : undefined)}
        {reqs.length === 0 && <Text dimColor>no requests yet</Text>}
        {reqs.slice(-cap).reverse().map(q => (
          <Text wrap="truncate-end"><Text color={tc('#6c6c6c')}>{q.at ? hhmmss(q.at).slice(0, 5) : '--:--'}</Text> <Text color={tc(q.isDone ? '#5fd75f' : '#ffd75f')}>{q.isDone ? '✓' : '◐'}</Text> <Text dimColor>{String(q.tools).padStart(3)} tools{q.durationMs !== undefined ? ` ${span(q.durationMs)}` : ''}</Text>  {q.text}</Text>
        ))}
      </Box>

      const bgSec = <Box flexDirection="column">
        {title('BACKGROUND', bgs.length ? `${bgs.length} running` : undefined)}
        {bgs.length === 0 && <Text dimColor>no shells or monitors in flight</Text>}
        {bgs.slice(0, cap).map(b => (
          <Text wrap="truncate-end"><Text color={tc('#5fd75f')}>●</Text> <Text color={tc('#5fafff')}>{b.kind.padEnd(8)}</Text>{b.desc} <Text dimColor>{span(now - b.since)}</Text></Text>
        ))}
      </Box>

      const cronSec = <Box flexDirection="column">
        {title('SCHEDULED', cr.length ? `${cr.length} jobs` : undefined)}
        {cr.length === 0 && <Text dimColor>nothing scheduled</Text>}
        {cr.slice(0, cap).map(c => (
          <Text wrap="truncate-end"><Text color={tc('#ffd75f')}>⏰</Text> {c.schedule}{c.recurring ? '' : ' (once)'}  <Text dimColor>{c.prompt.replace(/\s+/g, ' ')}</Text>{c.nextFireAt ? <Text dimColor> · next {hhmmss(c.nextFireAt).slice(0, 5)}</Text> : ''}</Text>
        ))}
      </Box>

      body = box('BOARD', 1, <Box flexDirection="column">
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
      const gitBox = box(g.isRepo ? `${g.host ?? 'GIT'} · ${g.repo ?? 'no remote'}` : 'GIT', 0, g.isRepo ? <Box flexDirection="column">
        <Text wrap="truncate-end">⎇ <Text color={tc('#5fafff')} bold>{g.branch ?? '?'}</Text>{g.upstream ? ` → ${g.upstream}` : ' (no upstream)'} <Text color={tc('#5fd75f')}>↑{g.ahead}</Text> <Text color={tc('#ff875f')}>↓{g.behind}</Text>{g.stash ? `  stash ${g.stash}` : ''}</Text>
        {g.pr && <Text wrap="truncate-end">{g.host === 'GITLAB' ? 'MR' : 'PR'} <Text color={tc('#af87ff')}>{g.pr}</Text></Text>}
        <Text wrap="truncate-end" dimColor>{g.last ?? 'no commits'}</Text>
        <Text wrap="truncate-end">PENDING: <Text color={tc('#5fd75f')}>{nStaged} staged</Text> · <Text color={tc('#ffd75f')}>{nMod} modified</Text> · <Text color={tc('#ff875f')}>{nNew} new</Text>{g.files.length === 0 ? ' — clean' : ''}</Text>
        {g.files.slice(0, fileRows).map((f: GitFile) => <Text wrap="truncate-start"><Text color={tc(fileColor(f.xy))}>{f.xy.replace(/\./g, ' ')}</Text> {f.path}</Text>)}
        {g.files.length > fileRows && <Text dimColor>… +{g.files.length - fileRows} file(s)</Text>}
      </Box> : <Text dimColor>Current folder is not a git repository.</Text>)
      const gitRows = g.isRepo ? 4 + Math.min(fileRows + 1, g.files.length) + (g.pr ? 1 : 0) : 1
      const forkRoom = Math.max(2, room - gitRows - 3)
      const forksBox = box('ACTIVE FORKS', 1, <Box flexDirection="column">{forkRows(forkRoom, false)}</Box>)
      body = <Box flexDirection="column">{gitBox}{forksBox}</Box>
    }

    return (
      <Box flexDirection="column" width={W}>
        {header}
        {actions}
        {hasRow && <Box flexDirection="row">
          {mcpBox}
          {ctxBox}
        </Box>}
        {body}
      </Box>
    )
  })
}
