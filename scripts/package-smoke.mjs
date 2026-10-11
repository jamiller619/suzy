import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'suzy-package-'))
const run = (command, args, cwd = dir) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
try {
  const tar = join(dir, 'suzy.tgz')
  run('yarn', ['pack', '--filename', tar], process.cwd())
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'suzy-consumer-test',
      private: true,
      type: 'module',
      dependencies: { suzy: `file:${tar}` },
    }),
  )
  run('yarn', [
    'install',
    '--production',
    '--ignore-scripts',
    '--non-interactive',
  ])
  const bin = join(dir, 'node_modules/.bin/suzy')
  assert.match(run(bin, ['--version']), /^0\.1\.0/)
  run(bin, ['init'])
  run(bin, ['build'])
  assert.match(
    await readFile(join(dir, 'src/styles/theme.css'), 'utf8'),
    /@layer suzy/,
  )
  run(process.execPath, [
    '--input-type=module',
    '-e',
    "import {resolveConfig,createTheme,renderCss} from 'suzy'; import schema from 'suzy/schema' with {type:'json'}; if (!schema.properties.version || !renderCss(createTheme(resolveConfig())).includes('--suzy-bg')) throw Error('Bad exports');",
  ])
  console.log(
    'Package smoke passed: isolated production install, executable, init/build, library exports, schema.',
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}
