import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createAccountWithPasskey,
  finishSignIn,
  passkeyLogin,
  pendingAccountSwitch,
  wouldDisplaceNotes,
  type PendingSignIn,
} from '../lib/auth'
import { ApiError } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../lib/i18n'

type Step = 'start' | 'noPasskey' | 'createEmail'

/**
 * Passwordless sign-in flow, passkey-first: tapping "Log in" runs a
 * usernameless passkey ceremony. When no passkey is found the user is offered
 * account creation, which collects an e-mail (kept for future recovery, not
 * verified yet) and enrolls a passkey. Signing in is optional (the app is fully
 * usable local-only), so the flow can always be left without authenticating.
 *
 * Signing into an account different from the one whose notes are already on
 * this device would discard those notes on the first sync, so a confirmation
 * is shown before the switch is applied.
 *
 * @param onSignedIn - called once a session is established.
 * @param onCancel - called when the user leaves without signing in.
 */
export function AuthScreen({ onSignedIn, onCancel }: { onSignedIn: () => void; onCancel: () => void }) {
  const t = useT()
  const [step, setStep] = useState<Step>('start')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A verified ceremony held back because applying it would remove another
  // account's notes from this device; resolved by the confirmation dialog.
  const [pending, setPending] = useState<PendingSignIn | null>(null)
  // Set when account creation is paused because creating it would remove a
  // different account's notes; confirming runs the actual creation.
  const [confirmCreate, setConfirmCreate] = useState(false)

  /**
   * Runs a ceremony, then either applies it or, when it would discard another
   * account's notes, defers to the confirmation dialog.
   *
   * @param produce - obtains the verified sign-in (login or account creation).
   * @param onProduceError - handles a failed ceremony (e.g. no passkey found).
   */
  const startFlow = async (
    produce: () => Promise<PendingSignIn>,
    onProduceError: (err: unknown) => void,
  ) => {
    setBusy(true)
    setError(null)
    let signIn: PendingSignIn
    try {
      signIn = await produce()
    } catch (err) {
      onProduceError(err)
      setBusy(false)
      return
    }
    try {
      if (await pendingAccountSwitch(signIn)) {
        setPending(signIn)
      } else {
        await finishSignIn(signIn)
        onSignedIn()
      }
    } catch {
      setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  const logIn = () =>
    // A failed/absent passkey ceremony drops to the account-creation offer.
    void startFlow(passkeyLogin, () => setStep('noPasskey'))

  /**
   * Starts account creation. The target e-mail is known up front, so it first
   * checks whether creating this account would discard another account's notes
   * and, if so, pauses for confirmation before registering anything (so
   * cancelling truly cancels creation). Otherwise it creates straight away.
   */
  const createAccount = async () => {
    setError(null)
    if (await wouldDisplaceNotes(email)) {
      setConfirmCreate(true)
      return
    }
    await runCreate()
  }

  /**
   * Registers the account and passkey, then establishes the session. The
   * account-switch check already ran in createAccount, so this applies the
   * result directly without re-prompting.
   */
  const runCreate = async () => {
    setBusy(true)
    setError(null)
    try {
      await finishSignIn(await createAccountWithPasskey(email))
      onSignedIn()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t('auth.error.accountExists')
          : t('auth.error.generic'),
      )
    } finally {
      setBusy(false)
    }
  }

  /** Applies the deferred sign-in after the user confirms the account switch. */
  const confirmSwitch = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      await finishSignIn(pending)
      setPending(null)
      onSignedIn()
    } catch {
      setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight">
        <MapPin className="size-7 text-primary" aria-hidden />
        {t('app.name')}
      </h1>

      {step === 'start' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          <p className="text-sm text-muted-foreground">{t('auth.optionalHint')}</p>
          <Button disabled={busy} onClick={logIn}>
            {t('auth.logIn')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t('auth.back')}
          </Button>
        </>
      )}

      {step === 'noPasskey' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.noPasskeyFound')}</p>
          <Button disabled={busy} onClick={() => setStep('createEmail')}>
            {t('auth.createAccount')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t('auth.notNow')}
          </Button>
        </>
      )}

      {step === 'createEmail' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('auth.emailLabel')}
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailValid && !busy && void createAccount()}
              className="bg-card"
            />
          </label>
          <Button disabled={!emailValid || busy} onClick={() => void createAccount()}>
            {t('auth.createPasskey')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStep('noPasskey')}>
            {t('auth.back')}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {pending && (
        <ConfirmDialog
          message={t('auth.switchAccountWarning')}
          confirmLabel={t('auth.switchAccountConfirm')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmSwitch()}
          onCancel={() => setPending(null)}
        />
      )}

      {confirmCreate && (
        <ConfirmDialog
          message={t('auth.createDisplaceWarning')}
          confirmLabel={t('auth.createDisplaceConfirm')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => {
            setConfirmCreate(false)
            void runCreate()
          }}
          onCancel={() => setConfirmCreate(false)}
        />
      )}
    </div>
  )
}
