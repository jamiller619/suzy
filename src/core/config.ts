export const palettes = [
  'gray',
  'mauve',
  'slate',
  'sage',
  'olive',
  'sand',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'brown',
  'bronze',
  'gold',
  'sky',
  'mint',
  'lime',
  'yellow',
  'amber',
  'orange',
] as const
export const neutrals = [
  'gray',
  'mauve',
  'slate',
  'sage',
  'olive',
  'sand',
] as const
export type Palette = (typeof palettes)[number]
export type Mode = 'light' | 'dark'
export type Tokens = Record<string, string>
export interface ConfigInput {
  $schema?: string
  version?: 1
  name?: string
  colors?: Partial<
    Record<'accent' | 'warning' | 'danger' | 'success' | 'info', Palette>
  > & { gray?: (typeof neutrals)[number] }
  font?: { family?: { body?: string; mono?: string } }
  radius?: 'none' | 'subtle' | 'rounded' | 'pill'
  density?: 'compact' | 'comfortable' | 'spacious'
  appearance?: Mode | 'both'
  output?: string
  overrides?: Partial<Record<'shared' | Mode, Tokens>>
}
export interface Config {
  version: 1
  name: string
  colors: Required<NonNullable<ConfigInput['colors']>>
  font: { family: { body?: string; mono?: string } }
  radius: NonNullable<ConfigInput['radius']>
  density: NonNullable<ConfigInput['density']>
  appearance: NonNullable<ConfigInput['appearance']>
  output: string
  overrides: Record<'shared' | Mode, Tokens>
}
interface Schema {
  type?: 'object' | 'string' | 'integer'
  properties?: Record<string, Schema>
  additionalProperties?: boolean | Schema
  propertyNames?: { pattern: string }
  enum?: readonly (string | number)[]
  minLength?: number
  pattern?: string
  description?: string
}
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
})
const string: Schema = { type: 'string', minLength: 1, pattern: '\\S' }
// Values cannot terminate declarations, inject markup/comments, or load remote assets.
const cssValue: Schema = {
  ...string,
  pattern:
    '^(?!.*(?:/\\*|\\*/|[uU][rR][lL]\\s*\\(|@[iI][mM][pP][oO][rR][tT]))(?=.*\\S)[^;{}<>\\\\\\u0000-\\u001f]+$',
  description:
    'One CSS value. No declaration delimiters, markup, escapes, comments, or URLs.',
}
const choice = (values: readonly string[]): Schema => ({
  type: 'string',
  enum: values,
})
const overrides: Schema = {
  type: 'object',
  propertyNames: { pattern: '^--suzy-[a-z][a-z0-9-]*$' },
  additionalProperties: cssValue,
}
export const configSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Suzy configuration v1',
  ...object({
    $schema: string,
    version: { type: 'integer', enum: [1] },
    name: string,
    colors: object(
      Object.fromEntries(
        ['accent', 'gray', 'warning', 'danger', 'success', 'info'].map(
          (key) => [key, choice(key === 'gray' ? neutrals : palettes)],
        ),
      ),
    ),
    font: object({ family: object({ body: cssValue, mono: cssValue }) }),
    radius: choice(['none', 'subtle', 'rounded', 'pill']),
    density: choice(['compact', 'comfortable', 'spacious']),
    appearance: choice(['light', 'dark', 'both']),
    output: string,
    overrides: object({ shared: overrides, light: overrides, dark: overrides }),
  }),
}
function validate(value: unknown, schema: Schema, path: string): void {
  const fail = (reason: string): never => {
    throw new Error(`${path}: ${reason}`)
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('expected an object')
    }
    for (const [key, child] of Object.entries(value as object)) {
      if (
        schema.propertyNames &&
        !new RegExp(schema.propertyNames.pattern).test(key)
      ) {
        fail(`invalid token name "${key}"; use --suzy-name`)
      }
      const property = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties?.[key]
        : undefined
      if (property) {
        validate(child, property, `${path}.${key}`)
      } else if (typeof schema.additionalProperties === 'object') {
        validate(child, schema.additionalProperties, `${path}.${key}`)
      } else {
        fail(`unknown key "${key}"`)
      }
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim()) {
      fail('expected a nonempty string')
    }
    const text = value as string
    if (schema.pattern && !new RegExp(schema.pattern).test(text)) {
      fail(
        'expected a single safe CSS value; delimiters, comments, escapes and URLs are not supported',
      )
    }
  } else if (schema.type === 'integer' && !Number.isInteger(value)) {
    fail('expected an integer')
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    fail(
      `${path.startsWith('config.colors') ? 'V1 supports named Radix palettes, not arbitrary hex colors. ' : ''}Choose ${schema.enum.join(', ')}`,
    )
  }
}
export function resolveConfig(input: unknown = {}): Config {
  validate(input, configSchema, 'config')
  const c = input as ConfigInput
  return {
    version: 1,
    name: c.name ?? 'suzy',
    colors: {
      accent: 'violet',
      gray: 'slate',
      warning: 'amber',
      danger: 'red',
      success: 'green',
      info: 'blue',
      ...c.colors,
    },
    font: {
      family: {
        ...c.font?.family,
      },
    },
    radius: c.radius ?? 'rounded',
    density: c.density ?? 'comfortable',
    appearance: c.appearance ?? 'both',
    output: c.output ?? './src/styles/theme.css',
    overrides: {
      shared: { ...c.overrides?.shared },
      light: { ...c.overrides?.light },
      dark: { ...c.overrides?.dark },
    },
  }
}
