import { cn } from '@/lib/utils'
import { useT } from '../lib/i18n'
import { NOTE_MAX_LENGTH } from '../../shared/types'

/**
 * Live character counter for the note editor, highlighted when the limit
 * is reached. Mono tabular figures so the count does not jiggle while typing.
 *
 * @param used - characters typed so far.
 */
export function CharCounter({ used }: { used: number }) {
  const t = useT()
  return (
    <div
      className={cn(
        'text-right font-mono text-xs',
        used >= NOTE_MAX_LENGTH ? 'font-semibold text-destructive' : 'text-muted-foreground',
      )}
    >
      {t('editor.counter', { used, max: NOTE_MAX_LENGTH })}
    </div>
  )
}
