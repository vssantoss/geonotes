import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { useT } from '@/lib/i18n'

/**
 * Header dropdown for picking the theme: system, light or dark. The trigger
 * shows a sun in light mode and a moon in dark mode (CSS-swapped so it also
 * tracks OS changes while in system mode).
 */
export function ThemeToggle() {
  const t = useT()
  const { theme, setTheme } = useTheme()

  const options: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
    { value: 'system', icon: Monitor, label: t('theme.system') },
    { value: 'light', icon: Sun, label: t('theme.light') },
    { value: 'dark', icon: Moon, label: t('theme.dark') },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.label')}>
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map(({ value, icon: Icon, label }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon />
            {label}
            {theme === value && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
