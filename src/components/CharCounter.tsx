import { useT } from '../lib/i18n'
import { NOTE_MAX_LENGTH } from '../../shared/types'

/**
 * Live character counter for the note editor, highlighted when the limit
 * is reached.
 *
 * @param used - characters typed so far.
 */
export function CharCounter({ used }: { used: number }) {
  const t = useT()
  return (
    <div className={used >= NOTE_MAX_LENGTH ? 'counter full' : 'counter'}>
      {t('editor.counter', { used, max: NOTE_MAX_LENGTH })}
    </div>
  )
}
