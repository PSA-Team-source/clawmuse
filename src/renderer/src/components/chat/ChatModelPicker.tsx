import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Popover } from '@base-ui/react/popover'
import { ArrowDown01Icon, Cancel01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { rankSearchItems } from '@/components/search/quick-search'
import { loadModels, readDefaultModel } from '@/services/model-catalog'
import { gatewayWS } from '@/services/gateway-ws.service'
import { useChatStore } from '@/stores/chat.store'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/patterns'
import type { AIModel } from '@/constants/models'

const AUTO = 'default'

/**
 * The picker's rows for a query: Auto first (while it matches), then models by
 * Muse's search ranking over name, id and provider. Empty query keeps the
 * catalogue order.
 */
export function filterModels(models: readonly AIModel[], query: string): { autoVisible: boolean; models: AIModel[] } {
  const needle = query.trim()
  if (!needle) return { autoVisible: true, models: [...models] }
  // Every word must match somewhere (name, id or provider), so "nex pro free"
  // finds `nex-agi/nex-n2.5-pro:free`; words are ranked with Muse's scoring
  // and summed.
  const words = needle.split(/\s+/)
  const fields = [
    { value: (model: AIModel) => model.name, weight: 1 },
    { value: (model: AIModel) => model.id, weight: 0.9 },
    { value: (model: AIModel) => model.provider, weight: 0.6 },
  ]
  const ranked = models.flatMap((model) => {
    let total = 0
    for (const word of words) {
      const best = rankSearchItems([model], word, fields)[0]
      if (!best) return []
      total += best.rank
    }
    return [{ model, total }]
  })
  ranked.sort((a, b) => b.total - a.total)
  const lower = needle.toLowerCase()
  return { autoVisible: 'auto'.startsWith(lower) || 'default'.startsWith(lower), models: ranked.map(({ model }) => model) }
}

interface Props {
  sessionId: string
  sessionModel?: string
  modelOverrideSource?: 'auto' | 'user' | 'default'
}

export const ChatModelPicker = memo(function ChatModelPicker({
  sessionId,
  sessionModel,
  modelOverrideSource,
}: Props) {
  const [open, setOpen] = useState(false)
  const [switchingTo, setSwitchingTo] = useState<string>()
  const [defaultModel, setDefaultModel] = useState<string>()
  const patchSession = useChatStore((state) => state.patchSession)
  const { show } = useToast()
  const { data: models = [] } = useQuery({
    queryKey: ['gateway', 'models'],
    queryFn: loadModels,
    staleTime: 5 * 60_000,
    retry: false,
  })

  useEffect(() => {
    let alive = true
    void gatewayWS
      .getConfig()
      .then((result) => {
        if (alive) setDefaultModel(readDefaultModel(result.config))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // `sessions.list` reports the effective model even when the session has no
  // pin. Only a user-sourced override is a manual selection; default and
  // automatic failover both remain under gateway control.
  const isDefault = modelOverrideSource !== 'user'
  const selected = useMemo(
    () => models.find((model) => model.id === sessionModel),
    [models, sessionModel],
  )
  const label = isDefault ? 'Auto' : selected?.name ?? sessionModel ?? 'Auto'

  async function choose(model: string) {
    setSwitchingTo(model)
    try {
      // "default" clears the persistent session pin (sent as null — see gatewayWS.patchSession),
      // restoring the configured primary plus its real fallback chain.
      await patchSession(sessionId, { model })
      changeOpen(false)
      show({
        title: model === 'default' ? 'Model set to Auto' : `Model set to ${model}`,
        variant: 'success',
      })
    } catch (error) {
      show({
        title: 'Could not switch the model',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      })
    } finally {
      setSwitchingTo(undefined)
    }
  }

  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Rows are only built while the menu is open: 500+ of them on every render
  // of the chat screen was most of the per-keystroke cost.
  const { autoVisible, models: visible } = useMemo(() => (open ? filterModels(models, query) : { autoVisible: false, models: [] }), [open, models, query])
  const rows = useMemo(() => [...(autoVisible ? [AUTO] : []), ...visible.map((model) => model.id)], [autoVisible, visible])

  // A fresh search every time it opens, with the first row highlighted.
  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) { setQuery(''); setActive(0) }
  }
  function changeQuery(next: string) {
    setQuery(next)
    setActive(0)
  }
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, rows.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      const id = rows[active]
      if (id && !switchingTo) void choose(id)
    }
  }

  const rowClass = (index: number) => cn('flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-caption disabled:opacity-50', index === active && 'bg-fill-raised')

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger
        aria-label={`Choose model, currently ${label}`}
        className="no-drag flex h-7 max-w-48 items-center gap-1 rounded-full border border-line px-2.5 text-micro font-medium text-content-secondary hover:bg-fill-raised"
      >
        <span className="truncate">{label}</span>
        <Icon icon={ArrowDown01Icon} size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50 outline-none">
          <Popover.Popup initialFocus={inputRef} className="flex max-h-96 w-80 flex-col overflow-hidden rounded-box border border-line bg-bg-panel shadow-popup outline-none">
            <label className="flex h-10 shrink-0 items-center gap-2 border-b border-line-hairline px-3 text-content-tertiary">
              <Icon icon={Search01Icon} size={14} />
              <input
                ref={inputRef}
                role="combobox"
                aria-label="Search models"
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={rows.length ? `${listId}-${active}` : undefined}
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Search ${models.length} models`}
                className="min-w-0 flex-1 bg-transparent text-caption text-content-primary outline-none placeholder:text-content-tertiary"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => { changeQuery(''); inputRef.current?.focus() }} className="flex size-5 items-center justify-center rounded-full hover:bg-fill-raised">
                  <Icon icon={Cancel01Icon} size={12} />
                </button>
              )}
            </label>
            <div id={listId} role="listbox" aria-label="Models" className="min-h-0 flex-1 overflow-y-auto p-1">
              {autoVisible && (
                <button id={`${listId}-0`} type="button" role="option" aria-selected={isDefault} onMouseEnter={() => setActive(0)} onClick={() => void choose(AUTO)} disabled={Boolean(switchingTo)} className={rowClass(0)}>
                  <span className="min-w-0">
                    <span className="block font-medium text-content-primary">Auto</span>
                    <span className="block truncate text-micro text-content-tertiary">
                      {defaultModel ? `Default with fallbacks · ${defaultModel}` : 'Default with configured fallbacks'}
                    </span>
                  </span>
                  {isDefault && <Icon icon={Tick02Icon} size={15} className="shrink-0 text-primary" />}
                </button>
              )}
              {autoVisible && visible.length > 0 && <div role="separator" className="my-1 h-px bg-line-hairline" />}
              {visible.map((model, position) => {
                const index = position + (autoVisible ? 1 : 0)
                const current = !isDefault && model.id === sessionModel
                return (
                  <button key={model.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={current} onMouseEnter={() => setActive(index)} onClick={() => void choose(model.id)} disabled={Boolean(switchingTo)} className={rowClass(index)}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-content-primary">{model.name}</span>
                      <span className="block truncate text-micro text-content-tertiary">{model.id}</span>
                    </span>
                    {current && <Icon icon={Tick02Icon} size={15} className="shrink-0 text-primary" />}
                  </button>
                )
              })}
              {rows.length === 0 && <p className="px-2.5 py-6 text-center text-caption text-content-tertiary">No models match “{query.trim()}”</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
})
