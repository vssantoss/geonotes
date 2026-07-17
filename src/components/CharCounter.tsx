import { cn } from '@/lib/utils'
import { useT } from '../lib/i18n'
import { NOTE_MAX_LENGTH } from '../../shared/types'

/**
 * Live character counter for a bounded text field, highlighted when the limit
 * is reached. Mono tabular figures so the count does not jiggle while typing.
 *
 * @param used - characters typed so far.
 * @param max - the character limit (defaults to the note limit).
 */
export function CharCounter({ used, max = NOTE_MAX_LENGTH }: { used: number; max?: number }) {
  const t = useT()
  return (
    <div
      className={cn(
        'text-right font-mono text-xs',
        used >= max ? 'font-semibold text-destructive' : 'text-muted-foreground',
      )}
    >
      {t('editor.counter', { used, max })}
    </div>
  )
}
