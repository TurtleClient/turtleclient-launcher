import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'
import { addLine, cartSummary, giftLabel, giftable, parseCart, productOf, shopError } from '../lib/turtleShop'
import type { CartLine, GiftQuote, GiftRow, ShopInventory, TurtlePet } from '../lib/turtleShop'
import { useAccounts } from './accounts'

/** Result of one checkout line: bought, gifted, skipped (already owned) or failed with a shop text. */
export interface CheckoutResult {
  key: string
  name: string
  status: 'bought' | 'gifted' | 'skipped' | 'failed'
  error?: string
}

interface ShopState {
  accountId: string | null
  inventory: ShopInventory | null
  me: string
  gifts: GiftRow[]
  cart: CartLine[]
  loading: boolean
  error: string
  busy: string | null
  bump: number
}

export const useTurtleShop = create<ShopState>(() => ({ accountId: null, inventory: null, me: '', gifts: [], cart: [], loading: false, error: '', busy: null, bump: 0 }))

const CART_KEY = 'turtle-shop-cart:'
let generation = 0

function readCart(accountId: string | null): CartLine[] {
  if (!accountId) return []
  try {
    return parseCart(localStorage.getItem(CART_KEY + accountId))
  } catch {
    return []
  }
}

function saveCart(cart: CartLine[]) {
  const { accountId } = useTurtleShop.getState()
  useTurtleShop.setState({ cart })
  if (!accountId) return
  try {
    if (cart.length) localStorage.setItem(CART_KEY + accountId, JSON.stringify(cart))
    else localStorage.removeItem(CART_KEY + accountId)
  } catch {
    // The cart is a convenience; a blocked storage only loses it on restart.
  }
}

const call = <T,>(action: string, args: Record<string, unknown> = {}) => {
  const accountId = useTurtleShop.getState().accountId
  return accountId ? turtle<T>('turtle_shop', { accountId, action, ...args }) : Promise.reject(new Error('turtle_login_required'))
}

function setInventory(inventory: ShopInventory) {
  const before = useTurtleShop.getState().inventory?.balance
  useTurtleShop.setState(s => ({ inventory, bump: before !== undefined && before !== inventory.balance ? s.bump + 1 : s.bump }))
}

/** Microsoft accounts only: Ocean verifies the player through the Minecraft session service. */
export function selectShopAccount(accountId: string | null) {
  if (useTurtleShop.getState().accountId === accountId) return
  generation++
  useTurtleShop.setState({ accountId, inventory: null, me: '', gifts: [], cart: readCart(accountId), loading: false, error: '', busy: null })
  if (accountId) void refreshShop()
}

export async function refreshShop() {
  const current = generation
  if (!useTurtleShop.getState().accountId) return
  useTurtleShop.setState({ loading: true, error: '' })
  try {
    const [inventory, exchange] = await Promise.all([call<ShopInventory>('inventory'), call<{ me: string; gifts: GiftRow[] }>('gifts').catch(() => null)])
    if (current !== generation) return
    setInventory(inventory)
    if (exchange) useTurtleShop.setState({ me: exchange.me, gifts: exchange.gifts })
  } catch (e) {
    if (current === generation) useTurtleShop.setState({ error: shopError(e) })
  } finally {
    if (current === generation) useTurtleShop.setState({ loading: false })
  }
}

/**
 * Keeps Ocean's inventory for the active Microsoft account loaded app-wide: Home and the
 * wardrobe show what the player owns and wears even before the shop was opened.
 */
export function watchTurtleShop() {
  const select = () => {
    const { list, active } = useAccounts.getState()
    const account = list.find(a => a.id === active) || list[0]
    selectShopAccount(account?.kind === 'microsoft' ? account.id : null)
  }
  const unsubscribe = useAccounts.subscribe(select)
  select()
  const timer = setInterval(() => {
    if (!document.hidden) void refreshShop()
  }, 120_000)
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}

/**
 * Wear or take off an owned model, aura or trail. Body slots hold up to three models;
 * aura, trail and name tag one each (Ocean replaces the previous one).
 */
export async function wearShopItem(slot: string, hash: string | null, equipped?: boolean): Promise<string> {
  const current = generation
  useTurtleShop.setState({ busy: 'wear:' + (hash || slot) })
  try {
    await call('equip', { slot, hash, equipped })
    if (current === generation) await refreshShop()
    return ''
  } catch (e) {
    return String(e).includes('turtle_http_409') ? 'Turtle: at most three items can be worn on one body part.' : shopError(e)
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}

/** MiniMe follows the player as a small copy of them; `null` puts it away. */
export async function setShopPet(pet: TurtlePet | null): Promise<string> {
  const current = generation
  useTurtleShop.setState({ busy: 'pet' })
  try {
    await call('pet', { pet })
    if (current === generation) await refreshShop()
    return ''
  } catch (e) {
    return shopError(e)
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}

export const addToCart = (line: CartLine) => saveCart(addLine(useTurtleShop.getState().cart, line))
export const removeFromCart = (key: string) => saveCart(useTurtleShop.getState().cart.filter(line => line.key !== key))
export const clearCart = () => saveCart([])

export async function claimDaily(): Promise<string> {
  const current = generation
  useTurtleShop.setState({ busy: 'daily' })
  try {
    const inventory = await call<ShopInventory>('daily')
    if (current === generation) setInventory(inventory)
    return ''
  } catch (e) {
    return shopError(e)
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}

export function quoteGift(peer: string, line: CartLine): Promise<GiftQuote> {
  return call<GiftQuote>('quote', { peer, product: productOf(line) })
}

/** Gift prices for a whole cart, quoted before the player confirms. */
export async function quoteCart(peer: string): Promise<Record<string, GiftQuote | string>> {
  const { cart } = useTurtleShop.getState()
  const rows = await Promise.all(
    cart.map(async line => {
      if (!giftable(line)) return [line.key, 'Turtle: bundles and trails cannot be gifted.'] as const
      try {
        return [line.key, await quoteGift(peer, line)] as const
      } catch (e) {
        return [line.key, shopError(e)] as const
      }
    }),
  )
  return Object.fromEntries(rows)
}

/**
 * Buys the cart line by line, or sends each line as a gift when a friend is chosen.
 * Gifts use the quoted price the player confirmed; Ocean refuses a changed price.
 * A refusal stops only its line, an empty wallet stops the rest.
 */
export async function checkout(gift: { peer: string; quotes: Record<string, GiftQuote | string> } | null, onStep?: (results: CheckoutResult[]) => void): Promise<CheckoutResult[]> {
  const peer = gift?.peer ?? null
  const current = generation
  const results: CheckoutResult[] = []
  const report = (result: CheckoutResult) => {
    results.push(result)
    onStep?.([...results])
  }
  useTurtleShop.setState({ busy: 'checkout' })
  try {
    const { cart, inventory } = useTurtleShop.getState()
    const lines = cartSummary(inventory, cart).lines
    let broke = false
    for (const line of lines) {
      if (current !== generation) break
      if (broke) {
        report({ key: line.key, name: line.name, status: 'failed', error: 'Turtle: not enough Shells for this purchase.' })
        continue
      }
      if (!peer && line.owned) {
        report({ key: line.key, name: line.name, status: 'skipped' })
        continue
      }
      const quote = gift?.quotes[line.key]
      if (peer && (!giftable(line) || !quote || typeof quote === 'string')) {
        report({ key: line.key, name: line.name, status: 'failed', error: typeof quote === 'string' ? quote : 'Turtle: bundles and trails cannot be gifted.' })
        continue
      }
      try {
        if (peer && quote && typeof quote !== 'string') {
          if (quote.owned) {
            report({ key: line.key, name: line.name, status: 'failed', error: 'Turtle: your friend already owns this or has it waiting as a gift.' })
            continue
          }
          if (!quote.affordable) throw new Error('turtle_http_402')
          await call('gift', { peer, id: crypto.randomUUID(), name: giftLabel(line.name), product: productOf(line), agreed: quote.price })
          report({ key: line.key, name: line.name, status: 'gifted' })
        } else {
          const next = await call<ShopInventory>('buy', { product: productOf(line) })
          if (current === generation) setInventory(next)
          report({ key: line.key, name: line.name, status: 'bought' })
        }
        if (current === generation) saveCart(useTurtleShop.getState().cart.filter(row => row.key !== line.key))
      } catch (e) {
        const error = shopError(e)
        if (String(e).includes('turtle_http_402')) broke = true
        report({ key: line.key, name: line.name, status: 'failed', error })
      }
    }
    if (current === generation) {
      // Gifts and refunds change the wallet outside the buy response.
      await refreshShop()
    }
    return results
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}

export async function sendGift(peer: string, line: CartLine, quote: GiftQuote): Promise<string> {
  const current = generation
  useTurtleShop.setState({ busy: 'gift' })
  try {
    await call('gift', { peer, id: crypto.randomUUID(), name: giftLabel(line.name), product: productOf(line), agreed: quote.price })
    if (current === generation) await refreshShop()
    return ''
  } catch (e) {
    return shopError(e)
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}

/** Accepting adds the item to the wardrobe; declining (or withdrawing your own gift) refunds the sender. */
export async function answerGift(id: string, accept: boolean): Promise<string> {
  const current = generation
  useTurtleShop.setState({ busy: 'answer:' + id })
  try {
    await call('answer', { id, accept })
    if (current === generation) await refreshShop()
    return ''
  } catch (e) {
    return shopError(e)
  } finally {
    if (current === generation) useTurtleShop.setState({ busy: null })
  }
}
