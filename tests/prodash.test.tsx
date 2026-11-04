import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const pane = (bodyColumns: number) => ({
  plugin: 'prodash',
  component: 'Pane',
  requestId: 'prodash',
  props: {
    title: 'Claude Dashboard Pro',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const)

const SURFACES = ['terminal', 'desktop'] as const
const HEADERS = ['SYSTEM STATUS', 'AGENT OVERVIEW', 'SESSION METRICS', 'ACTIVE FORKS']

// The engine beneath the plugin; the mocked clock holds session.start's timers.
function engine(on: On, tools: Record<string, unknown> = {}) {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'prodash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => ({ result: (tools[e.tool] ?? {}) as never }))
  on('session.cwd', () => ({ value: '/p' }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { percent: 10 }, rateLimits: [] } as never }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } as never }))
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
  expect(longest).toBe(500)
})

test('action bar: a4 opens the board, back returns to the forks', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(160), surface })
    for (const k of ['a1', 'a2', 'a3', 'a4']) expect(await ui.find({ type: 'Button', key: k }), k).toBeDefined()
    await ui.press({ key: 'a4' })
    expect(await ui.find({ type: 'Text', text: /PROJECT BOARD/ })).toBeDefined()
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

// ---- GATE PERMS ----
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

test('a2 opens GATE PERMS with counters, rules and recent asks; back returns', async ($, on) => {
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
  engine(on)
  on('tool.check', () => ({ decision: 'allow', rule: 'Bash(ls:*)' }))
  const box = gateSpy(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  const g = box.g!
  expect(g, 'gate never written').toBeDefined()
  expect(g.total).toBe(2)
  expect(g.counts.a).toBe(2)
  expect(g.cats).toEqual({ f: 1, s: 1, o: 0 })
  expect(g.rules).toContainEqual({ rule: 'Bash(ls:*)', n: 2 })
  expect(g.events.map(e => [e.tool, e.kind, e.via])).toEqual([['Bash', 'a', 'rule'], ['Read', 'a', 'rule']])
})

test('tool.check deny counts as d; queries are ignored', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'blocked' }))
  const box = gateSpy(on)
  await $.tool.call({ tool: 'WebFetch', url: 'https://x.io' })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  expect(box.g?.total).toBe(1)
  expect(box.g?.counts.d).toBe(1)
  expect(box.g?.cats.o).toBe(1)
})

test('an ask is pending, then approved (h) or denied (d) when the call finishes', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'ask' }))
  let answer: 'allow' | 'deny' = 'allow'
  on('classic.PermissionRequest', () => ({ decision: answer === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: "The user doesn't want to proceed with this tool use." } }) as never)
  const box = gateSpy(on)
  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  answer = 'deny'
  // a PermissionRequest deny resolves the call errored ({ isError, text }), not with a `deny` field
  await $.tool.call({ tool: 'Bash', command: 'rm y' })
  const g = box.g!
  expect(g.events.map(e => e.kind)).toEqual(['h', 'd'])
  expect(g.counts.p).toBe(0)
  expect(typeof g.events[0].waitMs).toBe('number')
})

// ---- PROJECT BOARD ----
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
    await ui.press({ key: 'a4' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['PROJECT BOARD', 'PLAN', 'FILES TOUCHED', 'TIMELINE', 'BACKGROUND', 'SCHEDULED'])
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
    await ui.press({ key: 'a4' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const s of ['PROJECT BOARD', 'PLAN', 'FILES TOUCHED', 'TIMELINE', 'BACKGROUND', 'SCHEDULED',
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
  engine(on)
  const box = boardSpy(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'build it' })
  expect((box.requests as Request[])?.at(-1)).toMatchObject({ text: 'build it', tools: 0, isDone: false })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  expect((box.requests as Request[]).at(-1)?.tools).toBe(2)
  await ($ as any).turn.complete({ answer: 'ok', durationMs: 1234, isAborted: false, turnId: 't1', reason: 'answer' })
  const r = (box.requests as Request[]).at(-1)!
  expect(r.isDone).toBe(true)
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
