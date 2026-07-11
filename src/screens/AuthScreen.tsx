import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { passkeyLogin, registerPasskey, requestEmailCode, verifyEmailCode } from '../lib/auth'
import { useT } from '../lib/i18n'

type Step = 'email' | 'method' | 'code' | 'offerPasskey'

/**
 * Passwordless sign-in flow: e-mail first, then either a passkey ceremony or
 * a 6-digit e-mailed code, followed by an optional passkey enrollment offer.
 * Signing in is optional (the app is fully usable local-only), so the flow
 * can always be left without authenticating.
 *
 * @param onSignedIn - called once a session is established.
 * @param onCancel - called when the user leaves without signing in.
 */
export function AuthScreen({ onSignedIn, onCancel }: { onSignedIn: () => void; onCancel: () => void }) {
  const t = useT()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Runs an async auth action with busy/error handling around it. */
  const run = async (action: () => Promise<void>, errorKey = 'auth.error.generic') => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch {
      setError(t(errorKey))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      const devCode = await requestEmailCode(email)
      // In dev mode the server echoes the code so the flow is testable
      // without a mail provider; prefill it for convenience.
      if (devCode) setCode(devCode)
      setStep('code')
    })

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight">
        <MapPin className="size-7 text-primary" aria-hidden />
        {t('app.name')}
      </h1>

      {step === 'email' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          <p className="text-sm text-muted-foreground">{t('auth.optionalHint')}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('auth.emailLabel')}
            <Input
              type="email"
              autoComplete="email webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailValid && setStep('method')}
              className="bg-card"
            />
          </label>
          <Button disabled={!emailValid || busy} onClick={() => setStep('method')}>
            {t('auth.continue')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t('auth.back')}
          </Button>
        </>
      )}

      {step === 'method' && (
        <>
          <p className="text-sm text-muted-foreground">{email}</p>
          <Button
            disabled={busy}
            onClick={() => run(() => passkeyLogin(email).then(onSignedIn), 'auth.error.noPasskey')}
          >
            {t('auth.usePasskey')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void sendCode()}>
            {t('auth.sendCode')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStep('email')}>
            {t('auth.back')}
          </Button>
        </>
      )}

      {step === 'code' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.codeSent', { email })}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('auth.codeLabel')}
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="bg-card text-center font-mono text-lg tracking-[0.4em]"
            />
          </label>
          <Button
            disabled={code.length !== 6 || busy}
            onClick={() =>
              run(() => verifyEmailCode(email, code).then(() => setStep('offerPasskey')), 'auth.error.badCode')
            }
          >
            {t('auth.verify')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStep('method')}>
            {t('auth.back')}
          </Button>
        </>
      )}

      {step === 'offerPasskey' && (
        <>
          <p className="text-sm text-muted-foreground">{t('auth.passkeyOffer')}</p>
          <Button disabled={busy} onClick={() => run(() => registerPasskey().then(onSignedIn))}>
            {t('auth.createPasskey')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onSignedIn}>
            {t('auth.skipPasskey')}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
