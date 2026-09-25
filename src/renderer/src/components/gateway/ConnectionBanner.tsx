import { AnimatePresence, motion } from 'motion/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import type { ConnectionState } from '@/types'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'

interface ConnectionBannerProps {
  state: ConnectionState
  onRetry: () => void
  className?: string
}

/** Thin banner shown only while disconnected/erroring — reconnect is automatic, this just surfaces it. */
export function ConnectionBanner({ state, onRetry, className }: ConnectionBannerProps) {
  const isError = state === 'error'
  const shown = state === 'disconnected' || state === 'error'

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cn('overflow-hidden', isError ? 'bg-error/15' : 'bg-warning/15', className)}
        >
          <div className="flex items-center justify-center gap-3 py-2.5">
            {isError ? (
              <Icon icon={Alert02Icon} size={15} className="text-white" />
            ) : (
              <Spinner size={15} className="text-white" />
            )}
            <span className="text-footnote font-medium text-content-primary">
              {isError ? 'Connection error' : 'Reconnecting…'}
            </span>
            {isError && (
              <button
                type="button"
                onClick={onRetry}
                className="cursor-pointer rounded-sm bg-fill-stronger px-2.5 py-1 text-caption font-semibold text-content-primary hover:bg-fill-strongest"
              >
                Retry
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
