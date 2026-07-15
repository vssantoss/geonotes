import { useLiveQuery } from 'dexie-react-hooks'
import { CircleUserRound, LogIn, LogOut, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { kvGet, KV } from '@/lib/db'
import { useT } from '@/lib/i18n'

interface AccountMenuProps {
  /** Whether a session is active; switches badge and menu between the signed-in and signed-out variants. */
  signedIn: boolean
  /** Opens the sign-in flow. */
  onSignIn: () => void
  /** Starts the sign-out flow (flush + keep/remove dialog handled by the caller). */
  onSignOut: () => void
  /** Opens the Settings screen (cosmetic prefs, plus account management when signed in). */
  onOpenSettings: () => void
}

/**
 * Header account badge: a circular button at the top right that opens a
 * dropdown menu. Signed in it shows the account's initial and offers sign-out
 * (with the e-mail as the menu header); signed out it shows a generic person
 * icon and offers sign-in. Built as a menu so future account options can be
 * added as extra items.
 *
 * @param props - see AccountMenuProps.
 * @returns the badge with its dropdown menu.
 */
export function AccountMenu({ signedIn, onSignIn, onSignOut, onOpenSettings }: AccountMenuProps) {
  const t = useT()
  // The signed-in e-mail, shown at the top of the menu and used for the badge
  // initial. Live so the badge updates the moment a sign-in/out lands in kv.
  const email = useLiveQuery(() => kvGet(KV.userEmail), [], null)
  const initial = email?.trim().charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t('account.menu')}
          title={t('account.menu')}
        >
          {signedIn && initial ? (
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initial}
            </span>
          ) : (
            <CircleUserRound className="size-5.5 text-muted-foreground" strokeWidth={1.75} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {signedIn && email && (
          <>
            <DropdownMenuLabel className="max-w-60 truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Settings is reachable in both states: it also holds the device-only
            cosmetic preferences, which apply while signed out. */}
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings />
          {t('account.settings')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {signedIn ? (
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOut />
            {t('auth.signOut')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onSignIn}>
            <LogIn />
            {t('auth.signIn')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
