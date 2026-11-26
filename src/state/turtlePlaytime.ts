import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'

/** TurtleClient playtime as the Turtle service stores it (credited by the launcher's heartbeats). */
export const useTurtlePlaytime = create<{ accountId: string | null; seconds: number | null }>(() => ({ accountId: null, seconds: null }))

export async function refreshTurtlePlaytime(accountId: string | null) {
  if (!accountId) {
    useTurtlePlaytime.setState({ accountId: null, seconds: null })
    return
  }
  try {
    const answer = await turtle<{ seconds: number }>('turtle_playtime', { accountId })
    useTurtlePlaytime.setState({ accountId, seconds: Math.max(0, Math.floor(Number(answer.seconds) || 0)) })
  } catch {
    // Offline or not connected yet: keep the last known value instead of showing zero.
  }
}
