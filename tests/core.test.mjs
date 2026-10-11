import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  chooseForeground,
  configSchema,
  contrastRatio,
  createTheme,
  palettes,
  parseColor,
  renderCss,
  resolveConfig,
  resolvePalette,
  resolveToken,
  validateTheme,
} from '../dist/core/compiler.js'
import { renderPreview } from '../dist/preview/page.js'

const compile = (input) => createTheme(resolveConfig(input))

test('empty configuration provides a complete theme and is side-effect free', () => {
  const input = {}
  const config = resolveConfig(input)
  const theme = createTheme(config)
  assert.deepEqual(input, {})
  assert.equal(config.colors.accent, 'violet')
  for (const mode of ['light', 'dark']) {
    assert.ok(Object.keys(theme.modes[mode]).length > 200)
    assert.equal(
      validateTheme(theme).filter((d) => d.severity === 'error').length,
      0,
    )
    for (const token of [
      'bg',
      'space-9',
      'radius-full',
      'duration-fast',
      'z-dialog',
      'info-border',
    ])
      assert.ok(theme.modes[mode][`--suzy-${token}`])
  }
})
test('configuration rejects unknown keys, wrong types, palette hex and CSS injection', () => {
  for (const input of [
    null,
    [],
    { version: 2 },
    { colors: { accent: '#ff0000' } },
    { colors: { gray: 'violet' } },
    { density: 'tiny' },
    { unknown: true },
    { font: { family: { other: 'x' } } },
    { overrides: { shared: { color: 'red' } } },
    { overrides: { shared: { '--suzy-bg': 'red; color: blue' } } },
    { font: { family: { body: '</style>' } } },
    { overrides: { shared: { '--suzy-bg': 'url(https://example.com)' } } },
    JSON.parse('{"__proto__":{}}'),
  ])
    assert.throws(() => resolveConfig(input))
  assert.throws(
    () => resolveConfig({ colors: { accent: '#fff' } }),
    /named Radix palettes/,
  )
  assert.throws(
    () => resolveConfig({ colors: { accent: 'oops' } }),
    /config.colors.accent/,
  )
})
test('generated schema matches compiler schema', async () => {
  assert.deepEqual(
    JSON.parse(
      await readFile(new URL('../suzy.schema.json', import.meta.url), 'utf8'),
    ),
    configSchema,
  )
})
test('all supported palettes resolve light, dark, and alpha scales', () => {
  for (const name of palettes)
    for (const mode of ['light', 'dark'])
      for (const alpha of [false, true]) {
        const scale = resolvePalette(name, mode, alpha)
        assert.equal(scale.length, 12)
        assert.ok(scale.every((s) => typeof s === 'string'))
      }
  assert.equal(resolvePalette('violet', 'light')[8], '#6e56cf')
  assert.notDeepEqual(
    resolvePalette('violet', 'light'),
    resolvePalette('violet', 'dark'),
  )
})
test('mode overrides win over shared; aliases and automatic foreground use overrides', () => {
  const t = compile({
    overrides: {
      shared: {
        '--suzy-bg': '#123456',
        '--suzy-accent-9': '#ffff00',
        '--suzy-accent-10': '#ffff00',
      },
      dark: { '--suzy-bg': '#654321' },
    },
  })
  assert.equal(t.modes.light['--suzy-bg'], '#123456')
  assert.equal(t.modes.dark['--suzy-bg'], '#654321')
  assert.equal(t.modes.light['--suzy-action-text'], '#000000')
  assert.equal(resolveToken(t.modes.light, '--suzy-action'), '#ffff00')
  assert.equal(
    compile({ overrides: { shared: { '--suzy-action-text': '#123456' } } })
      .modes.dark['--suzy-action-text'],
    '#123456',
  )
})
test('CSS is stable across calls and override insertion order', () => {
  const a = { '--suzy-text': '#111111', '--suzy-bg': '#ffffff' },
    b = Object.fromEntries(Object.entries(a).reverse())
  assert.equal(
    renderCss(compile({ overrides: { shared: a } })),
    renderCss(compile({ overrides: { shared: b } })),
  )
  const css = renderCss(compile())
  assert.match(css, /@layer suzy/)
  assert.match(css, /prefers-reduced-motion/)
  assert.doesNotMatch(css, /@import/)
  for (const mode of ['light', 'dark']) {
    const t = compile({ appearance: mode })
    assert.deepEqual(Object.keys(t.modes), [mode])
    assert.doesNotMatch(renderCss(t), /prefers-color-scheme/)
    assert.doesNotMatch(
      renderCss(t),
      new RegExp(`color-scheme: ${mode === 'light' ? 'dark' : 'light'}`),
    )
  }
})
test('references including fallback branches and cycles are validated', () => {
  const t = compile({
    overrides: {
      shared: {
        '--suzy-bg': 'var(--suzy-missing)',
        '--suzy-a': 'var(--suzy-b)',
        '--suzy-b': 'var(--suzy-a)',
        '--suzy-x': 'var(--outside, var(--suzy-y))',
      },
    },
  })
  const d = validateTheme(t)
  assert.ok(d.some((x) => x.code === 'reference'))
  assert.ok(d.some((x) => x.code === 'cycle'))
  assert.ok(d.some((x) => x.message.includes('--suzy-y')))
  assert.equal(resolveToken(t.modes.light, '--suzy-a'), undefined)
})
test('contrast uses WCAG luminance and best worst-state black/white foreground', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21)
  assert.equal(contrastRatio([40, 40, 40], [40, 40, 40]), 1)
  assert.equal(chooseForeground(['#ffff00', '#ffff00']), '#000000')
  assert.equal(chooseForeground(['#000000', '#222222']), '#ffffff')
  assert.deepEqual(parseColor('rgb(255, 128, 0)'), [255, 128, 0])
  assert.equal(parseColor('#ffffff80'), undefined)
  assert.equal(parseColor('rgb(255, 128 0)'), undefined)
  for (const name of palettes)
    for (const mode of ['light', 'dark']) {
      const t = compile({ colors: { accent: name }, appearance: mode })
      const bg = ['action', 'action-hover', 'action-active'].map((n) =>
        parseColor(resolveToken(t.modes[mode], `--suzy-${n}`)),
      )
      const fg = parseColor(t.modes[mode]['--suzy-action-text'])
      const score = (c) => Math.min(...bg.map((b) => contrastRatio(c, b)))
      assert.ok(score(fg) >= score(fg[0] ? [0, 0, 0] : [255, 255, 255]))
    }
})
test('unsupported contrast expressions are unevaluated, not passing', () => {
  const diagnostics = validateTheme(
    compile({
      overrides: {
        light: { '--suzy-action': 'color-mix(in srgb, red, blue)' },
      },
    }),
  )
  const result = diagnostics.find(
    (d) => d.mode === 'light' && d.pair?.[1] === '--suzy-action',
  )
  assert.equal(result.code, 'unevaluated')
  assert.equal(result.severity, 'warning')
  assert.equal(result.pass, undefined)
  const pairs = validateTheme(compile()).filter(
    (d) => d.mode === 'dark' && d.pair?.[0] === '--suzy-action-text',
  )
  assert.equal(pairs.length, 3)
})
test('density retains type sizes; pill keeps panel and dialog radii sensible', () => {
  const compact = compile({ density: 'compact' }).modes.light,
    spacious = compile({ density: 'spacious' }).modes.light
  assert.equal(compact['--suzy-font-size-3'], spacious['--suzy-font-size-3'])
  assert.notEqual(
    compact['--suzy-control-height'],
    spacious['--suzy-control-height'],
  )
  const pill = compile({ radius: 'pill' }).modes.light
  assert.equal(resolveToken(pill, '--suzy-control-radius'), '9999px')
  assert.equal(resolveToken(pill, '--suzy-panel-radius'), '0.75rem')
  assert.equal(
    resolveToken(
      compile({ radius: 'none' }).modes.dark,
      '--suzy-dialog-radius',
    ),
    '0rem',
  )
})
test('preview escapes names and token values without remote assets', () => {
  const html = renderPreview(
    compile({ name: '</title><script>alert(1)</script>' }),
    0,
  )
  assert.ok(!html.includes('</title><script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.doesNotMatch(html, /<link[^>]*https:|<script[^>]*src=/)
})

test('editor schema rejects unsafe CSS values consistently with runtime', () => {
  const schema =
    configSchema.properties.overrides.properties.shared.additionalProperties
  const pattern = new RegExp(schema.pattern)
  for (const value of [
    '   ',
    'red;blue',
    'red/*comment*/',
    'URL(https://example.com)',
    '<style>',
    'red\\foo',
  ]) {
    assert.equal(pattern.test(value), false, value)
    assert.throws(() =>
      resolveConfig({ overrides: { shared: { '--suzy-bg': value } } }),
    )
  }
  assert.equal(pattern.test('var(--suzy-gray-1)'), true)
})

test('font families are opt-in and explicit families remain supported', () => {
  const defaults = compile({})
  assert.deepEqual(defaults.config.font.family, {})
  assert.doesNotMatch(
    renderCss(defaults),
    /font-family:|--suzy-font-(body|mono)/,
  )
  for (const role of ['body', 'mono']) {
    const theme = compile({
      font: { family: { [role]: 'Example Font, serif' } },
    })
    for (const tokens of Object.values(theme.modes)) {
      assert.equal(tokens[`--suzy-font-${role}`], 'Example Font, serif')
      assert.equal(
        tokens[`--suzy-font-${role === 'body' ? 'mono' : 'body'}`],
        undefined,
      )
    }
    assert.match(renderCss(theme), /font-family: var\(--suzy-font-/)
    assert.equal(
      validateTheme(theme).filter((d) => d.severity === 'error').length,
      0,
    )
  }
})
