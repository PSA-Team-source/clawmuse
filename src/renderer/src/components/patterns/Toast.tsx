import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  Alert02Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import { springs } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  show: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// Border colour is applied via inline `style`, not a `border-*` utility class —
// Tailwind utilities and the hand-written `.material-thick` rule both live in the
// `utilities` cascade layer, so their relative precedence isn't guaranteed by
// class order alone. Inline style always wins deterministically.
const VARIANT: Record<ToastVariant, { icon: unknown; borderColor: string; textClass: string }> = {
  success: { icon: CheckmarkCircle02Icon, borderColor: 'var(--color-success-border)', textClass: 'text-success' },
  error: { icon: CancelCircleIcon, borderColor: 'var(--color-error-border)', textClass: 'text-error' },
  warning: { icon: Alert02Icon, borderColor: 'var(--color-warning-border)', textClass: 'text-warning' },
  info: { icon: InformationCircleIcon, borderColor: 'var(--color-info-border)', textClass: 'text-info' },
}

const AUTO_DISMISS_MS = 4000

/** Mount once at the app root. Renders a fixed bottom-right toast stack above everything else. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { ...toast, id }])
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[340px] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => {
            const cfg = VARIANT[toast.variant ?? 'info']
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24 }}
                transition={springs.snappy}
                style={{ borderColor: cfg.borderColor }}
                className="material-thick pointer-events-auto flex items-start gap-2.5 rounded-box border px-4 py-3"
              >
                <Icon icon={cfg.icon} size={17} className={cn('mt-0.5 shrink-0', cfg.textClass)} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold leading-5 text-content-primary">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-caption leading-4 text-content-tertiary">{toast.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 cursor-pointer text-content-disabled hover:text-content-secondary"
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
