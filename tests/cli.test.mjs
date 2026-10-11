import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { startPreview } from '../dist/preview/server.js'

const executable = resolve('dist/cli/main.js')
const run = (cwd, ...args) =>
  spawnSync(process.execPath, [executable, ...args], { cwd, encoding: 'utf8' })
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'suzy-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function until(fn, description) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await delay(50)
  }
  assert.fail(`Timed out: ${description}`)
}

test('init writes minimal config and preserves explicitly chosen options', async (t) => {
  const dir = await fixture(t)
  const path = join(dir, 'suzy.config.json')
  let result = run(dir, 'init')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    $schema: './suzy.schema.json',
    colors: { accent: 'violet', gray: 'slate' },
  })
  const cssPath = join(dir, 'src/styles/theme.css')
  const initialCss = await readFile(cssPath, 'utf8')
  result = run(dir, 'build')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(cssPath, 'utf8'), initialCss)

  result = run(
    dir,
    'init',
    '--force',
    '--warning',
    'orange',
    '--density',
    'compact',
  )
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    $schema: './suzy.schema.json',
    colors: { accent: 'violet', gray: 'slate', warning: 'orange' },
    density: 'compact',
  })
  const customCss = await readFile(cssPath, 'utf8')
  assert.notEqual(customCss, initialCss)
  result = run(dir, 'build')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(cssPath, 'utf8'), customCss)
})

test('init, refusal, force, relative output, unchanged builds, and invalid builds', async (t) => {
  const dir = await fixture(t)
  await mkdir(join(dir, 'nested'))
  const path = join(dir, 'nested', 'suzy.config.json')
  let r = run(
    dir,
    'init',
    '--config',
    path,
    '--accent',
    'blue',
    '--radius',
    'pill',
    '--output',
    './generated/theme.css',
  )
  assert.equal(r.status, 0, r.stderr)
  const cssPath = join(dir, 'nested/generated/theme.css')
  const css = await readFile(cssPath, 'utf8')
  assert.match(css, /@layer suzy/)
  const before = await stat(cssPath)
  r = run(dir, 'build', '--config', path)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Unchanged/)
  assert.equal((await stat(cssPath)).mtimeMs, before.mtimeMs)
  r = run(dir, 'init', '--config', path)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--force/)
  await writeFile(path, '{broken')
  r = run(dir, 'build', '--config', path)
  assert.equal(r.status, 1)
  assert.equal(await readFile(cssPath, 'utf8'), css)
  await writeFile(
    path,
    JSON.stringify({
      output: './generated/theme.css',
      overrides: { shared: { '--suzy-bg': 'var(--suzy-missing)' } },
    }),
  )
  assert.equal(run(dir, 'build', '--config', path).status, 1)
  assert.equal(await readFile(cssPath, 'utf8'), css)
  r = run(dir, 'init', '--config', path, '--force')
  assert.equal(r.status, 0, r.stderr)
})
test('help, version, bad arguments, check severity and strict mode', async (t) => {
  const dir = await fixture(t)
  assert.match(run(dir, '--help').stdout, /Cascade FTW/)
  assert.match(run(dir, '--version').stdout, /^0\.1\.0/)
  assert.equal(run(dir, 'banana').status, 1)
  assert.equal(run(dir, 'build', '--accent', 'blue').status, 1)
  await writeFile(
    join(dir, 'suzy.config.json'),
    JSON.stringify({
      overrides: {
        shared: { '--suzy-text': '#ffffff', '--suzy-bg': '#ffffff' },
      },
    }),
  )
  const check = run(dir, 'check')
  assert.equal(check.status, 0)
  assert.match(check.stdout, /1.00:1 FAIL/)
  assert.match(check.stdout, /WARNING/)
  assert.match(check.stdout, /action-active/)
  assert.equal(run(dir, 'check', '--strict').status, 1)
  await writeFile(
    join(dir, 'suzy.config.json'),
    JSON.stringify({
      overrides: { shared: { '--suzy-bg': 'var(--suzy-bg)' } },
    }),
  )
  assert.equal(run(dir, 'check').status, 1)
})
test('watch handles atomic saves, invalid JSON, repair, and clean shutdown', async (t) => {
  const dir = await fixture(t)
  const path = join(dir, 'suzy.config.json')
  const cssPath = join(dir, 'theme.css')
  await writeFile(path, JSON.stringify({ output: './theme.css' }))
  const child = spawn(process.execPath, [executable, 'watch'], { cwd: dir })
  let logs = ''
  child.stdout.on('data', (b) => (logs += b))
  child.stderr.on('data', (b) => (logs += b))
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  await until(() => logs.includes('Watching'), 'initial watch')
  const before = await readFile(cssPath, 'utf8')
  await writeFile(path, '{bad')
  await until(() => logs.includes('Cannot read'), 'invalid JSON diagnostic')
  assert.equal(await readFile(cssPath, 'utf8'), before)
  await writeFile(
    join(dir, 'saved.json'),
    JSON.stringify({ colors: { accent: 'blue' }, output: './theme.css' }),
  )
  await rename(join(dir, 'saved.json'), path)
  await until(
    async () => (await readFile(cssPath, 'utf8')) !== before,
    'rebuild after atomic save',
  )
  const exit = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  assert.equal(await exit, 0)
})
test('preview serves locally, updates, and preserves valid content on errors', async (t) => {
  const dir = await fixture(t)
  const path = join(dir, 'suzy.config.json')
  await writeFile(path, '{}')
  const server = await startPreview(path, 0)
  t.after(server.close)
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:/)
  const initial = await (await fetch(server.url)).text()
  assert.match(initial, /Small choices/)
  await writeFile(path, JSON.stringify({ name: 'Updated theme' }))
  await until(
    async () =>
      (await (await fetch(server.url)).text()).includes('Updated theme'),
    'preview update',
  )
  await writeFile(path, '{bad')
  await delay(250)
  assert.match(await (await fetch(server.url)).text(), /Updated theme/)
  assert.equal((await fetch(`${server.url}/missing`)).status, 404)
})
