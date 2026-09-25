import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/cn'

/**
 * `cn()` has to know every design token by name, or it deletes classes.
 *
 * tailwind-merge decides which classes conflict by parsing their values. A
 * custom `text-*` step it does not recognise gets filed as a colour, so a size
 * and a colour in the same call look like the same property and the size loses.
 * That bug shipped: dropdown items rendered at the inherited 15px instead of
 * the 14px they asked for, with nothing to show for it in a build log.
 *
 * These tests exist so the failure is loud. The first group checks behaviour;
 * the second checks that the token list in `cn.ts` still matches `global.css`,
 * because a token added to the stylesheet and not to `cn.ts` reintroduces the
 * exact same silent deletion.
 */

// Read from the project root rather than `import.meta.url`: the suite runs in
// jsdom, where `import.meta.url` is an http URL and not a path at all.
const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/src/global.css'), 'utf8')

/** Every `--<prefix>-<name>` declared in the stylesheet, minus Tailwind's `--x--modifier` forms. */
function tokensFor(prefix: string): string[] {
  const found = [...CSS.matchAll(new RegExp(`^\\s*--${prefix}-([a-z0-9-]+)\\s*:`, 'gm'))]
    .map((m) => m[1]!)
    .filter((name) => !name.includes('--'))
  return [...new Set(found)].sort()
}

/** What `cn()` still recognises, probed through its actual merge behaviour. */
function isKnown(className: string, conflicting: string): boolean {
  return cn(className, conflicting) === conflicting
}

describe('cn keeps a type step and a colour apart', () => {
  it('does not drop the font size when a colour follows it', () => {
    expect(cn('text-body-sm', 'text-content-secondary')).toBe(
      'text-body-sm text-content-secondary',
    )
    expect(cn('text-caption font-semibold uppercase tracking-label text-content-muted')).toContain(
      'text-caption',
    )
    expect(cn('truncate text-title-3 font-bold text-content-primary')).toContain('text-title-3')
  })

  it('still resolves a genuine conflict, keeping the last one', () => {
    expect(cn('text-body', 'text-headline')).toBe('text-headline')
    expect(cn('text-content-muted', 'text-error')).toBe('text-error')
    expect(cn('rounded-box', 'rounded-field')).toBe('rounded-field')
    expect(cn('tracking-label', 'tracking-display')).toBe('tracking-display')
    expect(cn('shadow-raised', 'shadow-modal')).toBe('shadow-modal')
    expect(cn('max-w-form', 'max-w-content')).toBe('max-w-content')
  })

  it('leaves unrelated utilities alone', () => {
    expect(cn('text-body', 'font-semibold', 'text-error')).toBe(
      'text-body font-semibold text-error',
    )
  })
})

describe('cn knows every token in global.css', () => {
  const CASES: { group: string; prefix: string; conflictWith: (name: string) => [string, string] }[] =
    [
      { group: 'font size', prefix: 'text', conflictWith: (n) => [`text-${n}`, 'text-body'] },
      { group: 'radius', prefix: 'radius', conflictWith: (n) => [`rounded-${n}`, 'rounded-full'] },
      {
        group: 'tracking',
        prefix: 'tracking',
        conflictWith: (n) => [`tracking-${n}`, 'tracking-label'],
      },
      { group: 'shadow', prefix: 'shadow', conflictWith: (n) => [`shadow-${n}`, 'shadow-modal'] },
      {
        group: 'container',
        prefix: 'container',
        conflictWith: (n) => [`max-w-${n}`, 'max-w-content'],
      },
    ]

  for (const { group, prefix, conflictWith } of CASES) {
    it(`recognises every ${group} token`, () => {
      const unknown = tokensFor(prefix).filter((name) => {
        const [a, b] = conflictWith(name)
        // A token cn() does not know will not be recognised as conflicting with
        // another from the same group, so both survive the merge.
        return a !== b && !isKnown(a, b)
      })
      expect(
        unknown,
        `${unknown.join(', ')} declared in global.css but missing from the theme list in lib/cn.ts — ` +
          `cn() will silently drop these`,
      ).toEqual([])
    })
  }

  it('recognises every colour token', () => {
    const unknown = tokensFor('color').filter(
      (name) => name !== 'error' && !isKnown(`text-${name}`, 'text-error'),
    )
    expect(
      unknown,
      `${unknown.join(', ')} declared in global.css but missing from lib/cn.ts`,
    ).toEqual([])
  })
})
