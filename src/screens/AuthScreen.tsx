import { useState } from 'react'
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
    <div className="auth">
      <h1>{t('app.name')}</h1>

      {step === 'email' && (
        <>
          <p className="hint">{t('auth.subtitle')}</p>
          <p className="hint">{t('auth.optionalHint')}</p>
          <label>
            {t('auth.emailLabel')}
            <input
              type="email"
              autoComplete="email webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailValid && setStep('method')}
            />
          </label>
          <button className="btn primary" disabled={!emailValid || busy} onClick={() => setStep('method')}>
            {t('auth.continue')}
          </button>
          <button className="btn" disabled={busy} onClick={onCancel}>
            {t('auth.back')}
          </button>
        </>
      )}

      {step === 'method' && (
        <>
          <p className="hint">{email}</p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => run(() => passkeyLogin(email).then(onSignedIn), 'auth.error.noPasskey')}
          >
            {t('auth.usePasskey')}
          </button>
          <button className="btn" disabled={busy} onClick={() => void sendCode()}>
            {t('auth.sendCode')}
          </button>
          <button className="btn" disabled={busy} onClick={() => setStep('email')}>
            {t('auth.back')}
          </button>
        </>
      )}

      {step === 'code' && (
        <>
          <p className="hint">{t('auth.codeSent', { email })}</p>
          <label>
            {t('auth.codeLabel')}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button
            className="btn primary"
            disabled={code.length !== 6 || busy}
            onClick={() =>
              run(() => verifyEmailCode(email, code).then(() => setStep('offerPasskey')), 'auth.error.badCode')
            }
          >
            {t('auth.verify')}
          </button>
          <button className="btn" disabled={busy} onClick={() => setStep('method')}>
            {t('auth.back')}
          </button>
        </>
      )}

      {step === 'offerPasskey' && (
        <>
          <p className="hint">{t('auth.passkeyOffer')}</p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => run(() => registerPasskey().then(onSignedIn))}
          >
            {t('auth.createPasskey')}
          </button>
          <button className="btn" disabled={busy} onClick={onSignedIn}>
            {t('auth.skipPasskey')}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
