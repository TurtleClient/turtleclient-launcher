import { getAccount } from '../state/accounts'
import { uiConfirm } from '../state/confirm'
import { openSettings, showToast } from '../state/ui'
import { t } from '../i18n'
import { serviceError, turtle } from './turtleclient'
import type { TurtleStatus } from './turtleclient'
let starting = false
/** Starts the native client; with a friend's invite code it joins that world at start. */
export async function launchTurtleClient(join?: string): Promise<boolean> {
  if (starting) return false
  const account = getAccount()
  if (!account || account.kind !== 'microsoft') { showToast(t('Turtle: sign in with a Microsoft Minecraft account.'), 'error'); return false }
  starting = true
  try { await turtle('turtle_launch', { accountId: account.id, nick: account.nick, join: join || null }); return true }
  catch (e) {
    showToast(t(serviceError(e)), 'error')
    if (/executable|resources|game_dir|settings_corrupt/.test(String(e))) openSettings('game')
    return false
  } finally { starting = false }
}
/** Closes the client like its window's close button (the world is saved). */
export async function stopTurtleClient(): Promise<void> {
  try { await turtle('turtle_stop') }
  catch (e) { showToast(t(serviceError(e)), 'error') }
}
/**
 * Accepts a friend's world invite: the client starts and joins the friend. A client that
 * is already open is restarted after asking, because the launcher cannot steer it.
 */
export async function joinFriendWorld(code: string, friend: string): Promise<void> {
  const status = await turtle<TurtleStatus>('turtle_status').catch(() => null)
  if (status?.running) {
    const restart = await uiConfirm(t('Turtle: TurtleClient is already open. Restart it and join {name}?', { name: friend }), { confirmLabel: t('Turtle: restart and join') })
    if (!restart) return
    await stopTurtleClient()
  }
  showToast(t('Turtle: starting TurtleClient and joining {name}…', { name: friend }))
  await launchTurtleClient(code)
}
