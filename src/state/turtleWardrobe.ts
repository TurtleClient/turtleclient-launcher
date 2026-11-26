import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'
import type { Catalog, Cosmetic, WardrobeSnapshot } from '../lib/turtleclient'
import type { TurtleModel } from '../lib/turtleModelTypes'
import { normalizeTurtleCatalog } from '../lib/turtleWardrobeRules'
import { wornKind } from '../lib/turtleShop'
import type { ShopInventory } from '../lib/turtleShop'
import { useTurtleShop } from './turtleShop'
export { normalizeTurtleCatalog, categoryOf } from '../lib/turtleWardrobeRules'

/** A worn aura or trail, drawn around the figure in Home and the wardrobe. */
export interface WornEffect { kind: 'aura' | 'trail'; id: string; hash: string }

interface WardrobeState {
  accountId: string | null
  snapshot: WardrobeSnapshot | null
  catalog: Catalog | null
  models: Record<string, TurtleModel>
  effects: WornEffect[]
  /** Account whose worn items came from Ocean's inventory (shop purchases included). */
  oceanAccount: string | null
  busy: string | null
  error: string
}
export const useTurtleWardrobe = create<WardrobeState>(() => ({ accountId: null, snapshot: null, catalog: null, models: {}, effects: [], oceanAccount: null, busy: null, error: '' }))
const cache = new Map<string, Promise<TurtleModel>>()
/** Catalog models through the cosmetics route; shop-only models from their published file. */
export function turtleModel(item: Pick<Cosmetic, 'id' | 'hash'>): Promise<TurtleModel> {
  const key = item.id + ':' + item.hash
  let pending = cache.get(key)
  if (!pending) {
    pending = turtle<TurtleModel>('turtle_model', { id: item.id, hash: item.hash })
      .catch(async () => {
        const asset = await turtle<{ json?: unknown }>('turtle_preview_data', { asset: item.hash })
        if (!asset.json || typeof asset.json !== 'object') throw new Error('turtle_model_missing')
        return asset.json as TurtleModel
      })
      .catch(error => {cache.delete(key); throw error})
    cache.set(key, pending)
    while (cache.size > 64) cache.delete(cache.keys().next().value!)
  }
  return pending
}

/*
 * Ocean's inventory is the source of what the player wears: models from the shop and the
 * older wardrobe alike, plus aura and trail. The friends-service snapshot only fills in
 * while Ocean has not answered yet.
 */
let oceanKey = ''
let oceanGeneration = 0
async function wearOcean(inventory: ShopInventory | null, accountId: string | null) {
  if (!inventory || !accountId) {
    if (useTurtleWardrobe.getState().oceanAccount) {
      oceanKey = ''
      useTurtleWardrobe.setState({ oceanAccount: null, effects: [] })
    }
    return
  }
  const worn = inventory.equipped ?? []
  const key = accountId + '|' + worn.map(e => e.slot + ':' + e.hash).join(',')
  if (key === oceanKey) return
  oceanKey = key
  const current = ++oceanGeneration
  const entries = await Promise.all(worn.filter(e => wornKind(e.slot) === 'model').map(e => turtleModel(e).then(model => [e.id, model] as const, () => null)))
  if (current !== oceanGeneration) return
  useTurtleWardrobe.setState({
    oceanAccount: accountId,
    models: Object.fromEntries(entries.filter((e): e is readonly [string, TurtleModel] => !!e)),
    effects: worn.filter(e => e.slot === 'aura' || e.slot === 'trail').map(e => ({ kind: e.slot as 'aura' | 'trail', id: e.id, hash: e.hash })),
  })
}
useTurtleShop.subscribe((state, before) => {
  if (state.inventory !== before.inventory || state.accountId !== before.accountId) void wearOcean(state.inventory, state.accountId)
})

let generation = 0
let timer: ReturnType<typeof setInterval> | undefined
let pending: Promise<void> | null = null
let revision = ''
export function syncWardrobeAccount(accountId: string | null, connected: boolean) {
  if (useTurtleWardrobe.getState().accountId !== accountId) {
    generation++; clearInterval(timer); timer = undefined; pending = null; revision = ''
    useTurtleWardrobe.setState(s => ({ accountId, snapshot: null, models: s.oceanAccount === accountId ? s.models : {}, busy: null, error: '' }))
  }
  if (accountId && connected && !timer) {
    void refreshTurtleWardrobe()
    timer = setInterval(() => void refreshTurtleWardrobe(), 15000)
  }
}
export async function loadWardrobeCatalog() {
  try {useTurtleWardrobe.setState({ catalog: normalizeTurtleCatalog(await turtle<Catalog>('turtle_catalog')) })}
  catch (error) {useTurtleWardrobe.setState({error: String(error)})}
}
export function refreshTurtleWardrobe(): Promise<void> {
  if (pending) return pending
  const accountId = useTurtleWardrobe.getState().accountId
  if (!accountId) return loadWardrobeCatalog()
  const current = generation
  pending = Promise.resolve().then(async () => {
    try {
      const [snapshot, raw] = await Promise.all([turtle<WardrobeSnapshot>('turtle_wardrobe', {accountId}), turtle<Catalog>('turtle_catalog')])
      const catalog=normalizeTurtleCatalog(raw)
      // Ocean's answer already lists the older wardrobe's items too; keep it once present.
      const fromOcean = useTurtleWardrobe.getState().oceanAccount === accountId
      const worn = fromOcean ? [] : catalog.models.filter(item => Object.values(snapshot.equipped).includes(item.id))
      const entries = await Promise.all(worn.map(async item => [item.id, await turtleModel(item)] as const))
      if (current !== generation) return
      const next = JSON.stringify({snapshot, catalog})
      if (next !== revision) {
        revision = next
        useTurtleWardrobe.setState(fromOcean || useTurtleWardrobe.getState().oceanAccount === accountId ? { snapshot, catalog, error: '' } : { snapshot, catalog, models: Object.fromEntries(entries), error: '' })
      }
      else if (useTurtleWardrobe.getState().error) useTurtleWardrobe.setState({error:''})
    } catch (error) {if (current === generation) useTurtleWardrobe.setState({error: String(error)})}
    finally {if (current === generation) pending = null}
  })
  return pending
}
export async function wearTurtle(slot: string, item: string | null) {
  const state = useTurtleWardrobe.getState()
  if (!state.accountId || state.busy) return
  const current = generation
  useTurtleWardrobe.setState({busy: slot, error:''})
  try {
    await turtle('turtle_wardrobe', {accountId:state.accountId, slot, item})
    if (current !== generation) return
    await pending
    await refreshTurtleWardrobe()
  } catch (error) {if (current === generation) useTurtleWardrobe.setState({error: String(error)})}
  finally {if (current === generation) useTurtleWardrobe.setState({busy:null})}
}
