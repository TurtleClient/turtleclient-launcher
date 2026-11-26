/**
 * Turtle shop data from Ocean (`/api/social/shop/inventory`). Pure helpers only:
 * prices, ownership, cart totals and filters follow Ocean's own rules so the
 * launcher never promises a price the server will not charge.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

/** One wardrobe entry as Ocean serializes it (`Owned`: entry fields plus `kind`). */
export interface OceanItem {
  id: string
  name: string
  hash: string
  slot: string
  owner: string
  rarity?: string
  kind: string
}

export interface BundleQuote {
  price: number | null
  owned: boolean
  ends_at: number | null
}

export interface ShopRewards {
  daily_amount: number
  daily_streak: number
  daily_claimed: boolean
  bundles?: Record<string, BundleQuote>
}

export interface ShopInventory {
  catalog_hidden?: string[]
  catalog_items: OceanItem[]
  catalog_prices: Record<string, number | null>
  items: OceanItem[]
  balance: number
  plus_until: number
  currency?: boolean
  rewards?: ShopRewards
}

export interface GiftRow {
  id: string
  from: string
  to: string
  sender: string
  name: string
  kind: string
}

export interface GiftQuote {
  owned: boolean
  price: number
  affordable: boolean
}

/** A cart line. Bundles are bought as `promo_bundle` with their product id. */
export interface CartLine {
  key: string
  kind: string
  id: string
  hash: string
  owner: string
  name: string
  slot: string
  rarity: string
  bundle?: boolean
}

export interface ShopEntry extends CartLine {
  price: number | null
  owned: boolean
  plusOnly: boolean
  endsAt: number | null
}

export type ShopCategory = 'all' | 'bundle' | 'head' | 'back' | 'body' | 'name_tag' | 'cape' | 'aura' | 'trail' | 'emote' | 'pet'
export type ShopSort = 'featured' | 'price-asc' | 'price-desc' | 'name'

export const CART_LIMIT = 24
/** Ocean accepts gifts only for these kinds; bundles and trails cannot be gifted. */
const GIFT_KINDS = new Set(['model', 'cape', 'aura', 'emote', 'pet'])
const RARITY_ORDER: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 }

export const rarityOf = (value?: string): Rarity => (value && value in RARITY_ORDER ? (value as Rarity) : 'common')

export function lineKey(item: { kind: string; id: string; hash: string; bundle?: boolean }): string {
  return (item.bundle ? 'promo_bundle' : item.kind) + ':' + item.id + ':' + item.hash
}

export function lineOf(item: OceanItem): CartLine {
  return {
    key: lineKey(item),
    kind: item.kind,
    id: item.id,
    hash: item.hash,
    owner: item.owner,
    name: displayName(item.name, item.id),
    slot: item.slot,
    rarity: rarityOf(item.rarity),
  }
}

export function bundleLine(id: string): CartLine {
  return { key: lineKey({ kind: 'bundle', id, hash: '', bundle: true }), kind: 'bundle', id, hash: '', owner: '', name: displayName('', id), slot: 'bundle', rarity: 'legendary', bundle: true }
}

/** The product body Ocean's buy, quote and gift routes expect. */
export function productOf(line: CartLine) {
  return line.bundle ? { kind: 'promo_bundle', id: line.id, hash: '', owner: '' } : { kind: line.kind, id: line.id, hash: line.hash, owner: line.owner }
}

/** Ocean names some stock items by their id (`spooky_dance`); make those readable. */
export function displayName(name: string, id: string): string {
  const base = name && name !== id ? name : id.replace(/_bundle$/, ' bundle')
  const words = base.replace(/[_-]+/g, ' ').trim()
  if (!words) return id
  return name && name !== id ? words : words.replace(/\b\p{L}/gu, c => c.toUpperCase())
}

/** Same ownership rule as Ocean's `owns`: identical file, or same kind, id and creator (capes by file only). */
export function ownsItem(owned: readonly OceanItem[], line: Pick<CartLine, 'kind' | 'id' | 'hash' | 'owner'>): boolean {
  return owned.some(o => (line.hash !== '' && o.hash === line.hash) || (o.kind === line.kind && o.kind !== 'cape' && o.id === line.id && o.owner === line.owner))
}

/** Price in Shells; `null` means not for sale to this player (usually Turtle Plus only). */
export function priceOf(inv: ShopInventory, line: CartLine): number | null {
  if (line.bundle) return inv.rewards?.bundles?.[line.id]?.price ?? null
  const prices = inv.catalog_prices
  const key = line.kind === 'cape' ? 'cape:' + line.hash : line.kind + ':' + line.id
  if (key in prices) return prices[key]
  const byId = line.kind + ':' + line.id
  return byId in prices ? prices[byId] : null
}

export function isOwned(inv: ShopInventory, line: CartLine): boolean {
  return line.bundle ? !!inv.rewards?.bundles?.[line.id]?.owned : ownsItem(inv.items, line)
}

export const giftable = (line: CartLine) => !line.bundle && GIFT_KINDS.has(line.kind)

export function categoryOf(line: Pick<CartLine, 'kind' | 'slot' | 'bundle'>): ShopCategory {
  if (line.bundle) return 'bundle'
  if (line.kind === 'model') {
    if (line.slot === 'torso' || line.slot === 'shoulder') return 'body'
    if (line.slot === 'head' || line.slot === 'back' || line.slot === 'name_tag') return line.slot
    return 'head'
  }
  if (line.kind === 'cape' || line.kind === 'aura' || line.kind === 'trail' || line.kind === 'emote' || line.kind === 'pet') return line.kind
  return 'all'
}

/** Everything on sale plus the bundles Ocean quotes for this player. */
export function shopEntries(inv: ShopInventory): ShopEntry[] {
  const hidden = new Set(inv.catalog_hidden ?? [])
  const seen = new Set<string>()
  const rows: ShopEntry[] = []
  for (const [id, quote] of Object.entries(inv.rewards?.bundles ?? {})) {
    if (hidden.has('promo_bundle:' + id) || (quote.price === null && !quote.owned)) continue
    rows.push({ ...bundleLine(id), price: quote.price, owned: quote.owned, plusOnly: false, endsAt: quote.ends_at })
  }
  for (const item of inv.catalog_items) {
    const line = lineOf(item)
    if (seen.has(line.key) || hidden.has(item.kind + ':' + item.id)) continue
    seen.add(line.key)
    const owned = isOwned(inv, line)
    const price = priceOf(inv, line)
    rows.push({ ...line, price, owned, plusOnly: !owned && price === null, endsAt: null })
  }
  return rows
}

export interface ShopFilter {
  category: ShopCategory
  query: string
  sort: ShopSort
  affordable: boolean
  hideOwned: boolean
}

export function filterEntries(rows: readonly ShopEntry[], filter: ShopFilter, balance: number): ShopEntry[] {
  const query = filter.query.trim().toLowerCase()
  const list = rows.filter(row =>
    (filter.category === 'all' || categoryOf(row) === filter.category) &&
    (!query || row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query)) &&
    (!filter.affordable || (row.price !== null && row.price <= balance && !row.owned)) &&
    (!filter.hideOwned || !row.owned),
  )
  const price = (row: ShopEntry) => (row.price === null ? Number.POSITIVE_INFINITY : row.price)
  const rank = (row: ShopEntry) => (row.bundle ? 10 : 0) + (RARITY_ORDER[row.rarity] ?? 0)
  const byName = (a: ShopEntry, b: ShopEntry) => a.name.localeCompare(b.name)
  const sorters: Record<ShopSort, (a: ShopEntry, b: ShopEntry) => number> = {
    featured: (a, b) => Number(a.owned) - Number(b.owned) || rank(b) - rank(a) || price(b) - price(a) || byName(a, b),
    'price-asc': (a, b) => price(a) - price(b) || byName(a, b),
    'price-desc': (a, b) => (b.price ?? -1) - (a.price ?? -1) || byName(a, b),
    name: byName,
  }
  return [...list].sort(sorters[filter.sort])
}

export interface CartSummary {
  lines: (CartLine & { price: number | null; owned: boolean })[]
  total: number
  payable: number
  blocked: number
}

/** Owned lines cost nothing and are skipped at checkout; lines without a price block it. */
export function cartSummary(inv: ShopInventory | null, cart: readonly CartLine[]): CartSummary {
  const lines = cart.map(line => {
    const owned = inv ? isOwned(inv, line) : false
    return { ...line, owned, price: inv ? priceOf(inv, line) : null }
  })
  const open = lines.filter(line => !line.owned)
  return {
    lines,
    total: open.reduce((sum, line) => sum + (line.price ?? 0), 0),
    payable: open.filter(line => line.price !== null).length,
    blocked: open.filter(line => line.price === null).length,
  }
}

/** Only the fields that identify a product; prices always come fresh from Ocean. */
export function toLine(row: CartLine): CartLine {
  const { key, kind, id, hash, owner, name, slot, rarity, bundle } = row
  return { key, kind, id, hash, owner, name, slot, rarity, ...(bundle ? { bundle } : {}) }
}

export function addLine(cart: readonly CartLine[], line: CartLine): CartLine[] {
  if (cart.some(row => row.key === line.key) || cart.length >= CART_LIMIT) return [...cart]
  return [...cart, toLine(line)]
}

/** Ocean labels are 1 to 48 characters, trimmed, without control characters. */
export function giftLabel(name: string): string {
  const clean = Array.from(name.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, 48).join('').trim()
  return clean || 'Turtle gift'
}

/** Restores a saved cart without trusting its shape. */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return []
  try {
    const rows = JSON.parse(raw) as unknown
    if (!Array.isArray(rows)) return []
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    return rows
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map(r => {
        const line: CartLine = { key: '', kind: text(r.kind), id: text(r.id), hash: text(r.hash), owner: text(r.owner), name: text(r.name), slot: text(r.slot), rarity: rarityOf(text(r.rarity)), bundle: r.bundle === true }
        return { ...line, key: lineKey(line) }
      })
      .filter(line => line.id && line.kind)
      .slice(0, CART_LIMIT)
  } catch {
    return []
  }
}

/** Shop error codes from the native bridge, mapped to the shop's own texts. */
export function shopError(error: unknown): string {
  const code = String(error)
  if (code.includes('turtle_http_402')) return 'Turtle: not enough Shells for this purchase.'
  if (code.includes('turtle_http_409')) return 'Turtle: already owned, already gifted or the price changed. Reload and try again.'
  if (code.includes('turtle_http_403')) return 'Turtle: this item cannot be bought or gifted right now.'
  if (code.includes('turtle_http_404')) return 'Turtle: this item is no longer in the shop.'
  if (code.includes('turtle_http_507')) return 'Turtle: the shop is full right now. Please try again later.'
  if (code.includes('turtle_http_429')) return 'Turtle: too many requests. Please wait.'
  if (code.includes('turtle_shop_session_denied')) return 'Turtle: Minecraft did not confirm the shop sign-in. Check that online play is allowed for your account.'
  if (code.includes('login_required')) return 'Turtle: sign in with a Microsoft Minecraft account.'
  if (code.includes('native_required')) return 'Turtle: open the desktop launcher to use this feature.'
  return 'Turtle: the shop is not reachable right now. Check your connection and try again.'
}
