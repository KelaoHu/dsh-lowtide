/**
 * Icon seat across DSH shell generations.
 *
 * The browser half was written against the size-suffixed icon generation
 * (`IconChecklistOutline14`, `IconPlusOutline16`). DSH 0.2.0 renamed the whole
 * set to weight-suffixed names (`IconChecklistOutlineRegular`,
 * `IconPlusOutlineMedium`) and no longer exports the old spellings.
 *
 * A missing member arrives as `undefined`, and React renders an undefined
 * element type as error #130 ("Element type is invalid"), which the shell
 * boundary reports as `slot entry crashed in '<slot>'` and drops the ENTIRE
 * slot region. That is what made the queue dock vanish on 0.2.0 while the rest
 * of the plugin kept working — the dock's row is built from five icons.
 *
 * So resolve by probing the module namespace rather than importing fixed names:
 * prefer the 0.2.0 weight-suffixed name, fall back to the size-suffixed one an
 * older shell ships. Same defensive shape as the 0.2.3 session-API shim.
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

type IconComponent = ComponentType<Record<string, unknown>>

/** `Icon<Base><14|16|20|24>` -> `[weight-suffixed, legacy]`, most-preferred first. */
function candidates(legacy: string): readonly string[] {
  const match = /^(Icon.+(?:Outline|Fill))(14|16|20|24)$/.exec(legacy)
  if (match === null) return [legacy]
  const base = match[1]
  const legacyFirst = match[2] === '14' || match[2] === '20'
  return legacyFirst ? [`${base}Regular`, legacy, `${base}Medium`] : [`${base}Medium`, legacy, `${base}Regular`]
}

const cache = new Map<string, IconComponent | null>()

/** Resolve one icon for the shell this module actually loaded in. */
export function icon(legacy: string): IconComponent | null {
  const cached = cache.get(legacy)
  if (cached !== undefined) return cached
  let found: IconComponent | null = null
  for (const name of candidates(legacy)) {
    const member = (primitives as Record<string, unknown>)[name]
    if (typeof member === 'function' || typeof member === 'object') {
      found = member as IconComponent
      break
    }
  }
  cache.set(legacy, found)
  return found
}

/**
 * A resolved icon, or `null` when the shell ships neither spelling — so a
 * partial shell degrades to a missing glyph instead of crashing the slot.
 * Extra props (className, title, …) pass straight through.
 */
export function Icon({ name, ...rest }: { readonly name: string } & Record<string, unknown>): React.JSX.Element | null {
  const Resolved = icon(name)
  if (Resolved === null) return null
  return <Resolved {...rest} />
}
