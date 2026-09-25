import { Cancel01Icon, File01Icon, MusicNote01Icon } from '@hugeicons/core-free-icons'
import type { Attachment } from '@/types'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives'

interface AttachmentChipProps {
  attachment: Attachment
  /** Omit to render read-only (e.g. inside a sent MessageBubble). */
  onRemove?: () => void
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Image thumbnail or file/audio chip, with an optional remove button for the composer's pending queue. */
export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  if (attachment.type === 'image') {
    return (
      <div className="group relative size-16 shrink-0 overflow-hidden rounded-field border border-line-strong bg-fill-raised">
        <img src={attachment.uri} alt={attachment.name ?? 'Attachment'} className="size-full object-cover" />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-scrim text-white opacity-0 transition-opacity hover:bg-scrim-strong group-hover:opacity-100"
            aria-label={`Remove ${attachment.name ?? 'attachment'}`}
            title="Remove"
          >
            <Icon icon={Cancel01Icon} size={11} className="text-current" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-field border border-line-strong bg-fill-raised py-1.5 pl-2.5',
        onRemove ? 'pr-1.5' : 'pr-2.5',
      )}
    >
      <Icon icon={attachment.type === 'audio' ? MusicNote01Icon : File01Icon} size={16} className="text-content-tertiary" />
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[140px] truncate text-caption font-medium text-content-primary">
          {attachment.name ?? 'File'}
        </span>
        {attachment.size != null && <span className="text-micro text-content-muted">{formatSize(attachment.size)}</span>}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-content-tertiary hover:bg-fill hover:text-content-primary"
          aria-label={`Remove ${attachment.name ?? 'attachment'}`}
          title="Remove"
        >
          <Icon icon={Cancel01Icon} size={11} className="text-current" />
        </button>
      )}
    </div>
  )
}
