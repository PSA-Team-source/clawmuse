import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft01Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { SettingsGroup, SettingsRow } from '@/components/settings'
import { IconButton, Skeleton } from '@/components/brand'
import { AlertDialog } from '@/components/primitives'
import { cn } from '@/lib/cn'
import {
  SECRET_NAME_RE,
  deleteSecretStoreEntry,
  hostFromInput,
  isPlausibleHost,
  listSecretStore,
  pairLogins,
  pairedUsernameName,
  parseHosts,
  planLoginWrites,
  secretEgressActive,
  setSecretStoreEntry,
  suggestSecretName,
  writeInOrder,
  type EnvEntry,
  type Login,
  type SecretStoreEntry,
  type SecretStoreSet,
} from '@/routes/settings/secure-store'

const LIST_KEY = ['secure-store'] as const
const EGRESS_KEY = ['secure-store-egress'] as const
/** Muse's SAVED_PASSWORD_MASK. */
const SAVED_PASSWORD_MASK = '••••••••'
const INPUT = 'selectable h-8 w-48 rounded-field bg-fill px-3 text-body text-content-primary outline-none placeholder:text-content-tertiary focus-visible:ring-2 focus-visible:ring-muse-blue disabled:opacity-45 md:w-64'
const PRIMARY = 'h-8 shrink-0 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45'
const QUIET = 'h-8 shrink-0 rounded-full px-4 text-body-sm font-medium text-content-primary hover:bg-fill-strong disabled:opacity-45'
const VALUE = 'max-w-64 break-all text-right text-body text-content-primary'

/** A login is keyed by its password entry's name; an env value by its own name. */
type View = { kind: 'list' } | { kind: 'add' } | { kind: 'login'; key: string } | { kind: 'env'; name: string }

function reasonOf(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined
}

/** The name of the entry a login actually has (a lone username has no password entry). */
function loginName(login: Login): string {
  return login.password?.name ?? login.username!.name
}

/** Muse's `CredentialWebsiteIdentity`: the site's hostname, else the entry's own name. */
function identityOf(login: Login): string {
  return login.hosts[0] ?? loginName(login)
}

/** "The password was saved; the username was not." — what a stopped write sequence left behind. */
function partialReport(login: Pick<Login, 'passwordName'>, saved: string[], failedName: string, error: unknown): string {
  const what = (name: string) => (name === login.passwordName ? 'password' : 'username')
  const head = saved.length ? `The ${saved.map(what).join(' and ')} was saved; the ${what(failedName)} was not.` : ''
  return [head, reasonOf(error)].filter(Boolean).join(' ')
}

/**
 * Muse's Settings > Secure store (HatchSecureStorageSettings) on OpenClaw's
 * team secret store. Values travel renderer → gateway once, on save; the list
 * never carries a secret's value, and nothing here logs or keeps one.
 */
export default function SecureStoreScreen() {
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: LIST_KEY, queryFn: listSecretStore })
  const egress = useQuery({ queryKey: EGRESS_KEY, queryFn: secretEgressActive, staleTime: 60_000 })
  const [requested, setView] = useState<View>({ kind: 'list' })
  // Muse keeps the page on the credential while a mutation's outcome is unknown.
  const [locked, setLocked] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: LIST_KEY })

  const paired = list.data ? pairLogins(list.data) : undefined
  const login = requested.kind === 'login' ? paired?.logins.find((candidate) => candidate.passwordName === requested.key) : undefined
  const env = requested.kind === 'env' ? paired?.envs.find((candidate) => candidate.name === requested.name) : undefined
  // Removed elsewhere (CLI, Control UI, the agent's `secrets` tool): nothing left to show.
  const gone = (requested.kind === 'login' && !login) || (requested.kind === 'env' && !env)
  const view = gone && list.isSuccess && !locked ? { kind: 'list' as const } : requested

  const title = view.kind === 'login' ? 'Password' : view.kind === 'env' ? 'Environment value' : 'Secure credentials store'
  const back = view.kind === 'list' ? undefined : () => setView({ kind: 'list' })
  const onDeleted = () => { setLocked(false); void refresh(); setView({ kind: 'list' }) }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <div className="flex items-center gap-2">
          {back && <IconButton icon={ArrowLeft01Icon} label="Back to Secure credentials store" disabled={locked} onClick={back} className="-ml-2" />}
          <h1 className="text-title-1 font-bold text-content-primary">{title}</h1>
        </div>

        {view.kind === 'add' && (
          <ManualCredentialAdd
            existing={list.data ?? []}
            onLockedChange={setLocked}
            onCancel={() => setView({ kind: 'list' })}
            onAdded={() => { void refresh(); setView({ kind: 'list' }) }}
            onAttempted={() => void refresh()}
          />
        )}

        {view.kind === 'login' && login && (
          <CredentialDetail key={login.passwordName} login={login} egressActive={egress.data} onLockedChange={setLocked} onChanged={() => void refresh()} onDeleted={onDeleted} />
        )}

        {view.kind === 'env' && env && (
          <EnvDetail key={env.name} entry={env} onLockedChange={setLocked} onChanged={() => void refresh()} onDeleted={onDeleted} />
        )}

        {view.kind === 'list' && (
          <section aria-label="Secure credentials store logins to websites" className="flex flex-col gap-6">
            {list.isPending ? (
              <CatalogSkeleton />
            ) : list.isError || !paired ? (
              <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-body text-content-primary">Unable to load saved credentials.</p>
                <button type="button" onClick={() => void list.refetch()} className={QUIET}>Try again</button>
              </div>
            ) : (
              <CatalogView
                logins={paired.logins}
                envs={paired.envs}
                onAdd={() => setView({ kind: 'add' })}
                onSelectLogin={(key) => setView({ kind: 'login', key })}
                onSelectEnv={(name) => setView({ kind: 'env', name })}
              />
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading secure credentials store" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
      <SettingsGroup className="mb-0">
        {[1, 2, 3].map((row) => (
          <div key={row} className="settings-row flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </SettingsGroup>
    </div>
  )
}

/** Muse's CatalogView: intro + Add, then the saved logins. */
function CatalogView({ logins, envs, onAdd, onSelectLogin, onSelectEnv }: {
  logins: Login[]
  envs: EnvEntry[]
  onAdd: () => void
  onSelectLogin: (key: string) => void
  onSelectEnv: (name: string) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-body text-content-primary">Securely store passwords for your agent to use.</p>
        <button type="button" onClick={onAdd} className={PRIMARY}>Add</button>
      </div>
      {logins.length > 0 && (
        <SettingsGroup title="Passwords" className="mb-0">
          {logins.map((login) => (
            <SettingsRow
              key={login.passwordName}
              label={<span className="break-all">{identityOf(login)}</span>}
              description={identityOf(login) === loginName(login) ? undefined : loginName(login)}
              onClick={() => onSelectLogin(login.passwordName)}
            />
          ))}
        </SettingsGroup>
      )}
      {envs.length > 0 && (
        <SettingsGroup title="Environment values" className="mb-0">
          {envs.map((entry) => (
            <SettingsRow key={entry.name} label={<span className="break-all">{entry.name}</span>} description={entry.value || undefined} onClick={() => onSelectEnv(entry.name)} />
          ))}
        </SettingsGroup>
      )}
      <p className="px-3 text-footnote text-content-secondary">
        Saved on this computer in OpenClaw’s state database, readable only by your user account. Passwords are write-only: once saved, they are never shown again.
      </p>
    </>
  )
}

/** Muse's CredentialEditField: label on the left, a compact input on the right, error under it. */
function CredentialEditField({ label, value, onChange, type = 'text', error, disabled, autoFocus, inputMode, onBlur, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
  inputMode?: 'url' | 'text'
  onBlur?: () => void
  placeholder?: string
}) {
  const errorId = useId()
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  return (
    <SettingsRow
      label={label}
      right={
        <div className="flex flex-col items-end gap-1">
          <div className="relative w-fit" dir="ltr">
            <input
              aria-label={label}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              autoComplete={isPassword ? 'new-password' : 'off'}
              spellCheck={false}
              autoFocus={autoFocus}
              disabled={disabled}
              inputMode={inputMode}
              placeholder={placeholder}
              type={isPassword && !revealed ? 'password' : 'text'}
              value={value}
              onBlur={onBlur}
              onChange={(event) => onChange(event.target.value)}
              className={cn(INPUT, isPassword && 'pr-9', error && 'ring-2 ring-error')}
            />
            {isPassword && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2">
                <IconButton icon={revealed ? ViewOffIcon : ViewIcon} label={revealed ? 'Hide password' : 'Show password'} size="xs" shape="circle" onClick={() => setRevealed((shown) => !shown)} />
              </span>
            )}
          </div>
          {error && <span id={errorId} role="alert" className="text-caption text-error">{error}</span>}
        </div>
      }
    />
  )
}

function Alert({ children, reason, id }: { children: ReactNode; reason?: string; id?: string }) {
  return (
    <div id={id} role="alert" className="px-3 text-caption text-content-primary">
      <p>{children}</p>
      {reason && <p className="mt-0.5 break-words text-content-secondary">{reason}</p>}
    </div>
  )
}

/** Muse's ManualCredentialAdd: URL, username, password — plus the entry name OpenClaw keys it by. */
function ManualCredentialAdd({ existing, onCancel, onAdded, onAttempted, onLockedChange }: {
  existing: SecretStoreEntry[]
  onCancel: () => void
  onAdded: () => void
  onAttempted: () => void
  onLockedChange: (locked: boolean) => void
}) {
  const [url, setUrl] = useState('')
  const [urlTouched, setUrlTouched] = useState(false)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<{ reason?: string } | null>(null)
  // A name this form already sent: if the reply was lost the entry may exist, and retrying it is ours to overwrite.
  const [attempted, setAttempted] = useState<string | null>(null)

  const host = hostFromInput(url)
  const urlError = urlTouched && url.trim() && !isPlausibleHost(host) ? 'Enter a valid website URL.' : null
  const passwordName = nameEdited ? name : suggestSecretName(host)
  const usernameName = pairedUsernameName(passwordName)
  const taken = existing.some((entry) => entry.name === passwordName || (username && entry.name === usernameName))
  const nameError = !passwordName
    ? null
    : !SECRET_NAME_RE.test(passwordName)
      ? 'Use capital letters, digits and underscores, starting with a letter.'
      : username && !usernameName
        ? 'To save a username with it, end the name in _PASSWORD.'
        : taken && attempted !== passwordName
          ? 'A credential with this name already exists.'
          : null
  const canSubmit = !submitting && (!url.trim() || isPlausibleHost(host)) && Boolean(passwordName) && !nameError && password.length > 0

  useEffect(() => () => onLockedChange(false), [onLockedChange])

  async function submit(): Promise<void> {
    setUrlTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    onLockedChange(true)
    setFailure(null)
    setAttempted(passwordName)
    const hosts = host ? { allowedHosts: [host] } : {}
    const writes: SecretStoreSet[] = [{ name: passwordName, value: password, kind: 'secret', ...hosts }]
    if (username) writes.push({ name: usernameName!, value: username, kind: 'secret', ...hosts })
    const result = await writeInOrder(writes)
    setSubmitting(false)
    onLockedChange(false)
    if (!result.failed) {
      setPassword('')
      setUsername('')
      onAdded()
      return
    }
    // The form keeps its values: Add again rewrites both entries, which is idempotent.
    setFailure({ reason: partialReport({ passwordName }, result.saved, result.failed.name, result.failed.error) })
    onAttempted()
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <SettingsGroup className="mb-0">
        <CredentialEditField label="URL" value={url} inputMode="url" placeholder="github.com" autoFocus disabled={submitting} error={urlError} onBlur={() => setUrlTouched(true)} onChange={(value) => { setUrl(value); setFailure(null) }} />
        <CredentialEditField label="Username" value={username} disabled={submitting} onChange={(value) => { setUsername(value); setFailure(null) }} />
        <CredentialEditField label="Password" type="password" value={password} disabled={submitting} onChange={(value) => { setPassword(value); setFailure(null) }} />
        <CredentialEditField label="Name" value={passwordName} placeholder="GITHUB_PASSWORD" disabled={submitting} error={nameError} onChange={(value) => { setNameEdited(true); setName(value.toUpperCase()); setFailure(null) }} />
      </SettingsGroup>
      <p className="px-3 text-footnote text-content-secondary">Agent commands can use it only on this website. Leave the URL empty for a key that only your OpenClaw config refers to by name.</p>
      {failure && <Alert reason={failure.reason}>Unable to add credential. Try again.</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={submitting} onClick={onCancel} className={QUIET}>Cancel</button>
        <button type="submit" disabled={!canSubmit} className={PRIMARY}>{submitting ? 'Adding…' : 'Add'}</button>
      </div>
    </form>
  )
}

type Busy = 'save' | 'delete' | 'delete-reconciling' | 'delete-unknown'
type Failure = { kind: 'save' | 'delete' | 'delete-reconciling'; reason?: string }

/**
 * Deletes every entry of a credential, in order, with Muse's reconciliation:
 * when a reply is lost or one delete fails, the list says what is left.
 */
function useDeletion(names: string[], onDeleted: () => void, setBusy: (busy: Busy | null) => void, setFailure: (failure: Failure | null) => void) {
  async function reconcile(): Promise<void> {
    setBusy('delete-reconciling')
    setFailure(null)
    try {
      const left = (await listSecretStore()).filter((entry) => names.includes(entry.name)).map((entry) => entry.name)
      if (left.length === 0) { onDeleted(); return }
      setBusy(null)
      setFailure({ kind: 'delete', reason: `Still saved: ${left.join(', ')}.` })
    } catch {
      setBusy('delete-unknown')
      setFailure({ kind: 'delete-reconciling' })
    }
  }

  async function remove(): Promise<void> {
    setBusy('delete')
    setFailure(null)
    try {
      for (const name of names) await deleteSecretStoreEntry(name)
      onDeleted()
    } catch {
      await reconcile()
    }
  }

  return { remove, reconcile }
}

/** The Delete cell, its confirmation, and the lost-reply controls — shared by logins and env values. */
function DeleteSection({ busy, subject, detail, onConfirm, onCheck }: { busy: Busy | null; subject: string; detail: ReactNode; onConfirm: () => void; onCheck: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const label = busy === 'delete-reconciling' ? 'Checking deletion status…' : busy === 'delete-unknown' ? 'Deletion status unknown' : busy === 'delete' ? 'Deleting…' : 'Delete'
  return (
    <>
      {busy === 'delete-unknown' && (
        <div className="flex justify-end">
          <button type="button" onClick={onCheck} className={QUIET}>Check status</button>
        </div>
      )}
      <SettingsGroup className="mb-0">
        <button type="button" disabled={busy !== null} onClick={() => setConfirming(true)} className="settings-row flex w-full items-center text-left text-body text-error disabled:opacity-50">
          {label}
        </button>
      </SettingsGroup>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Delete {subject}?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">{detail}</AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialog.Close className={QUIET}>Cancel</AlertDialog.Close>
          <button type="button" onClick={() => { setConfirming(false); onConfirm() }} className="h-8 rounded-full bg-error px-4 text-body-sm font-medium text-white">Delete</button>
        </div>
      </AlertDialog>
    </>
  )
}

function Failures({ failure, saveErrorId }: { failure: Failure | null; saveErrorId: string }) {
  if (failure?.kind === 'save') return <Alert id={saveErrorId} reason={failure.reason}>Unable to save changes. Try again.</Alert>
  if (failure?.kind === 'delete') return <Alert reason={failure.reason}>Unable to delete credential. Try again.</Alert>
  if (failure?.kind === 'delete-reconciling') return <Alert>Unable to confirm deletion. Secure credentials store remains locked while the result is unknown.</Alert>
  return null
}

function SavedMask({ saved, label }: { saved: string; label: string }) {
  return <span><span className="sr-only">{saved}</span><span aria-hidden="true" className="text-body text-content-secondary">{label}</span></span>
}

const PLAN_HINT: Record<string, string> = {
  'password-required': 'Enter the password again to change websites. Saved values can’t be read back.',
  'username-required': 'Enter the username again to change websites. Saved values can’t be read back.',
}

/** Muse's CredentialDetail: identity + Edit, login details, agent permissions, Delete. */
function CredentialDetail({ login, egressActive, onChanged, onDeleted, onLockedChange }: {
  login: Login
  egressActive: boolean | undefined
  onChanged: () => void
  onDeleted: () => void
  onLockedChange: (locked: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [hostsDraft, setHostsDraft] = useState('')
  const [usernameDraft, setUsernameDraft] = useState('')
  const [passwordDraft, setPasswordDraft] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const saveErrorId = useId()
  const names = [login.password?.name, login.username?.name].filter((name): name is string => Boolean(name))
  const deletion = useDeletion(names, onDeleted, setBusy, setFailure)

  useEffect(() => { onLockedChange(busy !== null) }, [busy, onLockedChange])
  useEffect(() => () => onLockedChange(false), [onLockedChange])

  const hosts = parseHosts(hostsDraft)
  const invalidHost = hosts.find((host) => !isPlausibleHost(host))
  const plan = planLoginWrites(login, { hosts, password: passwordDraft, username: usernameDraft })
  const canSave = editing && busy === null && !invalidHost && 'writes' in plan

  function clearDrafts(): void {
    setHostsDraft('')
    setUsernameDraft('')
    setPasswordDraft('')
  }

  function startEdit(): void {
    setHostsDraft(login.hosts.join(', '))
    setFailure(null)
    setEditing(true)
  }

  async function save(): Promise<void> {
    if (!canSave || !('writes' in plan)) return
    setBusy('save')
    setFailure(null)
    const result = await writeInOrder(plan.writes)
    setBusy(null)
    if (result.failed) {
      setFailure({ kind: 'save', reason: partialReport(login, result.saved, result.failed.name, result.failed.error) })
    } else {
      setEditing(false)
      clearDrafts()
    }
    // Also after a failure: part of the login, or "saved, but the runtime refresh failed", may be written.
    onChanged()
  }

  const hint = 'error' in plan && PLAN_HINT[plan.error] ? PLAN_HINT[plan.error] : 'Leave a field empty to keep what’s saved. Agent commands can use this login only on these websites.'

  return (
    <div className="flex flex-col gap-5" aria-busy={busy !== null}>
      <SettingsGroup className="mb-0">
        <SettingsRow
          label={<span className="break-all font-medium">{identityOf(login)}</span>}
          right={editing ? (
            <span className="flex items-center gap-2">
              <button type="button" disabled={busy !== null} onClick={() => { setEditing(false); clearDrafts(); setFailure(null) }} className={QUIET}>Cancel</button>
              <button type="button" disabled={!canSave} onClick={() => void save()} aria-describedby={failure?.kind === 'save' ? saveErrorId : undefined} className={PRIMARY}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            </span>
          ) : (
            <button type="button" disabled={busy !== null} onClick={startEdit} className={cn(QUIET, 'text-muse-blue')}>Edit</button>
          )}
        />
      </SettingsGroup>

      <SettingsGroup title="Login details" className="mb-0">
        {editing ? (
          <>
            <CredentialEditField label="Websites" value={hostsDraft} inputMode="url" placeholder="github.com" disabled={busy !== null} autoFocus error={invalidHost ? 'Enter a valid website URL.' : null} onChange={setHostsDraft} />
            {login.usernameName && <CredentialEditField label="Username" value={usernameDraft} disabled={busy !== null} onChange={setUsernameDraft} />}
            <CredentialEditField label="New password" type="password" value={passwordDraft} disabled={busy !== null} onChange={setPasswordDraft} />
          </>
        ) : (
          <>
            <SettingsRow label="Name" right={<span className={cn('selectable', VALUE)}>{loginName(login)}</span>} />
            {login.usernameName && (
              <SettingsRow label="Username" right={login.username ? <SavedMask saved="Username saved" label={SAVED_PASSWORD_MASK} /> : <span className="text-body text-content-primary">Not saved</span>} />
            )}
            <SettingsRow label="Password" right={login.password ? <SavedMask saved="Password saved" label={SAVED_PASSWORD_MASK} /> : <span className="text-body text-content-primary">No password saved</span>} />
            {login.hosts.length > 0 && <SettingsRow label={login.hosts.length === 1 ? 'Website' : 'Websites'} right={<span className={VALUE}>{login.hosts.join(', ')}</span>} />}
            <SettingsRow label="Last updated" right={<span className="text-right text-body text-content-secondary">{new Date(login.updatedAtMs).toLocaleString()}{login.updatedBy ? ` by ${login.updatedBy}` : ''}</span>} />
          </>
        )}
      </SettingsGroup>
      {editing && <p className="-mt-3 px-3 text-footnote text-content-secondary">{hint}</p>}
      {busy === 'save' && <p role="status" className="px-3 text-caption text-content-primary">Updating login details…</p>}

      {!editing && <AgentPermissions hosts={login.hosts} egressActive={egressActive} />}
      <Failures failure={failure} saveErrorId={saveErrorId} />
      {!editing && (
        <DeleteSection
          busy={busy}
          subject={identityOf(login)}
          detail={`Agents and settings that use ${names.join(' and ')} lose access to ${names.length > 1 ? 'them' : 'it'}.`}
          onConfirm={() => void deletion.remove()}
          onCheck={() => void deletion.reconcile()}
        />
      )}
    </div>
  )
}

/** An agent-readable env value: the one store entry whose value is shown and edited in place. */
function EnvDetail({ entry, onChanged, onDeleted, onLockedChange }: {
  entry: EnvEntry
  onChanged: () => void
  onDeleted: () => void
  onLockedChange: (locked: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [valueDraft, setValueDraft] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const saveErrorId = useId()
  const deletion = useDeletion([entry.name], onDeleted, setBusy, setFailure)

  useEffect(() => { onLockedChange(busy !== null) }, [busy, onLockedChange])
  useEffect(() => () => onLockedChange(false), [onLockedChange])

  const canSave = editing && busy === null && valueDraft !== entry.value

  async function save(): Promise<void> {
    if (!canSave) return
    setBusy('save')
    setFailure(null)
    try {
      await setSecretStoreEntry({ name: entry.name, value: valueDraft, kind: 'env' })
      setEditing(false)
    } catch (error) {
      setFailure({ kind: 'save', reason: reasonOf(error) })
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  return (
    <div className="flex flex-col gap-5" aria-busy={busy !== null}>
      <SettingsGroup className="mb-0">
        <SettingsRow
          label={<span className="break-all font-medium">{entry.name}</span>}
          right={editing ? (
            <span className="flex items-center gap-2">
              <button type="button" disabled={busy !== null} onClick={() => { setEditing(false); setFailure(null) }} className={QUIET}>Cancel</button>
              <button type="button" disabled={!canSave} onClick={() => void save()} aria-describedby={failure?.kind === 'save' ? saveErrorId : undefined} className={PRIMARY}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            </span>
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => { setValueDraft(entry.value); setFailure(null); setEditing(true) }} className={cn(QUIET, 'text-muse-blue')}>Edit</button>
          )}
        />
      </SettingsGroup>
      <SettingsGroup title="Details" className="mb-0">
        {editing ? (
          <CredentialEditField label="Value" value={valueDraft} disabled={busy !== null} autoFocus onChange={setValueDraft} />
        ) : (
          <>
            <SettingsRow label="Value" right={<span className={cn('selectable', VALUE)}>{entry.value}</span>} />
            <SettingsRow label="Last updated" right={<span className="text-right text-body text-content-secondary">{new Date(entry.updatedAtMs).toLocaleString()}{entry.updatedBy ? ` by ${entry.updatedBy}` : ''}</span>} />
          </>
        )}
      </SettingsGroup>
      {busy === 'save' && <p role="status" className="px-3 text-caption text-content-primary">Updating…</p>}
      {!editing && (
        <SettingsGroup title="Agent permissions" className="mb-0">
          <SettingsRow label="Readable by the agent" description="Agent commands see this value in their environment and can print, send or keep it." />
        </SettingsGroup>
      )}
      <Failures failure={failure} saveErrorId={saveErrorId} />
      {!editing && (
        <DeleteSection
          busy={busy}
          subject={entry.name}
          detail={`Agent commands and settings that use ${entry.name} lose access to it.`}
          onConfirm={() => void deletion.remove()}
          onCheck={() => void deletion.reconcile()}
        />
      )}
    </div>
  )
}

/**
 * Muse's "Agent permissions", told as OpenClaw actually decides it. OpenClaw
 * has no per-login "ask first": a secret reaches a website only through the
 * gateway's egress proxy, and only on its allowed hosts.
 */
function AgentPermissions({ hosts, egressActive }: { hosts: string[]; egressActive: boolean | undefined }) {
  let label: string
  let description: string
  if (hosts.length === 0) {
    label = 'Not used on websites'
    description = 'Add a website to let agent commands use this login there. Your OpenClaw config can still refer to it by name.'
  } else if (egressActive === undefined) {
    return null
  } else if (egressActive) {
    label = 'Use this login automatically'
    description = `Agent commands can use it on ${hosts.join(', ')} without asking. The agent never sees the password.`
  } else {
    label = 'Not used on websites yet'
    description = `The gateway’s secret egress proxy is off (secrets.egressProxy.enabled), so agent commands can’t use it on ${hosts.join(', ')}.`
  }
  return (
    <SettingsGroup title="Agent permissions" className="mb-0">
      <SettingsRow label={label} description={description} />
    </SettingsGroup>
  )
}
