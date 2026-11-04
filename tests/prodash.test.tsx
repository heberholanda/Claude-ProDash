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
function engine(on: On) {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'prodash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
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

test('600 tool calls keep logs at 500', async ($, on) => {
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
