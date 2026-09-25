import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The design system's token names, told to tailwind-merge.
 *
 * Without this, `cn()` silently deleted type. tailwind-merge classifies a
 * `text-*` class by looking at the value: anything it does not recognise as a
 * size it treats as a colour. Every step in this scale is a custom name, so
 * `text-body-sm` was being filed as a colour — and `cn('text-body-sm
 * text-content-secondary')` returned only the second one, dropping the font
 * size entirely.
 *
 * That is not a theoretical problem. It was live: the dropdown items rendered
 * at 15px instead of 14px, and every `cn()` call in the app that put a type
 * step and a colour in the same string had lost its size the same way. Nothing
 * failed, nothing warned — the text was simply the wrong size.
 *
 * The mirror-image bug applies to radii and tracking: `rounded-box
 * rounded-field` kept *both*, because tailwind-merge could not tell they
 * conflict, leaving the outcome to stylesheet order.
 *
 * The group names below are Tailwind v4's own theme namespaces, so this list is
 * a restatement of `global.css`. `cn.test.ts` reads that file and fails if the
 * two ever disagree.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'primary',
        'primary-dark',
        'primary-light',
        'seam-violet',
        'seam-cyan',
        'seam-emerald',
        'seam-orange',
        'seam-red',
        'cta-from',
        'cta-to',
        'bg-base',
        'bg-panel',
        'bg-surface',
        'bg-card',
        'bg-input',
        'content-primary',
        'content-secondary',
        'content-body',
        'content-tertiary',
        'content-muted',
        'content-disabled',
        'content-faint',
        'line',
        'line-hairline',
        'line-subtle',
        'line-strong',
        'fill',
        'fill-subtle',
        'fill-raised',
        'fill-strong',
        'fill-stronger',
        'fill-strongest',
        'fill-accent',
        'room-void',
        'scrim',
        'scrim-strong',
        'code-fg',
        'success',
        'success-bg',
        'success-border',
        'warning',
        'warning-bg',
        'warning-border',
        'error',
        'error-bg',
        'error-border',
        'info',
        'info-bg',
        'info-border',
        'channel-whatsapp',
        'channel-telegram',
        'channel-discord',
      ],
      text: [
        'muse-artifact-meta',
        'muse-artifact-name',
        'micro',
        'caption',
        'footnote',
        'body-sm',
        'body',
        'headline',
        'title-3',
        'title-2',
        'title-1',
        'emoji',
        'emoji-lg',
      ],
      // `field`, `box` and `selector` come from the daisyUI theme rather than
      // `@theme`, so they have to be named here or cn() cannot tell that
      // `rounded-field` and `rounded-box` conflict.
      radius: ['xs', 'sm', 'bubble', 'field', 'box', 'selector'],
      tracking: ['label', 'display', 'display-wide', 'display-wider', 'display-widest'],
      leading: ['code'],
      shadow: ['raised', 'overlay', 'popup', 'modal', 'composer'],
      container: ['form', 'content', 'wide'],
      ease: ['standard', 'entrance', 'exit', 'spring'],
      font: ['display', 'sans', 'mono'],
    },
  },
})

/** Conditional classes with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
