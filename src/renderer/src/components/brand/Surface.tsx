import type { ReactNode } from 'react'
import { materialClass, type Material } from '@/design/materials'
import { cn } from '@/lib/cn'

interface SurfaceProps {
  /** How far this floats above what is behind it, not what it is called on screen. */
  material?: Material
  className?: string
  children: ReactNode
}

/** A material surface — the desktop equivalent of mobile's Liquid Glass / BlurView switcher. */
export function Surface({ material = 'regular', className, children }: SurfaceProps) {
  return <div className={cn(materialClass(material), className)}>{children}</div>
}
