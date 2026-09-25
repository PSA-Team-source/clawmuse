import { CircleIcon, CheckmarkCircle02Icon, CancelCircleIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'
import { Spinner } from '@/components/brand/Spinner'

export type StepStatus = 'pending' | 'loading' | 'done' | 'error'

interface Step {
  label: string
  status: StepStatus
}

interface ProgressStepsProps {
  steps: Step[]
  className?: string
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'pending':
      return <Icon icon={CircleIcon} size={16} className="text-content-disabled" />
    case 'loading':
      return <Spinner size={16} />
    case 'done':
      return <Icon icon={CheckmarkCircle02Icon} size={16} className="text-success" strokeWidth={2} />
    case 'error':
      return <Icon icon={CancelCircleIcon} size={16} className="text-error" strokeWidth={2} />
  }
}

/** Vertical checklist for multi-step flows (onboarding, sandbox boot, store builds). */
export function ProgressSteps({ steps, className }: ProgressStepsProps) {
  return (
    <div className={cn('overflow-hidden rounded-box border border-line bg-fill-subtle', className)}>
      {steps.map((step, i) => (
        <div
          key={`${step.label}-${i}`}
          className={cn(
            'flex items-center gap-3 p-4',
            i < steps.length - 1 && 'border-b border-line-hairline',
          )}
        >
          <div className="flex w-6 items-center justify-center">
            <StepIcon status={step.status} />
          </div>
          <span
            className={cn(
              'text-body-sm font-medium',
              step.status === 'pending' ? 'text-content-muted' : 'text-content-primary',
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}
