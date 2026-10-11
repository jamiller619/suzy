# suzy

**Cascade FTW.** Turn a small configuration into design tokens and a complete CSS theme. Generated styles run on their own, with no JavaScript or runtime dependency on Suzy.

## Installing and using the CLI

### Install

Requires Node.js 22+. Suzy is currently distributed as a local package; see [Packaging](#packaging) to create the tarball from this repository.

In the project where you want to use Suzy:

```sh
yarn add --dev file:/tmp/suzy-0.1.0.tgz
yarn suzy init
yarn suzy preview
```

`init` creates `suzy.config.json`, an editor schema, and `src/styles/theme.css`. Preview serves a local theme specimen at `http://127.0.0.1:3000` that updates as you edit the config.

### Use

Import the generated stylesheet into your application's CSS entry point, or serve it and add a stylesheet link:

```html
<link rel="stylesheet" href="/styles/theme.css">
<button class="primary">Get started</button>
<label>Your name <input autocomplete="name" placeholder="Alex"></label>
```

Suzy includes design tokens, a lightweight reset, and native HTML styles inside `@layer suzy`. Buttons use gray by default; `class="primary"` applies the accent color. Unlayered application CSS takes precedence over Suzy's defaults.

| Command | Purpose |
| --- | --- |
| `yarn suzy init --accent blue --radius pill` | Create a theme with named presets |
| `yarn suzy build` | Generate CSS from the config |
| `yarn suzy watch` | Rebuild CSS when the config changes |
| `yarn suzy preview --port 3001` | Preview the theme on a custom port |
| `yarn suzy check` | Check token references and text contrast |
| `yarn suzy check --strict` | Fail on warnings as well as errors |
| `yarn suzy --help` | Show commands and options |

All commands accept `--config <path>`. Output paths are relative to the config file. Preview does not write CSS; use `build` or `watch` to update your application's stylesheet.

### Configure

`init` writes only accent and gray colors, plus any options you explicitly pass. Omitted settings use compiler defaults; even an empty `{}` is valid. For example:

```json
{
  "colors": { "accent": "blue", "gray": "slate" }
}
```

Font families are omitted by default so the browser uses the user’s preferred fonts. Set `font.family.body` or `font.family.mono` only to override them.

With `appearance: "both"`, the theme follows the OS preference. Set `data-suzy-theme="light"` or `data-suzy-theme="dark"` on `<html>` or a nested element to choose explicitly.

See the [CLI and configuration reference](docs/cli.md) for options, presets, overrides, and diagnostics, or the [token reference](docs/tokens.md) to use tokens in your own CSS. Contrast checks cover token pairs, not your application's overall accessibility.

## Working in this repo

### Setup and development

Use the Node version in `.nvmrc` and Yarn Classic 1.22.

```sh
nvm use
yarn install --frozen-lockfile
yarn dev
```

`yarn dev` builds the package, watches TypeScript, and starts the preview on port 3000. Use `yarn dev --port 3001` to change the port.

To run the built CLI directly or link it onto your PATH:

```sh
yarn build
node dist/cli/main.js --help
yarn link
suzy --help
```

### Verification

```sh
yarn typecheck
yarn check                  # Biome checks
yarn test                   # Core and CLI tests
yarn playwright install chromium
yarn test:browser           # Browser styles and preview tests
yarn test:package           # Install and run a packed copy outside this repo
```

Browser tests save screenshots to ignored `test-results/`. Set `SUZY_CHROMIUM_EXECUTABLE` to use an installed compatible Chromium. The package smoke test requires registry access or a populated Yarn cache.

### Packaging

```sh
yarn pack --filename /tmp/suzy-0.1.0.tgz
```

Packing runs the build automatically. The build also regenerates the schema and executable permissions. Commit `yarn.lock` and `suzy.schema.json` when changing dependencies or the schema.

### Compiler API

The CLI, preview, and diagnostics share a pure TypeScript compiler with no filesystem or process access:

```ts
import { resolveConfig, createTheme, validateTheme, renderCss } from 'suzy';

const config = resolveConfig({ colors: { accent: 'blue' } });
const theme = createTheme(config);
const diagnostics = validateTheme(theme);
const css = renderCss(theme);
```

The package includes type declarations and exports its schema as `suzy/schema` and `configSchema`.
