import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Fork, Git, GitFile, Level, Live, LogLine, Mode, Perm, Sys, Todo, Usage } from '../types'

const PANE = 'prodash'
const MAX_LOGS = 500 // fixed ring: a long session never grows the buffer
const HIST = 24

const logs = atom({ plugin: 'prodash', key: 'logs' } as const, [] as LogLine[], { shape: 'logs-1' })
const forks = atom({ plugin: 'prodash', key: 'forks' } as const, [] as Fork[], { shape: 'forks-2' })
const sys = atom({ plugin: 'prodash', key: 'sys' } as const, { hist: [] } as Sys, { shape: 'sys-1' })
const usage = atom({ plugin: 'prodash', key: 'usage' } as const, { startedAt: 0, tokens: 0, ctxHist: [] } as Usage, { shape: 'usage-1' })
const mode = atom({ plugin: 'prodash', key: 'mode' } as const, 'main' as Mode)
const perms = atom({ plugin: 'prodash', key: 'perms' } as const, [] as Perm[], { shape: 'perms-1' })
const git = atom({ plugin: 'prodash', key: 'git' } as const, { isRepo: false, ahead: 0, behind: 0, stash: 0, files: [] } as Git, { shape: 'git-1' })
const liveInfo = atom({ plugin: 'prodash', key: 'live' } as const, { reqs: 0, isBusy: false, compactions: 0 } as Live, { shape: 'live-1' })
const todos = atom({ plugin: 'prodash', key: 'todos' } as const, [] as Todo[], { shape: 'todos-1' })

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

// What a tool call is about, in a few words for the console.
const detail = (e: Record<string, unknown>) => {
  const v = e.command ?? e.file_path ?? e.pattern ?? e.path ?? e.url ?? e.description ?? e.query ?? ''
  return String(v).replace(/\s+/g, ' ').slice(0, 80)
}

function log($: EngineInterface, level: Level, text: string, isSub = false) {
  return update($, logs, list => [...list, { at: Date.now(), level, text, isSub }].slice(-MAX_LOGS))
}

export const register: Register = on => {
  // Module vars rebuild on reload; they only label log lines.
  const names = new Map<string, string>()
  let modes: string[] = []


  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prodash', description: 'Open the Dashboard Pro pane' })
    await update($, usage, u => ({ ...u, startedAt: Date.now() }))

    // Agents + session usage: cheap engine reads, polled fast (<200ms latency target).
    $.clock.every(150, async () => {
      const list = await $.agent.list()
      const now = Date.now()
      const prev = await read($, forks)
      const fresh: Fork[] = list.map(a => {
        names.set(a.id, a.description || a.name || a.type)
        const old = prev.find(f => f.id === a.id)
        if (old && old.status !== a.status && (a.status === 'failed' || a.status === 'killed'))
          void log($, a.status === 'failed' ? 'ERROR' : 'WARN', `${names.get(a.id)}: ${a.status}`, true)
        if (old && old.status !== a.status && a.status === 'completed')
          void log($, 'SUCCESS', `${names.get(a.id)}: completed`, true)
        return { id: a.id, name: names.get(a.id) ?? a.id, status: a.status, since: old?.since ?? now, tools: old?.tools ?? 0, lastIn: old?.lastIn ?? 0, out: old?.out ?? 0 }
      })
      if (JSON.stringify(fresh.map(f => [f.id, f.status])) !== JSON.stringify(prev.map(f => [f.id, f.status])))
        await update($, forks, () => fresh)
    })

    $.clock.every(1000, async () => {
      const u = await $.session.usage()
      const ctx = u.context.percent
      await update($, usage, old => ({
        ...old,
        startedAt: u.startedAt || old.startedAt,
        ctx,
        ctxTokens: u.context.tokens,
        ctxWindow: u.context.window,
        limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
        usd: u.cost?.usd,
        ctxHist: push(old.ctxHist, ctx ?? 0),
      }))
      const live = (await read($, forks)).filter(f => LIVE.includes(f.status))
      const running = live.filter(f => f.status === 'running').length
      $.ui.status(`prodash: ctx ${ctx ?? 0}% · agents ${running}/${live.length}`)
    })

    // System load: Windows via CIM. shortcut: Windows only, add /proc or vm_stat for other OSes.
    const sample = async () => {
      const r = await $.process.run(
        ['powershell', '-NoProfile', '-Command',
          '$c=(Get-CimInstance Win32_Processor|Measure-Object LoadPercentage -Average).Average;$o=Get-CimInstance Win32_OperatingSystem;"$c $($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)"'],
        { timeoutMs: 8000 },
      ).catch(() => undefined)
      const [c, total, free] = (r?.stdout.trim().split(/\s+/) ?? []).map(Number)
      if (c === undefined || Number.isNaN(c)) return
      await update($, sys, s => ({
        load: c,
        memTotal: (total ?? 0) / 1048576,
        memUsed: ((total ?? 0) - (free ?? 0)) / 1048576,
        hist: push(s.hist, c),
      }))
    }
    void sample()
    $.clock.every(5000, () => void sample())

    // Git: local reads every 5s; the PR (network, needs gh) every 60s.
    const cwd = await $.session.cwd()
    const run = (argv: string[]) =>
      $.process.run(argv, { cwd, timeoutMs: 8000 }).then(r => (r.exitCode === 0 ? r.stdout.trim() : undefined), () => undefined)
    let pr: string | undefined
    const gitSample = async () => {
      const [st, last, remote] = await Promise.all([
        run(['git', 'status', '--porcelain=v2', '--branch', '--show-stash']),
        run(['git', 'log', '-1', '--format=%h %s (%cr)']),
        run(['git', 'remote', 'get-url', 'origin']),
      ])
      const g: Git = st === undefined ? { isRepo: false, ahead: 0, behind: 0, stash: 0, files: [] } : parseStatus(st)
      g.last = last || undefined
      g.repo = remote?.replace(/\.git$/, '').replace(/^.*[:/]([^/:]+\/[^/]+)$/, '$1')
      g.pr = pr
      const old = await read($, git)
      if (JSON.stringify(old) !== JSON.stringify(g)) await update($, git, () => g)
    }
    const prSample = async () => {
      const out = await run(['gh', 'pr', 'view', '--json', 'number,state,title', '--template', '#{{.number}} {{.state}} {{.title}}'])
      pr = out || undefined
    }
    const model = await $.session.model().catch(() => undefined)
    if (model) await update($, liveInfo, l => ({ ...l, model: l.model ?? model }))
    void prSample().then(gitSample)
    $.clock.every(5000, () => void gitSample())
    $.clock.every(60000, () => void prSample())

    void $.ui.open({ id: PANE, title: 'Claude Dashboard Pro', columns: 999, rows: 40 })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await update($, liveInfo, l => ({ ...l, isBusy: true }))
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  // Each model request: count it, note model/effort, time its first chunk (TTFT).
  on('turn.step', async function* ($, e, next) {
    const t0 = Date.now()
    await update($, liveInfo, l => ({
      ...l,
      reqs: l.reqs + 1,
      ...(e.agentId ? {} : { model: e.model, effort: e.effort === undefined ? l.effort : String(e.effort) }),
    }))
    const it = next(e)
    let first = true
    let step = await it.next()
    while (!step.done) {
      if (first && !e.agentId) {
        first = false
        const ttftMs = Date.now() - t0
        void update($, liveInfo, l => ({ ...l, ttftMs }))
      }
      const c = step.value as { kind?: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null }
      if (e.agentId && c.kind === 'stop' && c.usage) {
        const u = c.usage
        const id = e.agentId
        void update($, forks, list => list.map(f => (f.id === id
          ? { ...f, lastIn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, out: f.out + u.output_tokens }
          : f)))
      }
      yield step.value
      step = await it.next()
    }
    return step.value
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    await update($, liveInfo, l => ({ ...l, compactions: l.compactions + 1 }))
    return r
  })

  on('command.run', { command: 'prodash' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude Dashboard Pro', focus: true, columns: 999, rows: 40 })
    return { text: 'Dashboard Pro aberto. Teclas 1–4 acionam a action bar.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.text.trim()) await log($, 'USER', `you: ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    return next(e)
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await log($, 'INFO', `${String((e as { description?: string }).description ?? 'agent')}: spawned → fork`)
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('tool.call', async ($, e, next) => {
    const raw = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const who = e.agentId ? names.get(e.agentId) ?? 'fork' : 'main'
    if (tool === 'TodoWrite' && Array.isArray(raw.todos))
      await update($, todos, () => (raw.todos as Todo[]).map(t => ({ content: t.content, status: t.status })))
    if (e.agentId) await update($, forks, list => list.map(f => (f.id === e.agentId ? { ...f, tools: f.tools + 1 } : f)))

    const r = await next(e)
    const denied = 'deny' in r && r.deny !== undefined
    const isError = !denied && (r as { isError?: boolean }).isError === true
    await log($, denied ? 'WARN' : isError ? 'ERROR' : 'SUCCESS',
      `${who}: ${tool} → ${denied ? `denied (${r.deny})` : detail(raw)}`, !!e.agentId)
    await update($, perms, list => {
      const one = list.find(p => p.tool === tool) ?? { tool, ok: 0, denied: 0 }
      const upd = { ...one, ok: one.ok + (denied ? 0 : 1), denied: one.denied + (denied ? 1 : 0) }
      return [...list.filter(p => p.tool !== tool), upd].sort((a, b) => b.ok + b.denied - a.ok - a.denied)
    })
    return r
  }).catch(($, e, next) => next(e)) // observer: fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await update($, liveInfo, l => ({ ...l, isBusy: false }))
    const u = r.usage
    const cost = (await $.session.usage()).cost?.usd
    await update($, usage, old => ({
      ...old,
      tokens: old.tokens + (u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0),
      lastTurnUsd: cost !== undefined && old.usd !== undefined ? Math.max(0, cost - (old.turnBaseUsd ?? 0)) : old.lastTurnUsd,
      turnBaseUsd: cost,
      usd: cost,
    }))
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
    const [s, u, fl, m, lv, gh] = await Promise.all([read($, sys), read($, usage), read($, forks), read($, mode), read($, liveInfo), read($, git)])
    const live = fl.filter(f => LIVE.includes(f.status))
    const count = (st: string) => live.filter(f => f.status === st).length
    const running = count('running'), waiting = count('waiting') + count('pending'), idle = count('idle')
    const now = Date.now()
    const box = (title: string, grow: number, body: RenderChildren) => (
      <Box flexDirection="column" borderStyle="round" borderColor={CYAN} paddingX={1} flexGrow={grow} minWidth={0}>
        <Text color={CYAN} bold wrap="truncate-end">{title}</Text>
        {body}
      </Box>
    )
    const load = s.load ?? 0
    const status = s.load === undefined ? 'SYNCING' : load >= 90 ? 'DEGRADED' : 'ONLINE'
    const histo = live.map(f => (f.status === 'running' ? '■' : '□')).join('') || '·'

    const inner = Math.max(8, Math.floor(W / 4) - 4) // side boxes take 1/4 each; border + padding take 4
    const wide = Math.max(16, Math.floor(W / 2) - 4)
    const header = (
      <Box flexDirection="row">
        {box('SYSTEM STATUS', 1, <Box flexDirection="column">
          <Text wrap="truncate-end"><Text color={status === 'ONLINE' ? '#5fd75f' : status === 'DEGRADED' ? '#ff5f5f' : '#ffd75f'}>● {status}</Text></Text>
          <Text wrap="truncate-end">CPU <Text color={loadColor(load)}>{bar(load, Math.max(3, inner - 9))}</Text> {s.load === undefined ? 'n/a' : `${load}%`}</Text>
          <Text wrap="truncate-end">RAM {s.memTotal ? `${(s.memUsed ?? 0).toFixed(1)}/${s.memTotal.toFixed(0)}G` : 'n/a'}</Text>
          <Text wrap="truncate-end"><Text color="#5fd75f">{spark(s.hist, inner)}</Text></Text>
        </Box>)}
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
        </Box>)}
        {box('SESSION METRICS', 1, <Box flexDirection="column">
          <Text wrap="truncate-end">TIME {clock(now - (u.startedAt || now))}</Text>
          <Text wrap="truncate-end">TOKENS {tokens(u.tokens)}</Text>
          <Text wrap="truncate-end">COST ${(u.usd ?? 0).toFixed(2)}</Text>
          <Text wrap="truncate-end">TURN ${(u.lastTurnUsd ?? 0).toFixed(2)}</Text>
        </Box>)}
      </Box>
    )

    const save = async () => {
      const list = await read($, logs)
      const path = `${await $.session.cwd()}/prodash-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
      await $.fs.write(path, list.map(l => `[${hhmmss(l.at)}] [${l.level}] ${l.text}`).join('\n') + '\n')
      $.ui.toast(`Log salvo: ${path}`)
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

    const room = Math.max(3, H - 14)
    const back = <Button key="back" label="VOLTAR" onPress={() => update($, mode, () => 'main' as Mode)} />
    let body: RenderChildren

    if (m === 'agents') {
      body = box('AGENT SELECT — abre o transcript do agente', 1, <Box flexDirection="column">
        {fl.length === 0 && <Text dimColor>Nenhum sub-agente nesta sessão.</Text>}
        {fl.slice(-room).map(f => (
          <Button key={`ag-${f.id}`} plain onPress={() => $.ui.view({ agentId: f.id })}>
            {f.name.slice(0, 40)} <Text color={STATUS_COLOR[f.status] ?? '#8a8a8a'}>({f.status.toUpperCase()})</Text> <Text dimColor>{f.tools} tools</Text>
          </Button>
        ))}
        <Button key="main-view" plain onPress={() => $.ui.view({})}>← conversa principal</Button>
        {back}
      </Box>)
    } else if (m === 'perms') {
      const list = await read($, perms)
      body = box('GATE PERMS — chamadas por ferramenta', 1, <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>Nenhuma chamada de ferramenta ainda.</Text>}
        {list.slice(0, room).map(p => (
          <Text wrap="truncate-end">{p.tool.padEnd(24).slice(0, 24)} <Text color="#5fd75f">✓ {p.ok}</Text>  <Text color={p.denied ? '#ff5f5f' : '#8a8a8a'}>✗ {p.denied}</Text></Text>
        ))}
        {back}
      </Box>)
    } else if (m === 'board') {
      const list = await read($, todos)
      const col = (title: string, items: string[], color: string) => (
        <Box flexDirection="column" flexGrow={1} minWidth={0} paddingX={1}>
          <Text bold color={color}>{title} ({items.length})</Text>
          {items.slice(0, room).map(t => <Text wrap="truncate-end">• {t}</Text>)}
        </Box>
      )
      const by = (st: string[]) =>
        list.length ? list.filter(t => st.includes(t.status)).map(t => t.content) : fl.filter(f => st.includes(f.status)).map(f => f.name)
      body = box(list.length ? 'PROJECT BOARD — TodoWrite' : 'PROJECT BOARD — sub-agentes', 1, <Box flexDirection="column">
        <Box flexDirection="row">
          {col('TODO', by(['pending', 'waiting', 'idle']), '#ffd75f')}
          {col('DOING', by(['in_progress', 'running']), '#5fafff')}
          {col('DONE', by(['completed']), '#5fd75f')}
        </Box>
        {back}
      </Box>)
    } else {
      const g = await read($, git)
      const fileRows = Math.max(2, Math.min(8, Math.floor((room - 6) / 2)))
      const nStaged = g.files.filter(f => f.xy !== '??' && f.xy !== 'UU' && f.xy[0] !== '.').length
      const nMod = g.files.filter(f => f.xy !== '??' && f.xy !== 'UU' && f.xy[1] !== '.').length
      const nNew = g.files.filter(f => f.xy === '??').length
      const gitBox = box(g.isRepo ? `GITHUB · ${g.repo ?? 'sem remote'}` : 'GITHUB', 0, g.isRepo ? <Box flexDirection="column">
        <Text wrap="truncate-end">⎇ <Text color="#5fafff" bold>{g.branch ?? '?'}</Text>{g.upstream ? ` → ${g.upstream}` : ' (sem upstream)'} <Text color="#5fd75f">↑{g.ahead}</Text> <Text color="#ff875f">↓{g.behind}</Text>{g.stash ? `  stash ${g.stash}` : ''}</Text>
        {g.pr && <Text wrap="truncate-end">PR <Text color="#af87ff">{g.pr}</Text></Text>}
        <Text wrap="truncate-end" dimColor>{g.last ?? 'sem commits'}</Text>
        <Text wrap="truncate-end">PENDENTE: <Text color="#5fd75f">{nStaged} staged</Text> · <Text color="#ffd75f">{nMod} modif.</Text> · <Text color="#ff875f">{nNew} novos</Text>{g.files.length === 0 ? ' — limpo' : ''}</Text>
        {g.files.slice(0, fileRows).map((f: GitFile) => <Text wrap="truncate-start"><Text color={fileColor(f.xy)}>{f.xy.replace(/\./g, ' ')}</Text> {f.path}</Text>)}
        {g.files.length > fileRows && <Text dimColor>… +{g.files.length - fileRows} arquivo(s)</Text>}
      </Box> : <Text dimColor>Pasta atual não é um repositório git.</Text>)
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
        {actions}
        {body}
      </Box>
    )
  })
}
