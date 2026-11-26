import { describe, expect, test } from 'bun:test'
import { addLine, bundleLine, cartSummary, categoryOf, displayName, filterEntries, giftLabel, giftable, lineOf, ownsItem, parseCart, priceOf, productOf, shopEntries, shopError, CART_LIMIT } from './turtleShop'
import type { OceanItem, ShopInventory } from './turtleShop'

const hash = (n: number) => n.toString(16).padStart(64, '0')
const halo: OceanItem = { id: 'angel_halo', name: 'Angel Halo', hash: hash(1), slot: 'head', owner: 'turtle', rarity: 'rare', kind: 'model' }
const wings: OceanItem = { id: 'demon_wings', name: 'Demon Wings', hash: hash(2), slot: 'back', owner: 'turtle', rarity: 'epic', kind: 'model' }
const cape: OceanItem = { id: hash(3), name: 'Cape', hash: hash(3), slot: 'cape', owner: '00000000-0000-0000-0000-000000000003', rarity: 'common', kind: 'cape' }
const dance: OceanItem = { id: 'spooky_dance', name: 'spooky_dance', hash: hash(4), slot: 'emote', owner: 'turtle', rarity: 'legendary', kind: 'emote' }
const trail: OceanItem = { id: 'frost_paw_trail', name: 'Frost Paw Trail', hash: hash(5), slot: 'trail', owner: 'turtle', rarity: 'rare', kind: 'trail' }

const inventory = (patch: Partial<ShopInventory> = {}): ShopInventory => ({
  catalog_items: [halo, wings, cape, dance, trail],
  catalog_prices: { 'model:angel_halo': 400, 'model:demon_wings': 900, ['cape:' + hash(3)]: 250, ['cape:' + hash(3) + 'x']: 1, 'emote:spooky_dance': null, 'trail:frost_paw_trail': 300 },
  items: [],
  balance: 1000,
  plus_until: 0,
  rewards: { daily_amount: 25, daily_streak: 2, daily_claimed: false, bundles: { angel_bundle: { price: 1500, owned: false, ends_at: null }, demon_bundle: { price: null, owned: false, ends_at: null } } },
  ...patch,
})

describe('prices and ownership follow Ocean', () => {
  test('capes are priced by file, other items by kind and id', () => {
    expect(priceOf(inventory(), lineOf(cape))).toBe(250)
    expect(priceOf(inventory(), lineOf(halo))).toBe(400)
    expect(priceOf(inventory(), bundleLine('angel_bundle'))).toBe(1500)
  })
  test('a missing price means not for sale, never free', () => {
    expect(priceOf(inventory(), lineOf(dance))).toBeNull()
    expect(priceOf(inventory({ catalog_prices: {} }), lineOf(halo))).toBeNull()
  })
  test('ownership matches the same file or the same kind, id and creator, capes only by file', () => {
    expect(ownsItem([halo], { ...lineOf(halo), hash: hash(9) })).toBe(true)
    expect(ownsItem([{ ...cape, hash: hash(8) }], lineOf(cape))).toBe(false)
    expect(ownsItem([cape], lineOf(cape))).toBe(true)
    expect(ownsItem([{ ...halo, owner: 'someone' , hash: hash(7) }], lineOf(halo))).toBe(false)
  })
})

describe('shop listing', () => {
  test('lists buyable bundles first and drops unpriced bundles and hidden items', () => {
    const rows = shopEntries(inventory({ catalog_hidden: ['model:demon_wings'] }))
    expect(rows.map(r => r.id)).toEqual(['angel_bundle', 'angel_halo', hash(3), 'spooky_dance', 'frost_paw_trail'])
    expect(rows.find(r => r.id === 'spooky_dance')?.plusOnly).toBe(true)
  })
  test('categories map wardrobe slots and kinds', () => {
    expect(categoryOf(lineOf(wings))).toBe('back')
    expect(categoryOf({ kind: 'model', slot: 'torso' })).toBe('body')
    expect(categoryOf(bundleLine('husky_bundle'))).toBe('bundle')
    expect(categoryOf(lineOf(dance))).toBe('emote')
  })
  test('filters by category, search, budget and sorts by price', () => {
    const rows = shopEntries(inventory())
    const base = { category: 'all' as const, query: '', sort: 'price-asc' as const, affordable: false, hideOwned: false }
    expect(filterEntries(rows, { ...base, category: 'head' }, 1000).map(r => r.id)).toEqual(['angel_halo'])
    expect(filterEntries(rows, { ...base, query: 'wing' }, 1000).map(r => r.id)).toEqual(['demon_wings'])
    expect(filterEntries(rows, { ...base, affordable: true }, 500).map(r => r.id)).toEqual([hash(3), 'frost_paw_trail', 'angel_halo'])
    expect(filterEntries(rows, { ...base, sort: 'price-desc' }, 0)[0].id).toBe('angel_bundle')
  })
})

describe('cart', () => {
  test('owned lines are free and unpriced lines block checkout', () => {
    const cart = [lineOf(halo), lineOf(wings), lineOf(dance)]
    const summary = cartSummary(inventory({ items: [halo] }), cart)
    expect(summary.total).toBe(900)
    expect(summary.payable).toBe(1)
    expect(summary.blocked).toBe(1)
  })
  test('adding is idempotent, capped and keeps no prices', () => {
    const entry = shopEntries(inventory()).find(r => r.id === 'angel_halo')!
    expect(Object.keys(addLine([], entry)[0])).not.toContain('price')
    const once = addLine([], lineOf(halo))
    expect(addLine(once, lineOf(halo))).toHaveLength(1)
    let full = once
    for (let i = 0; i < CART_LIMIT + 5; i++) full = addLine(full, { ...lineOf(halo), id: 'x' + i, key: 'k' + i })
    expect(full).toHaveLength(CART_LIMIT)
  })
  test('a saved cart is rebuilt from known fields only', () => {
    const saved = JSON.stringify([{ ...lineOf(halo), key: 'forged', extra: 1 }, 'junk', { kind: '', id: 'x' }])
    const rows = parseCart(saved)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('model:angel_halo:' + hash(1))
    expect(parseCart('{')).toEqual([])
  })
  test('bundles are bought as promo bundles', () => {
    expect(productOf(bundleLine('angel_bundle'))).toEqual({ kind: 'promo_bundle', id: 'angel_bundle', hash: '', owner: '' })
    expect(productOf(lineOf(cape))).toEqual({ kind: 'cape', id: hash(3), hash: hash(3), owner: cape.owner })
  })
})

describe('gifts and texts', () => {
  test('only kinds Ocean accepts can be gifted', () => {
    expect(giftable(lineOf(halo))).toBe(true)
    expect(giftable(lineOf(trail))).toBe(false)
    expect(giftable(bundleLine('angel_bundle'))).toBe(false)
  })
  test('gift labels fit Ocean limits', () => {
    expect(giftLabel('  Angel\u0007 Halo  ')).toBe('Angel Halo')
    expect(Array.from(giftLabel('x'.repeat(80)))).toHaveLength(48)
    expect(giftLabel('   ')).toBe('Turtle gift')
  })
  test('stock ids become readable names', () => {
    expect(displayName('spooky_dance', 'spooky_dance')).toBe('Spooky Dance')
    expect(displayName('', 'husky_bundle')).toBe('Husky Bundle')
    expect(displayName('construction helmet', 'construction_helmet')).toBe('construction helmet')
  })
  test('server refusals get shop texts', () => {
    expect(shopError('turtle_http_402')).toContain('not enough Shells')
    expect(shopError('turtle_shop_session_denied')).toContain('online play')
    expect(shopError(new Error('boom'))).toContain('not reachable')
  })
})
