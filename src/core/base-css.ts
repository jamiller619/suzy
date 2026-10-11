import { readFileSync } from 'node:fs'

// Low-specificity defaults stay easy to override within or outside Suzy's layer.
// Keep native control appearance, disclosure markers, and hidden behavior intact.
export const baseCss = readFileSync(
  new URL('./base.css', import.meta.url),
  'utf8',
)
