import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type ThemeChoice } from '@/lib/theme'
import { useLocale } from '@/lib/i18n'
import { useUnits, type UnitsPref } from '@/lib/units'
import { useT } from '@/lib/i18n'
import {
  SegmentedControl,
  SettingsSection,
  type SegmentOption,
} from '@/components/settings/SettingsControls'
import { PasskeysSection } from '@/components/settings/PasskeysSection'
import { SessionsSection } from '@/components/settings/SessionsSection'
import { EmailSection } from '@/components/settings/EmailSection'

/**
 * The Settings screen. Always shows the device-only cosmetic preferences
 * (appearance, language, distance units); the account management sections
 * (passkeys, active sessions, e-mail) appear only when signed in. Rendered by
 * App as a full-screen overlay, mirroring the sign-in flow.
 *
 * @param signedIn - whether a session is active, gating the account sections.
 * @param onClose - called to leave Settings and return to the previous screen.
 */
export function SettingsScreen({ signedIn, onClose }: { signedIn: boolean; onClose: () => void }) {
  const t = useT()
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme()
  const { choice: localeChoice, setLocale } = useLocale()
  const { pref: unitsPref, setPref: setUnitsPref } = useUnits()

  // System / Light / Dark. null represents "follow the OS".
  const themeOptions: SegmentOption<ThemeChoice | null>[] = [
    { value: null, label: t('settings.theme.system') },
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
  ]

  // System (auto-detect) / English / Español / Português. null = follow browser.
  const languageOptions: SegmentOption<string | null>[] = [
    { value: null, label: t('settings.language.system') },
    { value: 'en', label: t('settings.language.en') },
    { value: 'es', label: t('settings.language.es') },
    { value: 'pt', label: t('settings.language.pt') },
  ]

  // Automatic (from language) / Miles / Meters.
  const unitsOptions: SegmentOption<UnitsPref>[] = [
    { value: 'auto', label: t('settings.units.auto') },
    { value: 'imperial', label: t('settings.units.imperial') },
    { value: 'metric', label: t('settings.units.metric') },
  ]

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-border/60 bg-background/85 px-4 pt-[calc(env(safe-area-inset-top)+0.625rem)] pb-2.5 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1.5"
          aria-label={t('auth.back')}
          onClick={onClose}
        >
          <ArrowLeft />
        </Button>
        <h1 className="flex-1 font-display text-xl font-bold tracking-tight">
          {t('settings.title')}
        </h1>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('settings.done')}
        </Button>
      </header>

      <div className="flex flex-col gap-7 px-4 py-6">
        <SettingsSection title={t('settings.appearance')}>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.theme')}</span>
            <SegmentedControl
              value={themeChoice}
              options={themeOptions}
              onChange={setThemeChoice}
              ariaLabel={t('settings.theme')}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={t('settings.language')}>
          <SegmentedControl
            value={localeChoice}
            options={languageOptions}
            onChange={setLocale}
            ariaLabel={t('settings.language')}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.units')}>
          <SegmentedControl
            value={unitsPref}
            options={unitsOptions}
            onChange={setUnitsPref}
            ariaLabel={t('settings.units')}
          />
        </SettingsSection>

        {signedIn && (
          <>
            <PasskeysSection />
            <SessionsSection />
            <EmailSection />
          </>
        )}
      </div>
    </div>
  )
}
