import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'

/**
 * A class naming a token that does not exist paints nothing, silently.
 *
 * This is the one failure mode neither TypeScript nor ESLint nor the runtime
 * can see. `border-border-subtle` is a perfectly well-formed class name, and
 * Tailwind simply declines to emit a rule for it — no warning, no error, the
 * border is just absent.
 *
 * It had happened three times, and the worst of them mattered. The Security
 * screen's sandbox picker marked the selected card with
 * `border-accent bg-accent-bg`; neither token exists, so the *only* mode you
 * could see was selected was `full` — the dangerous one, whose red came from
 * tokens that do. Onboarding's provider picker had the same pair, so a new user
 * could not tell which provider they had chosen. The command palette's border
 * had never rendered at all.
 *
 * Rather than reimplement Tailwind's opinion of what is valid, this asks
 * Tailwind: compile every class the source actually uses, and report any that
 * produced no CSS.
 */

const ROOT = process.cwd()
const TW = resolve(ROOT, 'node_modules/tailwindcss/')

/**
 * Class tokens from `className` attributes and `cn()` calls only.
 *
 * Scanning every string in the file would flag English prose — an earlier
 * version reported `text-to-speech` from the label "Text-to-speech", which is
 * exactly the kind of noise that gets a check switched off.
 */
/**
 * The text of every `className=` value and every `cn(…)` call.
 *
 * Written as a brace scanner rather than a regex because the interesting cases
 * are exactly the ones a regex loses: a template literal with a ternary inside
 * it. The first version of this used a regex, skipped
 * `` className={`… ${cond ? 'border-accent' : …}`} `` for containing a `$`,
 * and reported the Security screen as clean while the bug was still in it.
 */
function classRegions(source: string): string[] {
  const regions: string[] = []
  const starts = [...source.matchAll(/\bclassName\s*=\s*|(?<![\w.])cn\(/g)]

  for (const start of starts) {
    let i = start.index! + start[0].length
    while (i < source.length && /\s/.test(source[i]!)) i++

    // A plain string value needs no scanning.
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i]!
      const end = source.indexOf(quote, i + 1)
      if (end !== -1) regions.push(source.slice(i + 1, end))
      continue
    }

    // Otherwise walk to the matching close, tracking nesting and strings so a
    // brace inside a template literal does not end the region early.
    const open = source[i] === '{' ? '{' : '('
    const close = open === '{' ? '}' : ')'
    let depth = 0
    let quote: string | null = null
    const from = i
    for (; i < source.length; i++) {
      const ch = source[i]!
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === open || ch === '(' || ch === '{') depth++
      else if (ch === close || ch === ')' || ch === '}') {
        depth--
        if (depth === 0) break
      }
    }
    regions.push(source.slice(from, i + 1))
  }
  return regions
}

function usedClasses(): Map<string, string[]> {
  const files = execFileSync('find', ['src/renderer/src', '-name', '*.tsx'], {
    encoding: 'utf8',
    cwd: ROOT,
  })
    .trim()
    .split('\n')

  const found = new Map<string, string[]>()
  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), 'utf8')
    for (const region of classRegions(source)) {
      // Anything quoted inside a class region is a class list, including the
      // branches of a ternary and the chunks of a template literal.
      for (const literal of region.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        const text = literal[1] ?? literal[2] ?? literal[3] ?? ''
        for (const raw of text.split(/\s+/)) {
          // A template literal is captured whole, ternary and all, so tokens
          // arrive wearing the quotes and punctuation of the expression around
          // them. Strip that before asking whether the class exists.
          const token = raw.replace(/^[`'",?:]+|[`'",?:]+$/g, '').trim()
          // Template holes leave fragments; a utility never contains these.
          if (!token || !/[-:[]/.test(token) || /[<>(){}=$]/.test(token)) continue
          if (!found.has(token)) found.set(token, [])
          found.get(token)!.push(file.replace('src/renderer/src/', ''))
        }
      }
    }
  }
  return found
}

/** A class name as it appears in a selector, with the characters CSS needs escaped. */
const asSelector = (cls: string) => '.' + cls.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c)

describe('every class the app uses compiles to something', () => {
  it('finds no utility that Tailwind emits no rule for', async () => {
    const used = usedClasses()
    const candidates = [...used.keys()]

    const compiler = await compile(
      readFileSync(resolve(ROOT, 'src/renderer/src/global.css'), 'utf8'),
      {
        base: resolve(ROOT, 'src/renderer/src'),
        loadStylesheet: async (id: string) => {
          const path = resolve(TW, id.replace('tailwindcss', 'index.css'))
          return { path, base: TW, content: readFileSync(path, 'utf8') }
        },
        /**
         * `global.css` loads daisyUI through `@plugin`, so the compiler needs a
         * way to import it. Without this the whole check throws rather than
         * failing a class, which would look like a broken test rather than a
         * missing plugin. `daisyui/theme` is a directory, so Node needs the
         * explicit entry point.
         */
        loadModule: async (id: string) => {
          const specifier = id === 'daisyui/theme' ? 'daisyui/theme/index.js' : id
          const mod = await import(specifier)
          return { path: id, base: ROOT, module: mod.default ?? mod }
        },
      },
    )

    // Compile everything at once, then ask whether each class earned a selector.
    // Measuring the *size* of the output instead would prove nothing: `build()`
    // returns the whole stylesheet and accumulates across calls, so a dead class
    // and a live one produce identical lengths.
    const css = compiler.build(candidates)
    const dead = candidates.filter((cls) => !css.includes(asSelector(cls)))

    const report = dead.map(
      (cls) => `${cls}  →  ${[...new Set(used.get(cls))].slice(0, 3).join(', ')}`,
    )
    expect(
      report,
      `these classes compile to nothing and therefore have no effect:\n  ${report.join('\n  ')}`,
    ).toEqual([])
  }, 60_000)
})
