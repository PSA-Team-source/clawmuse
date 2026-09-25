import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

const DELAYS_MS = [0, 150, 300]

/**
 * Muse's EctoTypingIndicator: three 8px dots with no bubble or avatar,
 * bouncing on a stagger while the emphasis steps from dot to dot every 400ms
 * (secondary ink at 50% for the lit dot, 25% for the rest).
 */
export function TypingIndicator({ className }: { className?: string }) {
  const [lit, setLit] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setLit((value) => (value + 1) % 3), 400)
    return () => clearInterval(timer)
  }, [])
  return (
    <div role="status" aria-label="Thinking" className={cn('my-1 px-10 py-3 motion-safe:animate-[muse-typing-in_300ms_ease-out]', className)}>
      <div className="flex gap-1">
        {DELAYS_MS.map((delay, index) => (
          <span
            key={delay}
            className={cn('size-2 rounded-full transition-colors duration-200 motion-safe:animate-bounce', index === lit ? 'bg-content-secondary/50' : 'bg-content-secondary/25')}
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
