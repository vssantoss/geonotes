import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createAccountWithPasskey, passkeyLogin } from '../lib/auth'
import { ApiError } from '../lib/api'
import { useT } from '../lib/i18n'

type Step = 'start' | 'noPasskey' | 'createEmail'

/**
 * Passwordless sign-in flow, passkey-first: tapping "Log in" runs a
 * usernameless passkey ceremony. When no passkey is found the user is offered
 * account creation, which collects an e-mail (kept for future recovery, not
 * verified yet) and enrolls a passkey. Signing in is optional (the app is fully
 * usable local-only), so the flow can always be left without authenticating.
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

  /** Runs an async auth action with busy/error handling around it. */
  const run = async (action: () => Promise<void>, onError?: (err: unknown) => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      if (onError) onError(err)
      else setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  // Attempt a usernameless login; a failed ceremony (no passkey offered or
  // cancelled) drops to the account-creation offer rather than showing an error.
  const logIn = () =>
    run(
      () => passkeyLogin().then(onSignedIn),
      () => setStep('noPasskey'),
    )

  const createAccount = () =>
    run(
      () => createAccountWithPasskey(email).then(onSignedIn),
      (err) =>
        setError(
          err instanceof ApiError && err.status === 409
            ? t('auth.error.accountExists')
            : t('auth.error.generic'),
        ),
    )

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
          <Button disabled={busy} onClick={() => void logIn()}>
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
    </div>
  )
}
