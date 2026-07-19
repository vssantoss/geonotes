import { app } from './router'
import { purgeExpiredDeletedAccounts } from './_lib/account-deletion'
import { pruneExpiredEmailCodes } from './_lib/email-code'
import type { Env } from './_lib/env'

/**
 * The GeoNotes Worker: serves the API through the Hono router, the built SPA
 * through the assets binding, and runs the daily maintenance sweep.
 */
export default {
  fetch: app.fetch,

  /**
   * Daily maintenance sweep, replacing the opportunistic waitUntil piggyback
   * that stood in for a cron while the app ran on Pages.
   *
   * Both sweeps are idempotent and no-ops when nothing is due, so a missed or
   * repeated run costs nothing. The e-mail-code prune also still runs off
   * email-request, where it is genuinely amortized onto the requests that grow
   * that table; here it just catches a table left dirty by a quiet period.
   *
   * @param _event - the schedule that fired; unused, there is only one.
   * @param env - worker environment.
   * @param ctx - execution context, used to keep the sweeps alive.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now()
    ctx.waitUntil(purgeExpiredDeletedAccounts(env, now))
    ctx.waitUntil(pruneExpiredEmailCodes(env, now))
  },
} satisfies ExportedHandler<Env>
