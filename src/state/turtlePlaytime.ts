import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'

/** TurtleClient playtime as the Turtle service stores it (credited by the launcher's heartbeats). */
export const useTurtlePlaytime = create<{ accountId: string | null; seconds: number | null }>(() => ({ accountId: null, seconds: null }))
let request = 0
const CACHE = 'turtle-playtime-v1:'
function cached(account: string): number | null {
  try {
    const raw = localStorage.getItem(CACHE + account)
    const value = raw === null || !/^\d+$/.test(raw) ? NaN : Number(raw)
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {return null}
}

export async function refreshTurtlePlaytime(accountId: string | null) {
  const currentRequest = ++request
  if (!accountId) {
    useTurtlePlaytime.setState({ accountId: null, seconds: null })
    return
  }
  const current = useTurtlePlaytime.getState()
  useTurtlePlaytime.setState({ accountId, seconds: current.accountId === accountId ? current.seconds ?? cached(accountId) : cached(accountId) })
  try {
    const answer = await turtle<{ seconds: number }>('turtle_playtime', { accountId })
    if (currentRequest !== request || !Number.isSafeInteger(answer.seconds) || answer.seconds < 0) return
    useTurtlePlaytime.setState({ accountId, seconds: answer.seconds })
    try {localStorage.setItem(CACHE + accountId, String(answer.seconds))} catch { /* Storage may be unavailable. */ }
  } catch {
    // Offline or not connected yet: keep the last known value instead of showing zero.
  }
}
