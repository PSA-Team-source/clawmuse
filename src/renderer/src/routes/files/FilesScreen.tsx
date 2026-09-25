import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert02Icon,
  File01Icon,
  FolderOpenIcon,
  Folder01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton, Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, useToast } from '@/components/patterns'
import { Select } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/utils/format'
import type { FsEntry, FsReadResult, FsRoot } from '@shared/ipc'

/**
 * Browse and edit the files the agent works in.
 *
 * Paths shown here are always relative to the selected root — the renderer
 * never learns or sends an absolute path, which is what keeps the main-process
 * guard meaningful (see `fs-bridge.ts`).
 */
/** Stable empty snapshot — a fresh `[]` per render would defeat memoisation. */
const EMPTY_ENTRIES: FsEntry[] = []

export default function FilesScreen() {
  const toast = useToast()
  const [roots, setRoots] = useState<FsRoot[] | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [dir, setDir] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<FsReadResult | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.clawmuse.fs.roots().then((found) => {
      setRoots(found)
      setRootId((current) => current ?? found[0]?.id ?? null)
    })
  }, [])

  // The directory listing is external state that can change under us (the agent
  // writes files while the user is looking at them), so it belongs in Query
  // rather than in an effect that pushes into useState.
  const listing = useQuery({
    queryKey: ['fs', rootId, dir],
    queryFn: () => window.clawmuse.fs.list(rootId!, dir),
    enabled: Boolean(rootId),
    staleTime: 2_000,
  })

  const entries: FsEntry[] = listing.data ?? EMPTY_ENTRIES
  const loading = listing.isPending
  const error = listing.error instanceof Error ? listing.error.message : null

  const refresh = useCallback(() => {
    void listing.refetch()
  }, [listing])

  async function openEntry(entry: FsEntry): Promise<void> {
    if (entry.isDirectory) {
      setDir(entry.path)
      setSelected(null)
      setFile(null)
      return
    }
    if (!rootId) return
    setSelected(entry.path)
    try {
      const result = await window.clawmuse.fs.read(rootId, entry.path)
      setFile(result)
      setDraft(result.content)
    } catch (cause) {
      toast.show({
        title: 'Could not open file',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'error',
      })
    }
  }

  async function save(): Promise<void> {
    if (!rootId || !selected || saving) return
    setSaving(true)
    try {
      await window.clawmuse.fs.write(rootId, selected, draft)
      setFile((current) => (current ? { ...current, content: draft } : current))
      toast.show({ title: 'Saved' })
    } catch (cause) {
      toast.show({
        title: 'Could not save',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function addRoot(): Promise<void> {
    const added = await window.clawmuse.fs.addRoot()
    if (!added) return
    setRoots((current) => [...(current ?? []).filter((r) => r.id !== added.id), added])
    setRootId(added.id)
    setDir('')
  }

  const segments = dir ? dir.split('/').filter(Boolean) : []
  const dirty = file != null && draft !== file.content

  if (roots === null) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-base">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg-base">
      <div className="drag flex h-11 shrink-0 items-center justify-between gap-3 px-5">
        <div className="no-drag flex min-w-0 items-center gap-2">
          <Select
            size="compact"
            value={rootId ?? ''}
            onValueChange={(next) => {
              setRootId(next)
              setDir('')
              setSelected(null)
              setFile(null)
            }}
            items={roots.map((root) => ({ value: root.id, label: root.label }))}
            aria-label="Workspace root"
            className="min-w-40"
          />
          <GhostButton size="sm" onClick={() => void addRoot()}>
            <span className="flex items-center gap-1.5">
              <Icon icon={FolderOpenIcon} size={14} />
              Open folder
            </span>
          </GhostButton>
        </div>
        <GhostButton size="sm" onClick={() => void refresh()} aria-label="Refresh file list">
          <Icon icon={RefreshIcon} size={14} />
        </GhostButton>
      </div>

      {/* Breadcrumb — each crumb navigates by rebuilding the relative path. */}
      <div className="no-drag flex shrink-0 items-center gap-1 px-5 pb-2 text-caption text-content-tertiary">
        <button type="button" onClick={() => setDir('')} className="-my-1 cursor-pointer rounded-xs px-1 py-1 hover:bg-fill-raised hover:text-content-primary">
          root
        </button>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} className="flex items-center gap-1">
            <span className="text-content-faint">/</span>
            <button
              type="button"
              onClick={() => setDir(segments.slice(0, index + 1).join('/'))}
              className="-my-1 cursor-pointer rounded-xs px-1 py-1 hover:bg-fill-raised hover:text-content-primary"
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[280px] shrink-0 overflow-y-auto border-r border-line-hairline px-2 pb-3">
          {segments.length > 0 && (
            <button
              type="button"
              onClick={() => setDir(segments.slice(0, -1).join('/'))}
              className="flex w-full items-center gap-2 rounded-field px-2.5 py-1.5 text-left text-body-sm text-content-tertiary hover:bg-fill-raised"
            >
              ..
            </button>
          )}
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-6">
              <Spinner size={16} />
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onDoubleClick={() => void window.clawmuse.fs.reveal(rootId!, entry.path)}
                onClick={() => void openEntry(entry)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-field px-2.5 py-1.5 text-left transition-colors hover:bg-fill-raised',
                  selected === entry.path && 'bg-fill-accent',
                )}
              >
                <Icon
                  icon={entry.isDirectory ? Folder01Icon : File01Icon}
                  size={15}
                  className="shrink-0 text-content-tertiary"
                />
                <span className="min-w-0 flex-1 truncate text-body-sm text-content-body">
                  {entry.name}
                </span>
                {entry.size != null && (
                  <span className="shrink-0 text-micro text-content-faint">
                    {formatBytes(entry.size)}
                  </span>
                )}
              </button>
            ))
          )}
          {!loading && entries.length === 0 && (
            <p className="px-2.5 py-4 text-caption text-content-faint">Empty folder</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {error ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyState
                icon={<Icon icon={Alert02Icon} size={40} className="text-content-disabled" />}
                title="Cannot read this folder"
                description={error}
              />
            </div>
          ) : !file ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyState
                icon={<Icon icon={File01Icon} size={40} className="text-content-disabled" />}
                title="Select a file"
                description="Files here are the ones your agent reads and writes."
              />
            </div>
          ) : file.binary || file.tooLarge ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyState
                icon={<Icon icon={File01Icon} size={40} className="text-content-disabled" />}
                title={file.binary ? 'Binary file' : 'File is too large to edit'}
                description={`${formatBytes(file.size)} · open it in Finder instead`}
              />
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between px-5 py-2">
                <span className="truncate text-caption text-content-tertiary">{selected}</span>
                <GradientButton size="sm" disabled={!dirty} loading={saving} onClick={() => void save()}>
                  {dirty ? 'Save' : 'Saved'}
                </GradientButton>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent px-5 pb-4 font-mono text-body-sm text-content-primary outline-none"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
