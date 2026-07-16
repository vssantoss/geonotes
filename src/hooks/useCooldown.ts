import { useCallback, useEffect, useState } from 'react'

/**
 * A restartable countdown timer, for reflecting a server-side cooldown in the
 * UI (e.g. the 60s e-mail-code resend window). Ticks a few times a second while
 * active and settles at zero, so a button can show the remaining seconds and
 * re-enable itself when the cooldown elapses.
 *
 * @param durationMs - how long each cooldown lasts once started.
 * @returns `remainingMs` (milliseconds left, 0 when idle) and `start` (begins or
 *          restarts the countdown from the full duration).
 */
export function useCooldown(durationMs: number): { remainingMs: number; start: () => void } {
  // The absolute end time of the current cooldown, or null when idle.
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    if (deadline === null) return
    /** Recomputes the remaining time and stops the timer once it hits zero. */
    const tick = () => {
      const left = Math.max(0, deadline - Date.now())
      setRemainingMs(left)
      if (left === 0) setDeadline(null)
    }
    tick() // Reflect the new deadline immediately, before the first interval.
    // Sub-second cadence so the displayed seconds never appear to skip or stall.
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [deadline])

  const start = useCallback(() => setDeadline(Date.now() + durationMs), [durationMs])

  return { remainingMs, start }
}
