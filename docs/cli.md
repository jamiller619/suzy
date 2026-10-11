# CLI reference

For installation and a quick start, see the [README](../README.md#installing-and-using-the-cli).

## Commands

| Command | Behavior |
| --- | --- |
| `suzy init` | Create config, schema, and CSS; refuse an existing config |
| `suzy init --accent blue --gray slate --radius pill` | Initialize with named presets |
| `suzy init --force` | Explicitly replace the existing config |
| `suzy build --config ./themes/suzy.config.json` | Validate and compile; create directories; atomically replace changed CSS |
| `suzy watch` | Build immediately, debounce config edits, handle atomic editor saves, recover from errors |
| `suzy preview --port 3000` | Serve at `http://127.0.0.1:3000`; port `0` selects a free port |
| `suzy check` | Print reference errors and every evaluated or unevaluated contrast pair |
| `suzy check --strict` | Also exit nonzero for warnings |
| `suzy --help` / `suzy --version` | Usage and package version |

All commands accept `--config`. Paths in `output` resolve **relative to the configuration file**, not the shell's working directory. Init flags also include `--name`, `--warning`, `--danger`, `--success`, `--info`, `--density`, `--appearance`, and `--output`. Flags inappropriate to a command are rejected. Commands are noninteractive.

Failed builds preserve the previous CSS. Identical CSS is not rewritten. Watch monitors the config's parent directory so replacing the file does not lose the watcher; rebuilds are serialized. Ctrl-C and SIGTERM stop watch/preview cleanly. Preview does not write output CSS. It uses the compiler's IR, updates on valid changes, and shows an error banner while retaining the last valid theme on invalid edits. A valid config is required to start preview.

## Configuration

`{}` is a complete valid configuration. See [the example](../examples/suzy.config.json) and [generated JSON Schema](../suzy.schema.json). Unknown keys, invalid presets, and unsupported versions are errors. Omitted `version` means version 1.

| Option | Default | Choices |
| --- | --- | --- |
| `name` | `suzy` | Nonempty display name |
| `colors.accent` | `violet` | Named Radix palette |
| `colors.gray` | `slate` | `gray`, `mauve`, `slate`, `sage`, `olive`, `sand` |
| `colors.warning` / `danger` / `success` / `info` | `amber` / `red` / `green` / `blue` | Named Radix palette |
| `font.family.body` | Browser default | CSS font-family value |
| `font.family.mono` | Browser default | CSS font-family value |
| `radius` | `rounded` | `none`, `subtle`, `rounded`, `pill` |
| `density` | `comfortable` | `compact`, `comfortable`, `spacious` |
| `appearance` | `both` | `light`, `dark`, `both` |
| `output` | `./src/styles/theme.css` | Output path |
| `overrides` | Empty | `shared`, `light`, `dark` token maps |

Named palettes: gray, mauve, slate, sage, olive, sand, tomato, red, ruby, crimson, pink, plum, purple, violet, iris, indigo, blue, cyan, teal, jade, green, grass, brown, bronze, gold, sky, mint, lime, yellow, amber, orange. Arbitrary hex colors are **not palette inputs** in V1; individual token overrides can contain hex values. P3 scales are not emitted.

No font families are defined by default. Fonts are never downloaded. A configured font must already be installed or provided by your application. Sizes, weights, and line heights are built in.

### Presets

| Density | Control height | Horizontal padding | Control gap | Panel padding | Section gap |
| --- | --- | --- | --- | --- | --- |
| compact | 2rem | .5rem | .25rem | .75rem | 1.5rem |
| comfortable | 2.5rem | .75rem | .5rem | 1.5rem | 2rem |
| spacious | 3rem | 1rem | .75rem | 2rem | 3rem |

Density changes layout dimensions, never the typography scale. Radius presets set four primitive radii: `none` = all zero; `subtle` = .125/.25/.375/.5rem; `rounded` and `pill` = .25/.5/.75/1rem. Controls use step 2, panels step 3, dialogs step 4. `pill` uses `9999px` only for controls.

### Overrides and precedence

Use full custom-property names. Additional `--suzy-*` tokens are allowed. Values must be nonempty strings containing one CSS value; declaration delimiters, markup, escapes, comments, and URLs are rejected. Do not use overrides to load assets.

```json
{
  "version": 1,
  "overrides": {
    "shared": {
      "--suzy-panel-padding": "var(--suzy-space-6)",
      "--suzy-brand-gap": "1.25rem"
    },
    "light": { "--suzy-bg": "#ffffff" },
    "dark": { "--suzy-bg": "#101014" }
  }
}
```

Precedence: **built-in primitives and semantics → shared overrides → current-mode overrides**. Action foreground is then chosen from black or white to maximize the lowest contrast across the resolved action default/hover/active backgrounds, unless `--suzy-action-text` was explicitly overridden. Unsupported action background expressions use black as a fallback and are reported as unevaluated by `check`; review or explicitly set the foreground. Overriding an alias replaces that alias; overriding a primitive affects aliases that still reference it. Nonemitted modes are not checked. Reduced-motion preferences force all `--suzy-duration-*` tokens to zero, even when overridden.

Overrides are CSS values, not a full CSS type checker. The compiler verifies token dependencies; the browser determines whether a value is valid for a consuming CSS property. Missing references (including references in fallbacks and references outside Suzy) and cycles are errors. Complex expressions may be emitted but are not necessarily evaluable by contrast diagnostics.

## Theme switching

With `appearance: "both"`, the default is light, following OS dark preference only when the root has no explicit light/dark theme. Set the attribute on `<html>` to override the OS:

```html
<html data-suzy-theme="light">
```

Remove the attribute to return to OS preference. Nested scopes can alternate arbitrarily:

```html
<section data-suzy-theme="dark">
  <article data-suzy-theme="light">
    <aside data-suzy-theme="dark">Local dark theme</aside>
  </article>
</section>
```

Every theme boundary redeclares the full token set, including semantic aliases. Aliases therefore resolve against the local palette instead of inheriting values computed on an ancestor. Shared and mode overrides also appear at each boundary. If you manually override a primitive on a different element without a theme attribute, redeclare dependent aliases there if necessary.

Single-mode builds emit only that mode. Both recognized theme attributes act as boundaries for the selected mode; they cannot request a mode absent from the stylesheet. The CSS requires modern browsers supporting cascade layers and custom properties.

## Diagnostics

`check` reports each pair in each emitted mode against **4.5:1 for normal text**, with the numeric ratio and PASS/FAIL. Missing/circular references are errors. Low contrast and unevaluated expressions are warnings; `--strict` fails on warnings. See [the token reference](tokens.md#contrast-pairs) for the full pair list.

The color evaluator supports opaque 3/6-digit hex, numeric `rgb()`, and black/white, including simple `var(--suzy-name)` chains. Alpha, other named colors, `color-mix()`, relative colors, external variables, and fallback expressions are explicitly unevaluated. It does not guess their contrast.

Some default Radix combinations, including subtle text and certain action hover/status backgrounds, fall below 4.5:1. These are reported honestly; selecting a black/white action foreground cannot always satisfy every state simultaneously. Use the report to adjust tokens for your application's text size and context. Token checks **do not guarantee an application's accessibility**, and do not evaluate focus visibility, non-text contrast, layout, keyboard behavior, or arbitrary component combinations.

