import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'
import { useT } from '@/lib/i18n'

/**
 * Header button that flips between light and dark on a single click. The icon
 * shows a sun in light mode and a moon in dark mode; clicking records the
 * opposite as an explicit choice (remembered for a month, after which the app
 * follows the OS setting again).
 */
export function ThemeToggle() {
  const t = useT()
  const { isDark, setChoice } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      onClick={() => setChoice(isDark ? 'light' : 'dark')}
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  )
}
