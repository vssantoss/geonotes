import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  confirmEmailCode,
  createAccountWithPasskey,
  finishSignIn,
  passkeyLogin,
  PasskeyUnavailableError,
  requestEmailCode,
  wouldDisplaceNotes,
  type PendingSignIn,
} from '../lib/auth'
import { ApiError } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../lib/i18n'

type Step = 'start' | 'noPasskey' | 'email' | 'code'
/** Whether the email/code flow creates a fresh account or recovers an existing
    one. Both run the same server flow (confirm e-mail, then enrol a passkey);
    the mode only changes the copy shown to the user. */
type Mode = 'create' | 'recover'

/**
 * Passwordless sign-in flow, passkey-first: tapping "Log in" runs a
 * usernameless passkey ceremony. When no passkey is found the user can either
 * create an account or recover an existing one. Both paths confirm mailbox
 * ownership with a 6-digit e-mail code first, then enrol a passkey; recovery
 * simply attaches the new passkey to the account the e-mail already owns.
 * Signing in is optional (the app is fully usable local-only), so the flow can
 * always be left without authenticating.
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
  const [mode, setMode] = useState<Mode>('create')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // The proof-of-ownership token minted once the code is confirmed. Kept so a
  // cancelled passkey ceremony can be retried without re-confirming (and
  // re-consuming) the code, which is single-use server-side.
  const [enrollToken, setEnrollToken] = useState<string | null>(null)
  // Dev-only echoed code, shown on the code screen so the flow is testable
  // without a real inbox; always absent in production.
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A verified passkey login held back because applying it would remove another
  // account's notes from this device; resolved by the confirmation dialog.
  const [pending, setPending] = useState<PendingSignIn | null>(null)
  // Set when enrolment is paused because creating/recovering here would remove a
  // different account's notes; confirming runs the actual enrolment.
  const [confirmCreate, setConfirmCreate] = useState(false)

  /**
   * Runs a passkey login ceremony, then either applies it or, when it would
   * discard another account's notes, defers to the confirmation dialog.
   */
  const logIn = () => {
    void (async () => {
      setBusy(true)
      setError(null)
      let signIn: PendingSignIn
      try {
        signIn = await passkeyLogin()
      } catch (err) {
        // Only a failed/absent passkey ceremony drops to the create/recover
        // offer. A completed ceremony the server rejects (or a network failure)
        // shows an error instead: the user does have a passkey, so offering to
        // create an account would be misleading.
        if (err instanceof PasskeyUnavailableError) {
          setStep('noPasskey')
        } else {
          setError(
            err instanceof ApiError && err.status === 401
              ? t('auth.error.passkeyNotRecognized')
              : t('auth.error.generic'),
          )
        }
        setBusy(false)
        return
      }
      try {
        if (await wouldDisplaceNotes(signIn.email)) {
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
    })()
  }

  /**
   * Opens the e-mail step for account creation or recovery, starting from a
   * clean slate so a previous attempt never leaks in.
   *
   * @param next - which flow to run.
   */
  const openEmailStep = (next: Mode) => {
    setMode(next)
    setEmail('')
    setCode('')
    setEnrollToken(null)
    setDevCode(null)
    setError(null)
    setStep('email')
  }

  /**
   * Requests a confirmation code for the typed e-mail and advances to the code
   * step. A 429 (a code was already sent recently) still advances, since the
   * earlier code remains valid.
   */
  const sendCode = async () => {
    setBusy(true)
    setError(null)
    setCode('')
    setEnrollToken(null)
    try {
      const { devCode: dev } = await requestEmailCode(email, mode)
      setDevCode(dev ?? null)
      setStep('code')
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setStep('code')
      } else {
        setError(t('auth.error.generic'))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Confirms the code (once), then enrols a passkey. If enrolling here would
   * discard another account's notes it pauses for confirmation first, so
   * cancelling truly cancels. The enroll token is cached so a cancelled passkey
   * ceremony can be retried without re-confirming the single-use code.
   */
  const submitCode = async () => {
    setBusy(true)
    setError(null)
    let token = enrollToken
    if (!token) {
      try {
        token = await confirmEmailCode(email, code)
        setEnrollToken(token)
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 401
            ? t('auth.error.badCode')
            : t('auth.error.generic'),
        )
        setBusy(false)
        return
      }
    }
    let displaces: boolean
    try {
      displaces = await wouldDisplaceNotes(email)
    } catch {
      setError(t('auth.error.generic'))
      setBusy(false)
      return
    }
    if (displaces) {
      // Hand off to the confirmation dialog, which drives enrolment on confirm.
      setBusy(false)
      setConfirmCreate(true)
      return
    }
    await runEnrol(token)
  }

  /**
   * Enrols the passkey with a confirmed enroll token and establishes the
   * session. The account-switch check already ran in submitCode, so this
   * applies the result directly.
   *
   * @param token - the enroll token proving the e-mail was confirmed.
   */
  const runEnrol = async (token: string) => {
    setBusy(true)
    setError(null)
    try {
      await finishSignIn(await createAccountWithPasskey(email, token))
      onSignedIn()
    } catch {
      setError(t('auth.error.generic'))
      setBusy(false)
    }
  }

  /** Applies the deferred passkey login after the user confirms the switch. */
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
  const codeValid = /^\d{6}$/.test(code)

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight">
        <MapPin className="size-7 text-primary" aria-hidden />
        {t('app.name')}
      </h1>

      {step === 'start' && (
        <>
          <p className="text-center text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          <p className="text-center text-sm text-muted-foreground">{t('auth.optionalHint')}</p>
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
          <p className="text-center text-sm text-muted-foreground">{t('auth.noPasskeyFound')}</p>
          <Button disabled={busy} onClick={() => openEmailStep('create')}>
            {t('auth.createAccount')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => openEmailStep('recover')}>
            {t('auth.recoverAccount')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t('auth.notNow')}
          </Button>
        </>
      )}

      {step === 'email' && (
        <>
          <p className="text-center text-sm text-muted-foreground">
            {t(mode === 'recover' ? 'auth.recoverSubtitle' : 'auth.createSubtitle')}
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('auth.emailLabel')}
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailValid && !busy && void sendCode()}
              className="bg-card"
            />
          </label>
          <Button disabled={!emailValid || busy} onClick={() => void sendCode()}>
            {t('auth.sendCode')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null)
              setStep('noPasskey')
            }}
          >
            {t('auth.back')}
          </Button>
        </>
      )}

      {step === 'code' && (
        <>
          <p className="text-center text-sm text-muted-foreground">
            {t(mode === 'recover' ? 'auth.codeSentToRecover' : 'auth.codeSentTo', { email })}
          </p>
          {devCode && (
            <p className="text-center text-sm font-medium text-primary">
              {t('auth.devCode', { code: devCode })}
            </p>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('auth.codeLabel')}
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              // Keep only digits so paste/autofill of formatted codes still works.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && codeValid && !busy && void submitCode()}
              className="bg-card"
            />
          </label>
          <Button disabled={!codeValid || busy} onClick={() => void submitCode()}>
            {t('auth.createPasskey')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void sendCode()}>
            {t('auth.resendCode')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null)
              setStep('email')
            }}
          >
            {t('auth.back')}
          </Button>
        </>
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

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
            if (enrollToken) void runEnrol(enrollToken)
          }}
          onCancel={() => setConfirmCreate(false)}
        />
      )}
    </div>
  )
}
