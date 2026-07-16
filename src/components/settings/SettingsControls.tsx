import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A titled settings section: a heading, an optional description and its content.
 *
 * @param title - the section heading.
 * @param description - optional supporting text under the heading.
 * @param children - the section body.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** One choice in a SegmentedControl. */
export interface SegmentOption<T> {
  value: T
  label: string
}

/**
 * A single-choice segmented control: a row of buttons where the active option
 * is filled. Used for the cosmetic preference selectors (theme, language,
 * units).
 *
 * @param value - the currently selected value.
 * @param options - the available choices.
 * @param onChange - called with the chosen value.
 * @param ariaLabel - accessible name for the group.
 */
export function SegmentedControl<T extends string | null>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Button
            key={String(option.value)}
            type="button"
            variant={active ? 'default' : 'ghost'}
            size="sm"
            aria-pressed={active}
            className={cn('flex-1', !active && 'text-muted-foreground')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
