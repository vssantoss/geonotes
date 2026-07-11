import type { ReactNode } from 'react'

/**
 * Inline notice bar for transient states (offline, GPS errors, expired
 * session). Content wraps and can include an action button.
 *
 * @param children - message and optional action.
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
