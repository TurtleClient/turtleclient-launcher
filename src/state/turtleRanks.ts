import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'

/**
 * TurtleClient ranks, as the client shows them (owner, 27.11.2026): Admin red, Mod orange,
 * Premium gold (Turtle Plus), Partner violet (Ocean's Creator role), Translator dark green,
 * Player normal. The Turtle service reads them from Ocean's team roster and Plus wallets.
 */
export type TurtleRank = 'admin' | 'mod' | 'premium' | 'partner' | 'translator' | 'player'
const RANKS: TurtleRank[] = ['admin', 'mod', 'premium', 'partner', 'translator', 'player']

/** Name colours in lists, light enough for the dark panels. */
export const RANK_COLOR: Record<TurtleRank, string | undefined> = {
  admin: '#ff7a68',
  mod: '#ff9f43',
  premium: '#ffd24a',
  partner: '#c48bff',
  translator: '#4cbd6c',
  player: undefined,
}
export const rankIcon = (rank: TurtleRank) => '/turtle/ranks/turtle-' + rank + '.svg'
export const asRank = (value: unknown): TurtleRank => (RANKS.includes(value as TurtleRank) ? (value as TurtleRank) : 'player')
/** Ocean's own view for the player: team role first, then Premium while Plus runs. */
export function rankFromInventory(role: string | null | undefined, plusUntil: number | undefined): TurtleRank {
  if (role === 'creator') return 'partner'
  if (role === 'admin' || role === 'mod' || role === 'translator' || role === 'partner') return role
  return (plusUntil || 0) * 1000 > Date.now() ? 'premium' : 'player'
}

const key = (uuid: string) => uuid.replace(/-/g, '').toLowerCase()
interface RankState {
  accountId: string | null
  /** null until the service answered. */
  me: TurtleRank | null
  friends: Record<string, TurtleRank>
}
export const useTurtleRanks = create<RankState>(() => ({ accountId: null, me: null, friends: {} }))
export const friendRank = (state: RankState, uuid: string): TurtleRank => state.friends[key(uuid)] || 'player'

export async function refreshRanks(accountId: string | null) {
  if (useTurtleRanks.getState().accountId !== accountId) useTurtleRanks.setState({ accountId, me: null, friends: {} })
  if (!accountId) return
  try {
    const reply = await turtle<{ me?: string | null; friends?: Record<string, string> }>('turtle_friends', { accountId, action: 'ranks' })
    if (useTurtleRanks.getState().accountId !== accountId) return
    const friends: Record<string, TurtleRank> = {}
    for (const [uuid, rank] of Object.entries(reply.friends || {})) friends[key(uuid)] = asRank(rank)
    useTurtleRanks.setState({ me: asRank(reply.me), friends })
  } catch {
    /* Ranks stay as they were; the player's own falls back to Ocean's inventory. */
  }
}
