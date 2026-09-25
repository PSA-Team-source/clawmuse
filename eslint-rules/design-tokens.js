/**
 * Stops the design system drifting back.
 *
 * Every value this rule bans was found in the codebase, and each one had a
 * token that already meant the same thing. Thirteen ad-hoc font sizes against
 * an eleven-step scale. Four ways to write a 6px gap. A settings column that
 * was 640px on three screens and 560px on four, so it visibly changed width as
 * you navigated. Two overlays dimming the app by different amounts.
 *
 * None of that was carelessness — it is what happens when the cheap thing to
 * type is the wrong thing. `text-[13px]` is quicker than remembering that the
 * step is called `footnote`. This rule makes the cheap thing the right thing by
 * making the wrong thing fail the build.
 *
 * It deliberately does NOT police layout sizing — `w-[228px]` for a sidebar or
 * `max-w-[140px]` for a truncating label are one-off measurements, not design
 * decisions, and inventing tokens for them would be ceremony. The line is:
 * if the design system has an opinion about it, it is banned here.
 *
 * Matching is done against string literals anywhere in the file rather than
 * only inside `className`, because the class strings that drift the most live
 * in lookup tables next to the component, not in its JSX.
 */

/** @type {{ pattern: RegExp, message: string }[]} */
const BANNED = [
  {
    pattern:
      /\b(?:bg|text|border|from|via|to|ring|fill|stroke|shadow|decoration|outline|divide|accent|caret)-\[#[0-9a-fA-F]{3,8}\]/,
    message:
      'Hardcoded hex colour. Use a token from global.css — the colour you want almost certainly already has a name.',
  },
  {
    pattern: /\btext-\[[\d.]+(?:px|rem|em)\]/,
    message:
      'Ad-hoc font size. Use the type scale: text-micro/caption/footnote/body-sm/body/callout/subhead/headline/title-3/title-2/title-1, or text-emoji for an emoji standing in for an icon.',
  },
  {
    pattern: /\bleading-\[[^\]]+\]/,
    message:
      'Ad-hoc line height. Every type step already carries one, so this is usually redundant — delete it. For monospace blocks use leading-code.',
  },
  {
    pattern: /\btracking-\[[^\]]+\]/,
    message:
      'Ad-hoc letter spacing. Use tracking-label for uppercase eyebrows, or tracking-display/-wide/-wider/-widest for the 3D room chrome.',
  },
  {
    pattern: /\brounded(?:-[trbl]{1,2})?-\[[^\]]+\]/,
    message:
      'Ad-hoc corner radius. Use rounded-sm/field/button/card/card-lg/pill — or rounded-full when the corner is meant to be half the height.',
  },
  {
    pattern:
      /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|size)-\[[\d.]+(?:px|rem)\]/,
    message:
      'Off-grid spacing. The grid is 4px: use the numeric scale (gap-1.5 is 6px, py-0.5 is 2px). If a control needs a specific height, state it — h-6, h-8 — rather than arriving at it through padding.',
  },
  {
    pattern: /\b(?:bg|text|border|from|via|to|ring|fill|stroke|divide|outline)-(?:white|black)\/\[[\d.]+\]/,
    message:
      'Ad-hoc opacity on white or black. The ramps have names: content-primary…faint for text, fill…fill-strongest for surfaces, line…line-strong for borders, scrim for overlays.',
  },
  {
    pattern: /\bshadow-\[[^\]]+\]/,
    message:
      'Ad-hoc shadow. Use the elevation scale: shadow-raised, shadow-overlay, shadow-popup, shadow-modal.',
  },
  {
    pattern: /\bduration-\[[^\]]+\]/,
    message:
      'Ad-hoc duration. Use duration-(--duration-instant/fast/normal/slow) so motion stays in step with design/tokens.ts.',
  },
]

/** @type {import('eslint').Rule.RuleModule} */
const noAdHocValues = {
  meta: {
    type: 'problem',
    docs: { description: 'Require design tokens instead of ad-hoc Tailwind arbitrary values' },
    schema: [],
    messages: { adHoc: '{{message}}\n  found: {{found}}' },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} text */
    function check(node, text) {
      if (!text || !text.includes('[')) return
      // Every violation in the string, not just the first: a class list that
      // drifted once has usually drifted three times, and reporting them one
      // run at a time turns a single fix into three round trips.
      for (const { pattern, message } of BANNED) {
        for (const match of text.matchAll(new RegExp(pattern, 'g'))) {
          context.report({ node, messageId: 'adHoc', data: { message, found: match[0] } })
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.raw)
      },
    }
  },
}

export default { rules: { 'no-ad-hoc-values': noAdHocValues } }
