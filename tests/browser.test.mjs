import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import {
  createTheme,
  renderCss,
  resolveConfig,
  resolveToken,
} from '../dist/core/compiler.js'
import { startPreview } from '../dist/preview/server.js'

const rgb = (hex) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

test('computed CSS: OS, explicit root, alternating nested scopes, local aliases, reduced motion, single modes', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SUZY_CHROMIUM_EXECUTABLE,
  })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const theme = createTheme(
    resolveConfig({
      overrides: { shared: { '--suzy-local': 'var(--suzy-accent-9)' } },
    }),
  )
  const html = (css) =>
    `<style>${css}</style><style>.sample { background:var(--suzy-bg); color:var(--suzy-text); border:1px solid var(--suzy-local); transition-property:opacity; transition-duration:var(--suzy-duration-normal); }</style><div id="root" class="sample">root</div><div id="dark" class="sample" data-suzy-theme="dark"><div id="light-in-dark" class="sample" data-suzy-theme="light"><div id="dark-in-light" class="sample" data-suzy-theme="dark">nested</div></div></div><div id="light" class="sample" data-suzy-theme="light"><div id="dark-in-light-2" class="sample" data-suzy-theme="dark"><div id="light-in-dark-2" class="sample" data-suzy-theme="light">nested</div></div></div>`
  const computed = (id) =>
    page.locator(`#${id}`).evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        bg: s.backgroundColor,
        text: s.color,
        border: s.borderTopColor,
        scheme: s.colorScheme,
        duration: s.transitionDuration,
      }
    })
  const assertMode = async (id, mode) => {
    const s = await computed(id),
      tokens = theme.modes[mode]
    assert.equal(s.bg, rgb(resolveToken(tokens, '--suzy-bg')), `${id} bg`)
    assert.equal(s.text, rgb(resolveToken(tokens, '--suzy-text')), `${id} text`)
    assert.equal(
      s.border,
      rgb(resolveToken(tokens, '--suzy-local')),
      `${id} local alias`,
    )
    assert.equal(s.scheme, mode)
  }
  await page.setContent(html(renderCss(theme)))
  for (const os of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: os })
    for (const root of [null, 'light', 'dark']) {
      await page.evaluate((mode) => {
        if (mode) document.documentElement.dataset.suzyTheme = mode
        else document.documentElement.removeAttribute('data-suzy-theme')
      }, root)
      await assertMode('root', root ?? os)
      for (const id of ['dark', 'dark-in-light', 'dark-in-light-2'])
        await assertMode(id, 'dark')
      for (const id of ['light', 'light-in-dark', 'light-in-dark-2'])
        await assertMode(id, 'light')
    }
  }
  await page.evaluate(() =>
    document.documentElement.removeAttribute('data-suzy-theme'),
  )
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  for (const id of ['root', 'dark', 'light', 'dark-in-light', 'light-in-dark'])
    assert.equal((await computed(id)).duration, '0s')
  for (const mode of ['light', 'dark']) {
    const single = createTheme(resolveConfig({ appearance: mode }))
    await page.setContent(html(renderCss(single)))
    await page.emulateMedia({
      colorScheme: mode === 'light' ? 'dark' : 'light',
    })
    for (const id of [
      'root',
      'dark',
      'light',
      'dark-in-light',
      'light-in-dark',
    ])
      assert.equal(
        (await computed(id)).bg,
        rgb(resolveToken(single.modes[mode], '--suzy-bg')),
      )
  }
})

test('preview browser: switching, dialogs, live reload/error recovery, responsive layout, no remote assets', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'suzy-browser-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const config = join(dir, 'suzy.config.json')
  await writeFile(config, '{}')
  const server = await startPreview(config, 0)
  t.after(server.close)
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SUZY_CHROMIUM_EXECUTABLE,
  })
  t.after(() => browser.close())
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  })
  const errors = [],
    remote = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (!r.url().startsWith(server.url)) remote.push(r.url())
  })
  await page.goto(server.url)
  await page.selectOption('#appearance', 'dark')
  assert.equal(
    await page.locator('html').getAttribute('data-suzy-theme'),
    'dark',
  )
  await page.locator('[data-dialog="light"]').click()
  assert.equal(
    await page.locator('#dialog-light').evaluate((el) => el.open),
    true,
  )
  await page.locator('#dialog-light button').click()
  assert.equal(
    await page.locator('#dialog-light').evaluate((el) => el.open),
    false,
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await mkdir('test-results', { recursive: true })
  await page.screenshot({
    path: 'test-results/preview-desktop.png',
    fullPage: true,
  })
  await page.screenshot({ path: 'test-results/preview-desktop-viewport.png' })
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `page overflow at ${width}`,
    )
    const overflowing = await page
      .locator('button, input, select, textarea, fieldset, h1, h2, .card')
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const box = el.getBoundingClientRect()
            return box.width && (box.right > innerWidth + 1 || box.left < -1)
          })
          .map((el) => el.outerHTML.slice(0, 100)),
      )
    assert.deepEqual(overflowing, [], `elements outside viewport at ${width}`)
  }
  await page.setViewportSize({ width: 375, height: 900 })
  await page.screenshot({
    path: 'test-results/preview-mobile.png',
    fullPage: true,
  })
  await page.screenshot({ path: 'test-results/preview-mobile-viewport.png' })
  await writeFile(config, '{bad')
  await page.waitForFunction(() =>
    document
      .querySelector('#connection')
      .textContent.includes('Configuration error'),
  )
  await writeFile(config, JSON.stringify({ name: 'Live browser update' }))
  await page.waitForFunction(() =>
    document.title.includes('Live browser update'),
  )
  assert.equal(
    await page.locator('html').getAttribute('data-suzy-theme'),
    'dark',
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
})

test('generated CSS alone styles native controls, preserves behavior, and allows application overrides', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SUZY_CHROMIUM_EXECUTABLE,
  })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const density of ['compact', 'comfortable', 'spacious']) {
    const theme = createTheme(resolveConfig({ density, radius: 'subtle' }))
    await page.setContent(
      `<style>${renderCss(theme)}</style><button id="action">Continue</button><input id="text" placeholder="Name"><input id="check" type="checkbox"><input type="hidden" id="hidden"><button hidden id="hidden-button">Hidden</button><button disabled id="disabled">Disabled</button><textarea>Notes</textarea><select><option>One</option></select><dialog>Closed</dialog><details><summary>More</summary>Content</details>`,
    )
    for (const mode of ['light', 'dark']) {
      await page.evaluate(
        (mode) => (document.documentElement.dataset.suzyTheme = mode),
        mode,
      )
      const styles = await page.evaluate(() => {
        const button = getComputedStyle(document.querySelector('#action'))
        const input = getComputedStyle(document.querySelector('#text'))
        return {
          margin: getComputedStyle(document.body).margin,
          bg: button.backgroundColor,
          height: button.minHeight,
          radius: button.borderRadius,
          inputBg: input.backgroundColor,
          box: input.boxSizing,
          checkHeight: document.querySelector('#check').getBoundingClientRect()
            .height,
        }
      })
      assert.equal(styles.margin, '0px')
      assert.equal(
        styles.bg,
        rgb(resolveToken(theme.modes[mode], '--suzy-gray-3')),
      )
      assert.equal(
        styles.inputBg,
        rgb(resolveToken(theme.modes[mode], '--suzy-surface-raised')),
      )
      assert.equal(
        styles.height,
        { compact: '32px', comfortable: '40px', spacious: '48px' }[density],
      )
      assert.equal(styles.radius, '4px')
      assert.equal(styles.box, 'border-box')
      assert.ok(styles.checkHeight < 24, 'checkbox retains native dimensions')
    }
    assert.equal(await page.locator('#hidden').isVisible(), false)
    assert.equal(await page.locator('#hidden-button').isVisible(), false)
    assert.equal(await page.locator('dialog').isVisible(), false)
    assert.equal(await page.locator('#disabled').isDisabled(), true)
    await page.locator('#check').check()
    assert.equal(await page.locator('#check').isChecked(), true)
    await page.locator('summary').click()
    assert.equal(await page.locator('details').getAttribute('open'), '')
    await page.keyboard.press('Tab')
    await page.locator('#action').focus()
    assert.equal(
      await page
        .locator('#action')
        .evaluate((el) => getComputedStyle(el).outlineStyle),
      'solid',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(
      await page
        .locator('#action')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
    )
    await page.addStyleTag({
      content: 'button { background: rgb(1, 2, 3); border-radius: 0; }',
    })
    assert.equal(
      await page
        .locator('#action')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(1, 2, 3)',
    )
  }
})

test('default and primary buttons retain their colors through interaction in both themes', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SUZY_CHROMIUM_EXECUTABLE,
  })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const theme = createTheme(resolveConfig({}))
  for (const mode of ['light', 'dark']) {
    for (const primary of [false, true]) {
      for (const type of ['button', 'submit', 'reset', null]) {
        const attributes = `id="target" class="${primary ? 'primary' : ''}"`
        await page.setContent(
          `<style>${renderCss(theme)}</style>${type ? `<input type="${type}" ${attributes} value="Action">` : `<button ${attributes}>Action</button>`}`,
        )
        await page.evaluate(
          (mode) => (document.documentElement.dataset.suzyTheme = mode),
          mode,
        )
        const target = page.locator('#target')
        const assertColor = async (token) => {
          assert.equal(
            await target.evaluate((el) => getComputedStyle(el).backgroundColor),
            rgb(resolveToken(theme.modes[mode], token)),
            `${mode} ${primary ? 'primary' : 'default'} ${type ?? 'button element'} ${token}`,
          )
        }
        await page.mouse.move(1000, 700)
        await assertColor(primary ? '--suzy-action' : '--suzy-gray-3')
        assert.equal(
          await target.evaluate((el) => getComputedStyle(el).color),
          rgb(
            resolveToken(
              theme.modes[mode],
              primary ? '--suzy-action-text' : '--suzy-text',
            ),
          ),
        )
        await target.hover()
        await assertColor(primary ? '--suzy-action-hover' : '--suzy-gray-4')
        await page.mouse.down()
        await assertColor(primary ? '--suzy-action-active' : '--suzy-gray-5')
        await page.mouse.up()
        await target.evaluate((el) => {
          el.disabled = true
        })
        await assertColor(primary ? '--suzy-action' : '--suzy-gray-3')
      }
    }
  }
})
