import { useState } from 'react'
import { CheckCircle2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TurnstileWidget, TURNSTILE_REQUIRED } from '@/components/TurnstileWidget'
import { confirmEmailCode, deleteAccountByEmail, requestEmailCode } from '@/lib/email-code'
import { ApiError } from '@/lib/api'
import { authErrorKey } from '@/lib/auth-error'
import { useCooldown } from '@/hooks/useCooldown'
import { useT } from '@/lib/i18n'

/** Mirrors the server's RESEND_COOLDOWN_MS: the minimum gap between code sends. */
const RESEND_COOLDOWN_MS = 60 * 1000

/** The steps of the flow: type an address, confirm the code, done. */
type Step = 'email' | 'code' | 'done'

/**
 * The public account-deletion page served at /delete-account, published on the
 * Google Play listing so account deletion can be requested without installing
 * the app. It is a document of its own rather than a screen of the app: it holds
 * no session, touches no local notes, and has to work for someone who has
 * already uninstalled (see src/delete-account.tsx).
 *
 * The explanation of what deletion does is rendered above the form at every
 * step, and needs no input to read, because that description is the part the
 * policy actually requires to be public.
 *
 * Authorization is mailbox control: the ordinary e-mail code (requested in
 * 'recover' mode, so nothing here reveals whether an address has an account),
 * exchanged for a short-lived enroll token, which the server accepts in place of
 * a session. That is no weaker than the in-app path, where the same code lets
 * anyone holding the mailbox recover the account and delete it from Settings.
 */
export function DeleteAccountPage() {
  const t = useT()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // Dev-only echoed code, so the flow is testable without a real inbox; always
  // absent in production.
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Countdown mirroring the server's per-address resend cooldown, so the resend
  // button shows when another code can be requested.
  const resendCooldown = useCooldown(RESEND_COOLDOWN_MS)
  // Current Turnstile token (null until the widget solves), and a counter the
  // send handler bumps to re-challenge after a token is spent. Only meaningful
  // when a sitekey is configured; otherwise the server skips verification.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)

  /**
   * Requests a confirmation code for the typed address and advances to the code
   * step. A 429 (a code was already sent recently) still advances, since the
   * earlier code remains valid.
   */
  const sendCode = async () => {
    setBusy(true)
    setError(null)
    setCode('')
    try {
      // Always 'recover': this page never creates an account, and recover mode
      // answers identically whether or not the address has one, so a typo or a
      // probe learns nothing.
      const { devCode: dev } = await requestEmailCode(email, 'recover', turnstileToken)
      setDevCode(dev ?? null)
      setStep('code')
      resendCooldown.start()
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setStep('code')
        resendCooldown.start()
      } else {
        setError(t(authErrorKey(err)))
      }
    } finally {
      setBusy(false)
      // The token was single-use and is now spent. Discard it and re-challenge
      // so a resend on the code step gets a fresh one.
      if (TURNSTILE_REQUIRED) {
        setTurnstileToken(null)
        setTurnstileReset((n) => n + 1)
      }
    }
  }

  /**
   * Exchanges the typed code for an enroll token and requests the deletion. Runs
   * only after the confirmation dialog, so the single-use code is not spent on a
   * press the user then backs out of.
   */
  const confirmDelete = async () => {
    setBusy(true)
    setError(null)
    setConfirming(false)
    try {
      await deleteAccountByEmail(await confirmEmailCode(email, code))
      setStep('done')
    } catch (err) {
      setError(
        t(
          authErrorKey(
            err,
            err instanceof ApiError && err.status === 401
              ? 'auth.error.badCode'
              : 'auth.error.generic',
          ),
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const codeValid = /^\d{6}$/.test(code)

  return (
    // max-w-xl to match the app shell in App.tsx: this page is reached from the
    // store listing rather than from the app, so it is the only GeoNotes anyone
    // arriving here has seen, and a narrower column would read as a different site.
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-4 p-6">
      <h1 className="flex items-center justify-center gap-2 font-display text-3xl font-bold tracking-tight">
        <MapPin className="size-7 text-primary" aria-hidden />
        {t('app.name')}
      </h1>

      <h2 className="text-center font-display text-xl font-bold tracking-tight">
        {t('deleteAccount.title')}
      </h2>

      {/* Shown at every step, including after the deletion is requested: it is
          what the page is required to state publicly, so it must be readable
          without typing anything and must not scroll away behind a form. */}
      <section className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-sm text-muted-foreground">
        <p>{t('deleteAccount.whatHappens')}</p>
        <ul className="list-disc pl-5">
          <li>{t('deleteAccount.removesNotes')}</li>
          <li>{t('deleteAccount.removesPasskeys')}</li>
          <li>{t('deleteAccount.removesDevices')}</li>
        </ul>
        <p>{t('deleteAccount.grace')}</p>
        <p>{t('deleteAccount.inAppHint')}</p>
      </section>

      {/* The reading and the doing are sized separately: the copy above is
          what a Play reviewer opens the page for and wants full width, while
          the form stays at the max-w-sm of AuthScreen, so an e-mail field is
          the same width here as it is in the app. */}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
        {step === 'email' && (
          <>
            <p className="text-sm text-muted-foreground">{t('deleteAccount.emailSubtitle')}</p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('auth.emailLabel')}
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  emailValid &&
                  !busy &&
                  (!TURNSTILE_REQUIRED || turnstileToken) &&
                  void sendCode()
                }
                className="bg-card"
              />
            </label>
            <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} />
            <Button
              disabled={!emailValid || busy || (TURNSTILE_REQUIRED && !turnstileToken)}
              onClick={() => void sendCode()}
            >
              {t('auth.sendCode')}
            </Button>
          </>
        )}

        {step === 'code' && (
          <>
            {/* Recover-mode wording: a code only goes out for a real account, and
                saying so conditionally is what keeps a probe from learning
                whether this address has one. */}
            <p className="text-sm text-muted-foreground">
              {t('auth.codeSentToRecover', { email })}
            </p>
            {devCode && (
              <p className="text-sm font-medium text-primary">
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
                onKeyDown={(e) => e.key === 'Enter' && codeValid && !busy && setConfirming(true)}
                className="bg-card"
              />
            </label>
            <Button
              variant="destructive"
              disabled={!codeValid || busy}
              onClick={() => setConfirming(true)}
            >
              {t('account.delete')}
            </Button>
            {/* Only resend needs a token here: it re-hits email-request, and the
                one the first send spent is single-use. Confirming the deletion
                needs none, so the challenge waits until the cooldown has made
                resend reachable. Same reasoning as AuthScreen's code step. */}
            {resendCooldown.remainingMs === 0 && (
              <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} />
            )}
            <Button
              variant="ghost"
              disabled={
                busy || resendCooldown.remainingMs > 0 || (TURNSTILE_REQUIRED && !turnstileToken)
              }
              onClick={() => void sendCode()}
            >
              {resendCooldown.remainingMs > 0
                ? t('auth.resendCodeIn', { s: Math.ceil(resendCooldown.remainingMs / 1000) })
                : t('auth.resendCode')}
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

        {step === 'done' && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-5 text-center">
            <CheckCircle2 className="size-7 text-primary" aria-hidden />
            <p className="font-medium">{t('deleteAccount.doneTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('deleteAccount.doneBody')}</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {confirming && (
        <ConfirmDialog
          message={t('account.deleteConfirm')}
          confirmLabel={t('account.deleteConfirmYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
