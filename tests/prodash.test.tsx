import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const pane = (bodyColumns: number) => ({
  plugin: 'prodash',
  component: 'Pane',
  requestId: 'prodash',
  props: {
    title: 'Pro Dash',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const)

const SURFACES = ['terminal', 'desktop'] as const
const HEADERS = ['SYSTEM STATUS', 'AGENT OVERVIEW', 'CONTEXT', 'ACTIVE FORKS']

// The engine beneath the plugin; the mocked clock holds session.start's timers.
function engine(on: On, tools: Record<string, unknown> = {}, usage: unknown = { startedAt: 0, context: { percent: 10 }, rateLimits: [] }) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  // $.tool.list() stand-in: tests push/replace entries to change what the session offers
  const list: { name: string; description: string; mcp: boolean }[] = []
  on('tool.list', () => ({ value: list.map(t => ({ ...t })) }) as never)
  on('command.register', () => ({ value: { command: 'prodash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => ({ result: (tools[e.tool] ?? {}) as never }))
  on('session.cwd', () => ({ value: '/p' }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.usage', () => ({ value: usage as never }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } as never }))
  // $.store stand-in: tests seed or read `store` directly
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => { store.set(e.key, e.value); return { value: undefined } as never })
  return { clock, list, store }
}

test('resize: narrow and wide both draw every header', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    for (const cols of [80, 160]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      for (const h of HEADERS) expect(await ui.find({ type: 'Text', text: h }), `${surface} ${cols} ${h}`).toBeDefined()
      await ui.unmount()
    }
  }
})

test('CPU 100% shows DEGRADED', async ($, on) => {
  engine(on)
  on('state.get', (_, e, next) =>
    e.key === 'sys'
      ? { value: { value: { shape: 'sys-1', value: { load: 100, hist: [100] } }, version: 1 } }
      : next(e))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(160), surface })
    expect(await ui.find({ type: 'Text', text: /DEGRADED/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the log buffer keeps the prompt then the tool call, in order', async ($, on) => {
  engine(on)
  let last: { level: string; text: string }[] = []
  on('state.set', (_, e, next) => {
    if (e.plugin === 'prodash' && e.key === 'logs') last = (e.value as { value: typeof last }).value
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'oi' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await ($ as any).turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(last.map(l => `[${l.level}] ${l.text}`)).toEqual(['[USER] you: oi', '[SUCCESS] main: Bash → ls'])
})

test('600 tool calls keep logs at 500', { timeoutMs: 20_000 }, async ($, on) => {
  engine(on)
  // Watch every write of logs as it reaches the store beneath the plugin.
  let longest = 0
  on('state.set', (_, e, next) => {
    if (e.plugin === 'prodash' && e.key === 'logs')
      longest = Math.max(longest, ((e.value as { value?: unknown[] })?.value ?? []).length)
    return next(e)
  })
  for (let i = 0; i < 600; i++) await $.tool.call({ tool: 'Bash', command: `ls ${i}` })
  await ($ as any).turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(longest).toBe(500)
})

test('action bar: a3 opens the board, back returns to the forks', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(160), surface })
    for (const k of ['a1', 'a2', 'a3', 'a4']) expect(await ui.find({ type: 'Button', key: k }), k).toBeDefined()
    await ui.press({ key: 'a3' })
    expect(await ui.find({ type: 'Text', text: 'BOARD' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeUndefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeDefined()
    await ui.unmount()
  }
})

import { parseStatus } from '../hooks/register'

test('git porcelain v2 is parsed', () => {
  const g = parseStatus([
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '# stash 3',
    '1 M. N... 100644 100644 100644 a b src/a b.ts',
    '1 .M N... 100644 100644 100644 a b src/c.ts',
    '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
    '? notes.md',
  ].join('\n'))
  expect([g.branch, g.upstream, g.ahead, g.behind, g.stash]).toEqual(['main', 'origin/main', 2, 1, 3])
  expect(g.files).toEqual([
    { xy: 'M.', path: 'src/a b.ts' }, { xy: '.M', path: 'src/c.ts' }, { xy: 'R.', path: 'new.ts' }, { xy: '??', path: 'notes.md' },
  ])
})

test('GITHUB section sits above ACTIVE FORKS and lists pending files', async ($, on) => {
  engine(on)
  on('state.get', (_, e, next) =>
    e.key === 'git'
      ? { value: { value: { shape: 'git-1', value: { isRepo: true, repo: 'me/repo', branch: 'main', ahead: 1, behind: 0, stash: 0, files: [{ xy: '.M', path: 'src/c.ts' }] } }, version: 1 } }
      : next(e))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(80), surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const gh = texts.findIndex(t => t.includes('GITHUB · me/repo'))
    expect(gh, texts.join('\n')).toBeGreaterThanOrEqual(0)
    expect(texts.findIndex(t => t === 'ACTIVE FORKS')).toBeGreaterThan(gh)
    expect(texts.some(t => t.includes('src/c.ts'))).toBe(true)
    await ui.unmount()
  }
})

test('ACTIVE FORKS lists main and each fork; a press opens its transcript', async ($, on) => {
  engine(on)
  const viewed: unknown[] = []
  on('ui.view', (_, e) => { viewed.push(e); return { value: {} } })
  on('state.get', (_, e, next) =>
    e.key === 'forks'
      ? { value: { value: { shape: 'forks-2', value: [{ id: 'a1', name: 'Measuring impressions v9 and v10', status: 'running', since: 1_700_000_000_000 - 3_373_000, tools: 3, lastIn: 200_000, out: 11_300 }] }, version: 1 } }
      : next(e))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(120), surface })
    expect(await ui.find({ type: 'Button', key: 'f-main' })).toBeDefined()
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain('Measuring impressions v9 and v10')
    expect(texts).toMatch(/\d+[hm] \d+[ms] · ↓ 211\.3k tokens/)
    await ui.press({ key: 'f-a1' })
    await ui.unmount()
  }
  expect(viewed).toContainEqual(expect.objectContaining({ agentId: 'a1' }))
})

test('ACTIVE FORKS shows the activity of a live fork, not of an ended one', async ($, on) => {
  engine(on)
  const fork = (id: string, status: string, act: string) => ({ id, name: `job ${id}`, status, since: 1_700_000_000_000 - 60_000, tools: 1, lastIn: 0, out: 0, act })
  on('state.get', (_, e, next) =>
    e.key === 'forks'
      ? { value: { value: { shape: 'forks-2', value: [fork('a1', 'running', 'Counting own deposits'), fork('a2', 'completed', 'Bash old work')] }, version: 1 } }
      : next(e))
  const ui = await $.ui.mount({ ...pane(160), surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(texts).toContain('Counting own deposits')
  expect(texts).not.toContain('Bash old work')
  await ui.unmount()
})

test('FORKS view is Active Forks full screen, with each fork\'s tool calls', async ($, on) => {
  engine(on)
  const viewed: unknown[] = []
  on('ui.view', (_, e) => { viewed.push(e); return { value: {} } })
  const fork = (id: string, status: string, act: string) => ({ id, name: `job ${id}`, status, since: 1_700_000_000_000 - 60_000, tools: 7, lastIn: 1_000, out: 500, act })
  on('state.get', (_, e, next) =>
    e.key === 'forks' ? { value: { value: { shape: 'forks-2', value: [fork('a1', 'running', 'Counting deposits'), fork('a2', 'completed', 'old')] }, version: 1 } }
    : e.key === 'mode' ? { value: { value: 'agents', version: 1 } } as never
    : next(e))
  const ui = await $.ui.mount({ ...pane(160), surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(texts).toContain('FORKS — opens the agent transcript')
  expect(texts).not.toContain('ACTIVE FORKS')
  expect(texts).toContain('Counting deposits')
  expect(texts).toContain('job a2')
  expect(texts).toMatch(/7 tools · \d+[hms]( \d+[ms])? · ↓ 1\.5k tokens/)
  expect(await ui.find({ type: 'Button', key: 'f-main' })).toBeDefined()
  await ui.press({ key: 'f-a2' })
  expect(viewed).toContainEqual(expect.objectContaining({ agentId: 'a2' }))
  await ui.unmount()
})

// ---- PERMISSIONS ----
import type { Gate } from '../types/index'

const GATE: Gate = {
  events: [
    { id: 't1', at: 1_700_000_000_000 - 60_000, tool: 'Bash', cat: 's', kind: 'a', via: 'rule', rule: 'Bash(ls:*)', detail: 'ls', isReadOnly: true },
    { id: 't2', at: 1_700_000_000_000 - 30_000, tool: 'WebFetch', cat: 'o', kind: 'p', via: 'person', detail: 'https://x.io', isReadOnly: true },
    { id: 't3', at: 1_700_000_000_000 - 10_000, tool: 'Write', cat: 'f', kind: 'd', via: 'rule', rule: 'Write(/etc/**)', detail: '/etc/x', reason: 'nope', isReadOnly: false },
  ],
  total: 7,
  counts: { a: 3, c: 1, h: 1, p: 1, d: 1 },
  cats: { f: 2, s: 4, o: 1 },
  reads: 5, writes: 2, main: 6, forks: 1,
  rules: [{ rule: 'Bash(ls:*)', n: 3 }],
  waitMs: 4_000, waits: 2,
}

test('a2 opens PERMISSIONS with counters, rules and recent asks; back returns', async ($, on) => {
  engine(on)
  on('state.get', (_, e, next) =>
    e.key === 'gate' ? { value: { value: { shape: 'gate-1', value: GATE }, version: 1 } } : next(e))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(120), surface })
    await ui.press({ key: 'a2' })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const texts = all.join('\n')
    // title and count are sibling Texts in one row
    for (const s of ['GATE · permissions', '7 checks', '3 allowed', '1 classifier', '1 approved', '1 pending', '1 denied', 'f: file 2', 's: shell 4', 'o: other 1', 'TOP RULES', 'Bash(ls:*)', 'RECENT', 'WebFetch', 'Write'])
      expect(texts, `${surface}: ${s}`).toContain(s)
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeUndefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeDefined()
    await ui.unmount()
  }
})

function gateSpy(on: On) {
  const box: { g?: Gate } = {}
  on('state.set', (_, e, next) => {
    if (e.plugin === 'prodash' && e.key === 'gate') box.g = (e.value as { value: Gate }).value
    return next(e)
  })
  return box
}

test('tool.check allow by rule counts as a / shell / rule', async ($, on) => {
  const { clock: flushClock } = engine(on)
  on('tool.check', () => ({ decision: 'allow', rule: 'Bash(ls:*)' }))
  const box = gateSpy(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  await flushClock.advance(1000)
  const g = box.g!
  expect(g, 'gate never written').toBeDefined()
  await flushClock.advance(1000)
  expect(g.total).toBe(2)
  await flushClock.advance(1000)
  expect(g.counts.a).toBe(2)
  await flushClock.advance(1000)
  expect(g.cats).toEqual({ f: 1, s: 1, o: 0 })
  await flushClock.advance(1000)
  expect(g.rules).toContainEqual({ rule: 'Bash(ls:*)', n: 2 })
  await flushClock.advance(1000)
  expect(g.events.map(e => [e.tool, e.kind, e.via])).toEqual([['Bash', 'a', 'rule'], ['Read', 'a', 'rule']])
})

test('tool.check deny counts as d; queries are ignored', async ($, on) => {
  const { clock: flushClock } = engine(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'blocked' }))
  const box = gateSpy(on)
  await $.tool.call({ tool: 'WebFetch', url: 'https://x.io' })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  await flushClock.advance(1000)
  expect(box.g?.total).toBe(1)
  await flushClock.advance(1000)
  expect(box.g?.counts.d).toBe(1)
  await flushClock.advance(1000)
  expect(box.g?.cats.o).toBe(1)
})

test('an ask is pending, then approved (h) or denied (d) when the call finishes', async ($, on) => {
  const { clock: flushClock } = engine(on)
  on('tool.check', () => ({ decision: 'ask' }))
  let answer: 'allow' | 'deny' = 'allow'
  on('classic.PermissionRequest', () => ({ decision: answer === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: "The user doesn't want to proceed with this tool use." } }) as never)
  const box = gateSpy(on)
  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  answer = 'deny'
  // a PermissionRequest deny resolves the call errored ({ isError, text }), not with a `deny` field
  await $.tool.call({ tool: 'Bash', command: 'rm y' })
  await flushClock.advance(1000)
  const g = box.g!
  expect(g.events.map(e => e.kind)).toEqual(['h', 'd'])
  await flushClock.advance(1000)
  expect(g.counts.p).toBe(0)
  await flushClock.advance(1000)
  expect(typeof g.events[0].waitMs).toBe('number')
})

// ---- BOARD ----
import type { Touched, Request, Plan, Bg, Cron, Todo } from '../types/index'

const NOW = 1_700_000_000_000
const BOARD: Record<string, [string, unknown]> = {
  touched: ['touched-1', [{ path: '/p/a.ts', add: 2, del: 1, edits: 1, isNew: false, at: NOW - 5_000 }] satisfies Touched[]],
  requests: ['requests-1', [{ at: NOW - 60_000, text: 'build it', tools: 3, isDone: true, durationMs: 12_000 }] satisfies Request[]],
  plan: ['plan-1', { at: NOW - 30_000, steps: [{ text: 'Add parser', isChecked: false }, { text: 'Write tests', isChecked: false }] } satisfies Plan],
  bg: ['bg-1', [{ id: 'b1', kind: 'shell', desc: 'dev server', status: 'running', since: NOW - 10_000 }] satisfies Bg[]],
  crons: ['crons-1', [{ id: 'c1', schedule: 'every 5 minutes', prompt: 'check deploy', recurring: true, nextFireAt: NOW + 60_000 }] satisfies Cron[]],
  todos: ['todos-2', [{ id: '7', content: 'Write tests', status: 'completed' }] satisfies Todo[]],
}

function seedBoard(on: On) {
  on('state.get', (_, e, next) =>
    e.plugin === 'prodash' && e.key in BOARD
      ? { value: { value: { shape: BOARD[e.key][0], value: BOARD[e.key][1] }, version: 1 } } as never
      : next(e))
}

test('a4 board: every section at 80 and 140, empty and seeded; back returns', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) for (const cols of [80, 140]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    await ui.press({ key: 'a3' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['BOARD', 'PLAN', 'FILES TOUCHED', 'TIMELINE', 'BACKGROUND', 'SCHEDULED'])
      expect(texts, `${surface} ${cols} empty: ${s}`).toContain(s)
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeDefined()
    await ui.unmount()
  }
})

test('a4 board renders seeded plan, files, timeline, background and crons', async ($, on) => {
  engine(on)
  seedBoard(on)
  for (const surface of SURFACES) for (const cols of [80, 140]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    await ui.press({ key: 'a3' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['BOARD', 'PLAN', 'FILES TOUCHED', 'TIMELINE', 'BACKGROUND', 'SCHEDULED',
      'Add parser', 'Write tests', 'a.ts', '+2 −1', 'build it', 'dev server', 'every 5 minutes'])
      expect(texts, `${surface} ${cols}: ${s}\n${texts}`).toContain(s)
    await ui.press({ key: 'back' }) // mode persists across mounts; a4 toggles
    await ui.unmount()
  }
})

// Captures the last write of each board key.
function boardSpy(on: On) {
  const box: Record<string, any> = {}
  on('state.set', (_, e, next) => {
    if (e.plugin === 'prodash') box[e.key] = (e.value as { value?: unknown })?.value
    return next(e)
  })
  return box
}


test('Edit and Write results become touched files', async ($, on) => {
  engine(on, {
    Edit: { filePath: '/p/a.ts', oldString: 'y', newString: 'y2\nz', originalFile: 'x\ny', replaceAll: false, userModified: false,
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' x', '-y', '+y2', '+z'] }] },
    Write: { type: 'create', filePath: '/p/n.ts', content: 'a\nb\nc', structuredPatch: [], originalFile: null },
  })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'y', new_string: 'y2\nz' })
  await $.tool.call({ tool: 'Write', file_path: '/p/n.ts', content: 'a\nb\nc' })
  const t = box.touched as Touched[]
  expect(t, 'touched never written').toBeDefined()
  expect(t.find(f => f.path === '/p/a.ts')).toMatchObject({ add: 2, del: 1, edits: 1 })
  expect(t.find(f => f.path === '/p/n.ts')).toMatchObject({ isNew: true, add: 3 })
})

test('a prompt opens a request, main tool calls count, turn.complete closes it', async ($, on) => {
  const { clock: flushClock } = engine(on)
  const box = boardSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'build it' })
  await flushClock.advance(1000)
  expect((box.requests as Request[])?.at(-1)).toMatchObject({ text: 'build it', tools: 0, isDone: false })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await flushClock.advance(1000)
  expect((box.requests as Request[]).at(-1)?.tools).toBe(2)
  await ($ as any).turn.complete({ answer: 'ok', durationMs: 1234, isAborted: false, turnId: 't1', reason: 'answer' })
  const r = (box.requests as Request[]).at(-1)!
  await flushClock.advance(1000)
  expect(r.isDone).toBe(true)
  await flushClock.advance(1000)
  expect(typeof r.durationMs).toBe('number')
})

test('ExitPlanMode stores numbered steps over checkboxes', async ($, on) => {
  engine(on, { ExitPlanMode: { plan: '# P\n1. Add parser\n2. Write tests\n- [x] done step', isAgent: false } })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'ExitPlanMode', plan: '# P' } as never)
  expect((box.plan as Plan)?.steps.map(s => s.text)).toEqual(['Add parser', 'Write tests'])
})

test('ExitPlanMode falls back to checkboxes, keeping [x]', async ($, on) => {
  engine(on, { ExitPlanMode: { plan: '# P\n- [ ] Add parser\n- [x] Write tests', isAgent: false } })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'ExitPlanMode', plan: '# P' } as never)
  expect((box.plan as Plan)?.steps).toEqual([{ text: 'Add parser', isChecked: false }, { text: 'Write tests', isChecked: true }])
})

test('TaskCreate then TaskUpdate keep a todo with its id', async ($, on) => {
  engine(on, { TaskCreate: { task: { id: '7', subject: 'Write tests' } }, TaskUpdate: { success: true, taskId: '7', updatedFields: ['status'] } })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'd' } as never)
  expect(box.todos as Todo[]).toContainEqual({ id: '7', content: 'Write tests', status: 'pending' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' } as never)
  expect((box.todos as Todo[]).find(t => t.id === '7')?.status).toBe('completed')
})

test('background shells and monitors are tracked; TaskStop removes one', async ($, on) => {
  engine(on, { Bash: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, Monitor: { taskId: 'm1' }, TaskStop: { message: 'stopped' } })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true, description: 'dev server' } as never)
  expect(box.bg as Bg[]).toContainEqual(expect.objectContaining({ id: 'b1', kind: 'shell', desc: 'dev server', status: 'running' }))
  await $.tool.call({ tool: 'Monitor', command: 'tail -f x', description: 'watch logs' } as never)
  expect((box.bg as Bg[]).find(b => b.id === 'm1')?.kind).toBe('monitor')
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as never)
  expect((box.bg as Bg[]).map(b => b.id)).toEqual(['m1'])
})

test('CronCreate adds a cron, CronDelete removes it', async ($, on) => {
  engine(on, { CronCreate: { id: 'c1', humanSchedule: 'every 5 minutes', recurring: true, nextFireAt: NOW + 300_000 }, CronDelete: { id: 'c1' } })
  const box = boardSpy(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check deploy' } as never)
  expect(box.crons as Cron[]).toContainEqual(expect.objectContaining({ id: 'c1', schedule: 'every 5 minutes', prompt: 'check deploy', recurring: true }))
  await $.tool.call({ tool: 'CronDelete', id: 'c1' } as never)
  expect(box.crons as Cron[]).toEqual([])
})

// ---- MCP SERVERS ----
import type { McpServer } from '../types/index'

const MCP: McpServer[] = [
  { name: 'alpha', status: 'connected', tools: 20, calls: 4, errors: 1, totalMs: 6_000, lastAt: NOW - 1_000 },
  { name: 'beta', status: 'connected', tools: 10, calls: 0, errors: 0, totalMs: 0 },
  { name: 'gamma', status: 'failed', tools: 0, calls: 0, errors: 0, totalMs: 0, error: 'boom' },
]

const mcpTool = (name: string) => ({ name, description: '', mcp: true })

function mcpSpy(on: On) {
  const box: { m?: McpServer[] } = {}
  on('state.set', (_, e, next) => {
    if (e.plugin === 'prodash' && e.key === 'mcp') box.m = (e.value as { value: McpServer[] }).value
    return next(e)
  })
  return box
}
const srv = (box: { m?: McpServer[] }, name: string) => box.m?.find(s => s.name === name)

test('MCP SERVERS: compact box under the action bar; key 4 shows every detail', async ($, on) => {
  engine(on)
  on('state.get', (_, e, next) =>
    e.plugin === 'prodash' && e.key === 'mcp' ? { value: { value: { shape: 'mcp-1', value: MCP }, version: 1 } } as never : next(e))
  for (const surface of SURFACES) for (const cols of [80, 140]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const texts = all.join('\n')
    const at = all.findIndex(t => t.includes('MCP SERVERS'))
    expect(at, `${surface} ${cols}\n${texts}`).toBeGreaterThanOrEqual(0)
    expect(at, `${surface} ${cols}: below header row`).toBeGreaterThan(all.findIndex(t => t === 'AGENT OVERVIEW'))
    // Context shares the row, to the right of MCP
    expect(all.findIndex(t => t === 'CONTEXT'), `${surface} ${cols}: context right of MCP`).toBeGreaterThan(at)
    for (const s of ['2 connected', '30 tools', '1 failed', 'alpha', 'beta', 'gamma'])
      expect(texts, `${surface} ${cols}: ${s}\n${texts}`).toContain(s)
    // the details wait for key 4
    expect(texts, `${surface} ${cols}: no calls in the compact box`).not.toContain('4 calls')
    // the action bar sits between the header row and the MCP / Context row
    const bar = all.findIndex(t => t === 'ACTION BAR')
    expect(bar, `${surface} ${cols}: action bar below header`).toBeGreaterThan(all.findIndex(t => t === 'AGENT OVERVIEW'))
    expect(bar, `${surface} ${cols}: action bar above MCP`).toBeLessThan(at)

    await ui.press({ key: 'a4' })
    const detail = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['20 tools', '10 tools', '4 calls', '1 err', 'avg 1.5s', 'boom'])
      expect(detail, `${surface} ${cols}: detail ${s}\n${detail}`).toContain(s)
    // beta has no calls: no avg on its row
    expect(detail.match(/avg \d+\.\d+s/g)?.length, `${surface} ${cols}: one avg only`).toBe(1)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('CONTEXT: top rows and Free space in the box; key 5 shows every row, memory files and skills', async ($, on) => {
  const breakdown = {
    totalTokens: 198_900, rawMaxTokens: 1_000_000, model: 'claude-opus-5-5', isAutoCompactEnabled: true, autoCompactThreshold: 967_000,
    categories: [
      { name: 'Messages', tokens: 159_100, kind: 'used' },
      { name: 'System tools', tokens: 24_300, kind: 'used' },
      { name: 'Skills', tokens: 7_600, kind: 'used' },
      { name: 'System prompt', tokens: 4_300, kind: 'used' },
      { name: 'Memory files', tokens: 1_400, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'Free space', tokens: 767_400, kind: 'free' },
      { name: 'MCP tools (deferred)', tokens: 63_500, kind: 'deferred' },
    ],
    mcpTools: [{ name: 'mcp__alpha__a', tokens: 1_000, isLoaded: true }, { name: 'mcp__alpha__b', tokens: 200, isLoaded: false }, { name: 'mcp__beta__x', tokens: 300, isLoaded: false }],
    memoryFiles: [{ path: 'C:/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 1_400 }],
    skills: { totalSkills: 2, includedSkills: 2, tokens: 900, skillFrontmatter: [{ name: 'tiny', tokens: 100 }, { name: 'heavy-skill', tokens: 800 }] },
  }
  const { list } = engine(on, {}, { startedAt: 0, context: { percent: 20, breakdown }, rateLimits: [] })
  list.push(mcpTool('mcp__alpha__a'), mcpTool('mcp__alpha__b'), mcpTool('mcp__beta__x'))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(160), surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['20% used', '198.9k / 1.0M', 'Messages', '159.1k', '15.9%', 'System prompt', 'Free space', '76.7%', '1.2k', '1.5k'])
      expect(texts, `${surface}: ${s}\n${texts}`).toContain(s)
    // only the top 4 used rows and Free space: the 5th, the buffer and deferred rows wait for key 5
    for (const s of ['Memory files', 'Autocompact buffer', 'MCP tools (deferred)'])
      expect(texts, `${surface}: not ${s}`).not.toContain(s)

    await ui.press({ key: 'a5' })
    const d = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['Opus 5.5', 'autocompact at 967.0k', 'Memory files', 'Autocompact buffer', 'MCP tools (deferred)', '—',
      'MEMORY FILES', '~/.claude/CLAUDE.md', 'SKILLS', 'heavy-skill'])
      expect(d, `${surface}: detail ${s}\n${d}`).toContain(s)
    // most tokens first, Free space last; heaviest skill first
    const at = (s: string) => d.indexOf(s)
    expect(at('Messages')).toBeLessThan(at('MCP tools (deferred)'))
    expect(at('MCP tools (deferred)')).toBeLessThan(at('Autocompact buffer'))
    expect(at('Autocompact buffer')).toBeLessThan(at('Free space'))
    // the compact boxes give their room to the detail view
    expect(d).not.toContain('MCP SERVERS')
    await ui.press({ key: 'a4' })
    const m = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(m, `${surface}: mcp detail\n${m}`).toContain('1.0k in context now, 0.5k deferred')
    expect(m).toContain('1/2 tools loaded')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('MCP SERVERS box shows even with no servers', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(80), surface })
    expect(await ui.find({ type: 'Text', text: /MCP SERVERS/ }), surface).toBeDefined()
    await ui.unmount()
  }
})

test('session.start groups mcp__<server>__<tool> by server as connected', async ($, on) => {
  const { list } = engine(on)
  list.push(mcpTool('mcp__srv__a'), mcpTool('mcp__srv__b'), mcpTool('mcp__other__x'), mcpTool('mcp__my__deep__tool'),
    { name: 'Bash', description: '', mcp: false })
  const box = mcpSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(box.m, 'mcp never written').toBeDefined()
  expect(box.m!.map(s => s.name).sort()).toEqual(['my', 'other', 'srv'])
  expect(srv(box, 'srv')).toMatchObject({ status: 'connected', tools: 2, calls: 0, errors: 0, totalMs: 0 })
  expect(srv(box, 'my')).toMatchObject({ status: 'connected', tools: 1 })
})

test('a tool.call to mcp__srv__x counts calls, time, lastAt; isError counts an error', async ($, on) => {
  const { clock: flushClock, list } = engine(on)
  list.push(mcpTool('mcp__srv__x'), mcpTool('mcp__srv__bad'))
  // a person's deny on an ask resolves the call errored: top-level { isError: true, text }
  on('tool.check', (_, e, next) => e.tool === 'mcp__srv__bad' ? { decision: 'ask' } : next(e))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'no' } }) as never)
  const box = mcpSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__srv__x' } as never)
  await flushClock.advance(1000)
  expect(srv(box, 'srv')).toMatchObject({ calls: 1, errors: 0 })
  await flushClock.advance(1000)
  expect(typeof srv(box, 'srv')!.totalMs).toBe('number')
  await flushClock.advance(1000)
  expect(typeof srv(box, 'srv')!.lastAt).toBe('number')
  await $.tool.call({ tool: 'mcp__srv__bad' } as never)
  await flushClock.advance(1000)
  expect(srv(box, 'srv')).toMatchObject({ calls: 2, errors: 1 })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await flushClock.advance(1000)
  expect(srv(box, 'srv')?.calls).toBe(2)
})

test('a denied mcp call counts an error', async ($, on) => {
  const { clock: flushClock, list } = engine(on)
  list.push(mcpTool('mcp__srv__x'))
  on('tool.check', () => ({ decision: 'deny', reason: 'blocked' }))
  const box = mcpSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__srv__x' } as never)
  await flushClock.advance(1000)
  expect(srv(box, 'srv')).toMatchObject({ calls: 1, errors: 1 })
})

test('WaitForMcpServers sets every status, adding unknown servers', async ($, on) => {
  const { list } = engine(on, { WaitForMcpServers: { ready: false, connected: ['a'], failed: ['b'], stillPending: ['c'], needsAuth: ['d'], disabled: ['e'], unknown: [] } })
  list.push(mcpTool('mcp__a__t'))
  const box = mcpSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'WaitForMcpServers' } as never)
  expect(Object.fromEntries(box.m!.map(s => [s.name, s.status]))).toEqual({ a: 'connected', b: 'failed', c: 'pending', d: 'needs-auth', e: 'disabled' })
  expect(srv(box, 'a')?.tools).toBe(1)
})

test('ToolSearch pending and failed servers set status and error', async ($, on) => {
  engine(on, { ToolSearch: { matches: [], query: 'x', total_deferred_tools: 0, pending_mcp_servers: ['c'], failed_mcp_servers: [{ name: 'b', error: 'boom' }] } })
  const box = mcpSpy(on)
  await $.tool.call({ tool: 'ToolSearch', query: 'x' } as never)
  expect(srv(box, 'c')?.status).toBe('pending')
  expect(srv(box, 'b')).toMatchObject({ status: 'failed', error: 'boom' })
})

test('every 30s the list refreshes: stats kept, vanished servers dropped or kept failed', { timeoutMs: 30_000 }, async ($, on) => {
  const { list, clock } = engine(on, { ToolSearch: { matches: [], query: 'x', total_deferred_tools: 0, failed_mcp_servers: [{ name: 'flaky', error: 'gone' }] } })
  list.push(mcpTool('mcp__srv__a'), mcpTool('mcp__quiet__a'), mcpTool('mcp__flaky__a'))
  const box = mcpSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__srv__a' } as never)
  await $.tool.call({ tool: 'ToolSearch', query: 'x' } as never)
  list.splice(0, list.length, mcpTool('mcp__srv__a'), mcpTool('mcp__srv__b'), mcpTool('mcp__new__a'))
  await clock.advance(30_000)
  expect(srv(box, 'srv'), 'refresh').toMatchObject({ status: 'connected', tools: 2, calls: 1 })
  expect(srv(box, 'new')?.status).toBe('connected')
  expect(srv(box, 'quiet'), 'no failure reported: dropped').toBeUndefined()
  expect(srv(box, 'flaky')).toMatchObject({ status: 'failed', error: 'gone' })
})

// ---- THEME ----
import type { ThemeState } from '../types/index'

// A versioned in-memory theme cell: seeded read, writes recorded (box.t = last write or seed).
function seedTheme(on: On, t?: ThemeState) {
  const box: { t?: ThemeState; writes: ThemeState[]; version: number } = { t, writes: [], version: t ? 1 : 0 }
  const isTheme = (e: { plugin: string; key: string }) => e.plugin === 'prodash' && e.key === 'theme'
  on('state.get', (_, e, next) =>
    isTheme(e) && box.t ? { value: { value: { shape: 'theme-1', value: box.t }, version: box.version } } as never : next(e))
  on('state.set', (_, e, next) => {
    if (!isTheme(e)) return next(e)
    if (e.ifVersion !== undefined && e.ifVersion !== box.version) return { value: { isSet: false, version: box.version } } as never
    box.writes.push(box.t = (e.value as { value: ThemeState }).value)
    return { value: { isSet: true, version: ++box.version } } as never
  })
  return box
}
const themeSpy = (on: On) => seedTheme(on)

const PRESETS = ['default', 'matrix', 'dracula', 'nord', 'amber', 'cyberpunk', 'mono']
const ROLES = ['border', 'ok', 'warn', 'bad', 'info', 'accent', 'dim', 'white']

async function openTheme(ui: any, label: string) {
  await ui.press({ key: 'a6' })
  expect(await ui.find({ type: 'Text', text: /THEME/ }), `${label}: THEME view`).toBeDefined()
}

test('action bar is a titled box with a1..a7 in order', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) for (const cols of [80, 160]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    expect(await ui.find({ type: 'Text', text: 'ACTION BAR' }), `${surface} ${cols}: title`).toBeDefined()
    const keys = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']
    const labels = await Promise.all(keys.map(async k => { const b = await ui.find({ type: 'Button', key: k }); return String(b?.props.label ?? b?.text) }))
    expect(labels, `${surface} ${cols}: labels`).toEqual(['Forks', 'Perms', 'Board', 'MCP', 'Context', 'Theme', 'Log'])
    await ui.unmount()
  }
})

test('a6 opens THEME: every preset, custom, current marked ●; back returns', async ($, on) => {
  engine(on)
  seedTheme(on, { name: 'nord', base: 'nord', custom: {} })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(120), surface })
    await openTheme(ui, surface)
    for (const p of [...PRESETS, 'custom']) expect(await ui.find({ type: 'Button', key: `th-${p}` }), `${surface}: th-${p}`).toBeDefined()
    const nord = await ui.find({ type: 'Button', key: 'th-nord' })
    const dflt = await ui.find({ type: 'Button', key: 'th-default' })
    expect(`${nord?.props.label ?? ''} ${nord?.text ?? ''}`, `${surface}: current marked`).toContain('●')
    expect(`${dflt?.props.label ?? ''} ${dflt?.text ?? ''}`, `${surface}: others unmarked`).not.toContain('●')
    for (const r of ROLES) {
      expect(await ui.find({ type: 'Input', key: `in-${r}` }), `${surface}: in-${r}`).toBeDefined()
      expect(await ui.find({ type: 'Select', key: `sel-${r}` }), `${surface}: sel-${r}`).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' })).toBeUndefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVE FORKS' }), `${surface}: back`).toBeDefined()
    await ui.unmount()
  }
})

test('th-matrix writes the preset, keeps custom, persists it to prodash.theme', async ($, on) => {
  const { store } = engine(on)
  const box = seedTheme(on, { name: 'custom', base: 'default', custom: { ok: '#010203' } })
  const ui = await $.ui.mount({ ...pane(120), surface: 'terminal' })
  await openTheme(ui, 'terminal')
  await ui.press({ key: 'th-matrix' })
  expect(box.t).toEqual({ name: 'matrix', base: 'matrix', custom: { ok: '#010203' } })
  expect(store.get('prodash.theme')).toEqual(box.t)
  await ui.unmount()
})

test('custom: in-ok takes #rrggbb or rrggbb, rejects zzz; sel-border sets border; th-reset clears', async ($, on) => {
  const { store } = engine(on)
  const box = seedTheme(on, { name: 'nord', base: 'nord', custom: {} })
  for (const surface of SURFACES) {
    box.t = { name: 'nord', base: 'nord', custom: {} }
    const ui = await $.ui.mount({ ...pane(120), surface })
    await openTheme(ui, surface)
    await ui.input({ key: 'in-ok', text: '#123abc' })
    expect(box.t, `${surface}: #123abc`).toEqual({ name: 'custom', base: 'nord', custom: { ok: '#123abc' } })
    await ui.input({ key: 'in-ok', text: '00ff00' })
    expect(box.t?.custom.ok, `${surface}: bare hex`).toBe('#00ff00')
    const n = box.writes.length
    await ui.input({ key: 'in-ok', text: 'zzz' })
    expect(box.writes.slice(n).some(t => /z/.test(t.custom.ok ?? '')), `${surface}: zzz written`).toBe(false)
    expect(box.t?.custom.ok, `${surface}: ok kept`).toBe('#00ff00')
    const sel = await ui.find({ type: 'Select', key: 'sel-border' })
    const opts = (sel?.props.options ?? []) as { value: string }[]
    expect(opts.length, `${surface}: sel-border options`).toBeGreaterThan(0)
    const pick = opts.at(-1)!.value
    await ui.select({ key: 'sel-border', value: pick })
    expect(box.t, `${surface}: sel-border`).toMatchObject({ name: 'custom', base: 'nord', custom: { ok: '#00ff00', border: pick } })
    expect(store.get('prodash.theme'), `${surface}: persisted`).toEqual(box.t)
    await ui.press({ key: 'th-reset' })
    expect(box.t?.custom, `${surface}: reset`).toEqual({})
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('render uses the palette: custom border colours section titles and box borders', async ($, on) => {
  engine(on)
  seedTheme(on, { name: 'custom', base: 'default', custom: { border: '#123456' } })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(120), surface })
    // the title's wrapper Text also matches; take the leaf that draws exactly the title
    const t = (await ui.findAll({ type: 'Text', text: 'SYSTEM STATUS' })).find(x => x.text === 'SYSTEM STATUS')
    expect(t?.props.color, `${surface}: SYSTEM STATUS colour`).toBe('#123456')
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes.some(b => b.props.borderColor === '#123456'), `${surface}: a box border is #123456`).toBe(true)
    await ui.unmount()
  }
})

test('session.start loads a valid stored theme', async ($, on) => {
  const { store } = engine(on)
  const box = themeSpy(on)
  store.set('prodash.theme', { name: 'dracula', base: 'dracula', custom: { ok: '#abcdef' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(box.t).toEqual({ name: 'dracula', base: 'dracula', custom: { ok: '#abcdef' } })
})

test('session.start ignores a stored theme that is not a ThemeState', async ($, on) => {
  const { store } = engine(on)
  const box = themeSpy(on)
  store.set('prodash.theme', { name: 42, custom: 'x' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(box.writes.some(t => (t as any).name === 42)).toBe(false)
})
