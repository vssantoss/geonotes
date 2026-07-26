import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Inline notice bar for transient states (offline, GPS errors, expired
 * session). Content wraps and can include an action button.
 *
 * @param center - stack the content and centre it instead of running it inline.
 *   For messages long enough to wrap, where an action button left dangling at
 *   the end of the last line reads as part of the sentence.
 * @param className - extra classes, for a caller whose layout already provides
 *   the spacing the default margins assume (they sit against the app frame).
 * @param children - message and optional action.
 */
export function Notice({
  center = false,
  className,
  children,
}: {
  center?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-4 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground',
        // whitespace-pre-line honours the newlines the messages carry, so each
        // sentence gets its own line instead of breaking wherever the width
        // happens to run out. text-balance evens out any line that still has to
        // wrap on a narrow screen.
        center && 'flex-col justify-center text-center text-balance whitespace-pre-line',
        className,
      )}
    >
      {children}
    </div>
  )
}
