import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AtSign, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmEmailChange, requestEmailChangeCode } from '@/lib/account'
import { ApiError } from '@/lib/api'
import { KV, kvGet } from '@/lib/db'
import { useT } from '@/lib/i18n'
import { SettingsSection } from './SettingsControls'

// The steps of the e-mail change flow: closed, entering the new address,
// entering the code sent to it, or done.
type Step = 'idle' | 'email' | 'code' | 'done'

/**
 * Settings section for changing the account e-mail. Reuses the standard
 * email-code flow: the user enters a new address, receives a 6-digit code that
 * proves control of it, and on confirmation the change is applied server-side
 * and the local account markers are re-pointed. Shows the current address and,
 * in dev mode, the echoed code so the flow is testable without a real inbox.
 */
export function EmailSection() {
  const t = useT()
  // Live current e-mail so the display updates the instant a change lands in kv.
  const currentEmail = useLiveQuery(() => kvGet(KV.userEmail), [], null)
  const [step, setStep] = useState<Step>('idle')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Resets the flow back to its collapsed initial state. */
  const reset = () => {
    setStep('idle')
    setNewEmail('')
    setCode('')
    setDevCode(undefined)
    setError(null)
  }

  /** Sends a confirmation code to the typed new address and advances to the code step. */
  const sendCode = async () => {
    // Block changing to the current address before sending a pointless code to
    // it; the server enforces the same rule as a backstop.
    if (newEmail.trim().toLowerCase() === (currentEmail ?? '').toLowerCase()) {
      setError(t('email.sameAddress'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { devCode } = await requestEmailChangeCode(newEmail.trim())
      setDevCode(devCode)
      setStep('code')
    } catch (err) {
      // The server rejects an unchanged or already-used address before sending.
      if (err instanceof ApiError && err.status === 409) {
        setError(t(err.message === 'email unchanged' ? 'email.sameAddress' : 'email.inUse'))
      } else setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  /** Confirms the code and applies the e-mail change, mapping the in-use 409. */
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await confirmEmailChange(newEmail.trim(), code.trim())
      setStep('done')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t(err.message === 'email unchanged' ? 'email.sameAddress' : 'email.inUse'))
      } else if (err instanceof ApiError && err.status === 401) setError(t('auth.error.badCode'))
      else setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={t('email.title')}>
      <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
        <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{t('email.current')}</p>
          <p className="truncate text-sm font-medium">{currentEmail ?? '—'}</p>
        </div>
      </div>

      {step === 'idle' && (
        <Button variant="outline" size="sm" onClick={() => setStep('email')}>
          {t('email.change')}
        </Button>
      )}

      {step === 'email' && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('email.newLabel')}
            <Input
              autoFocus
              type="email"
              inputMode="email"
              aria-invalid={!!error}
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && !busy && newEmail.trim() && void sendCode()}
              className="bg-card"
            />
          </label>
          {error && (
            <p className="flex items-center gap-1.5 text-xs font-normal text-amber-700 dark:text-amber-500">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={reset}>
              {t('editor.cancel')}
            </Button>
            <Button size="sm" disabled={busy || !newEmail.trim()} onClick={() => void sendCode()}>
              {t('auth.sendCode')}
            </Button>
          </div>
        </div>
      )}

      {step === 'code' && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('email.codeSent', { email: newEmail.trim() })}
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-invalid={!!error}
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && !busy && code.trim() && void confirm()}
              className="bg-card"
            />
          </label>
          {error && (
            <p className="flex items-center gap-1.5 text-xs font-normal text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          {devCode && <p className="text-xs text-muted-foreground">{t('auth.devCode', { code: devCode })}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={reset}>
              {t('editor.cancel')}
            </Button>
            <Button size="sm" disabled={busy || !code.trim()} onClick={() => void confirm()}>
              {t('email.confirm')}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
          <p className="text-sm text-muted-foreground">{t('email.success')}</p>
          <Button variant="ghost" size="sm" onClick={reset}>
            {t('common.close')}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
