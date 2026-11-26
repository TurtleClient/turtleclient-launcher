import { useEffect, useMemo, useState } from 'react'
import { intlTag, useT } from '../../i18n'
import { cartSummary, categoryOf, filterEntries, lineOf, shopEntries } from '../../lib/turtleShop'
import type { CartLine, ShopCategory, ShopFilter, ShopSort } from '../../lib/turtleShop'
import { useAccounts } from '../../state/accounts'
import { addToCart, claimDaily, refreshShop, removeFromCart, selectShopAccount, useTurtleShop } from '../../state/turtleShop'
import { Icon } from '../Icon'
import { TopbarPortal } from '../TopbarPortal'
import { CartDrawer } from './turtle/CartDrawer'
import { CheckoutDialog } from './turtle/CheckoutDialog'
import { GiftDialog } from './turtle/GiftDialog'
import { GiftInbox } from './turtle/GiftInbox'
import { ShellIcon, Shells } from './turtle/ShellIcon'
import { ShopArt } from './turtle/ShopArt'
import { ShopCard, useKindLabel } from './turtle/ShopCard'
import { TurtleCatalog } from './TurtleCatalog'
import '../../styles/pixel/shop2.css'
import '../../styles/pixel/turtle-shop.css'

type Tab = 'shop' | 'mine' | 'gifts' | 'free'

/** Turtle shop: Shells balance, Ocean catalog, cart, checkout and gifts for the active Microsoft account. */
export function TurtleShop({ on }: { on: boolean }) {
  const t = useT()
  const locale = intlTag()
  const kind = useKindLabel()
  const { list, active } = useAccounts()
  const account = list.find(a => a.id === active) || list[0]
  const accountId = account?.kind === 'microsoft' ? account.id : null
  const { inventory, cart, gifts, me, loading, error, busy, bump } = useTurtleShop()
  const [tab, setTab] = useState<Tab>('shop')
  const [filter, setFilter] = useState<ShopFilter>({ category: 'all', query: '', sort: 'featured', affordable: false, hideOwned: false })
  const [drawer, setDrawer] = useState(false)
  const [paying, setPaying] = useState(false)
  const [gift, setGift] = useState<CartLine | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (on) selectShopAccount(accountId)
  }, [on, accountId])
  useEffect(() => {
    if (!on || !accountId) return
    const timer = setInterval(() => void refreshShop(), 60_000)
    return () => clearInterval(timer)
  }, [on, accountId])

  const entries = useMemo(() => (inventory ? shopEntries(inventory) : []), [inventory])
  const balance = inventory?.balance ?? 0
  const visible = useMemo(() => filterEntries(entries, filter, balance), [entries, filter, balance])
  const bundles = visible.filter(e => e.bundle)
  const items = visible.filter(e => !e.bundle)
  const inCart = new Set(cart.map(l => l.key))
  const received = gifts.filter(g => g.to === me).length
  const plusUntil = inventory && inventory.plus_until * 1000 > Date.now() ? new Date(inventory.plus_until * 1000).toLocaleDateString(locale) : ''
  const rewards = inventory?.rewards
  const owned = inventory?.items.filter(i => i.kind !== 'team_cape').map(lineOf) ?? []

  const toggleCart = (line: CartLine) => (inCart.has(line.key) ? removeFromCart(line.key) : addToCart(line))
  const patch = (next: Partial<ShopFilter>) => setFilter(f => ({ ...f, ...next }))
  async function daily() {
    setNotice('')
    const failure = await claimDaily()
    setNotice(failure ? t(failure) : t('Turtle: daily reward claimed. Come back tomorrow.'))
  }

  const categories: [ShopCategory, string, string][] = [
    ['all', 'i-grid', t('Turtle: all items')],
    ['bundle', 'i-box', t('Turtle: bundles')],
    ['head', 'i-hat', t('Turtle: head')],
    ['back', 'i-wings', t('Turtle: back')],
    ['body', 'i-shirt', t('Turtle: body')],
    ['name_tag', 'i-edit', t('Turtle: name tags')],
    ['cape', 'i-cape', t('Turtle: capes')],
    ['aura', 'i-sparkle', t('Turtle: auras')],
    ['trail', 'i-flame', t('Turtle: trails')],
    ['emote', 'i-hand', t('Turtle: emotes')],
    ['pet', 'i-paw', t('Turtle: pets')],
  ]
  const present = new Set(entries.map(categoryOf))
  const tabs: [Tab, string, string, number][] = [
    ['shop', 'i-ws-shop', t('Turtle: shop'), 0],
    ['mine', 'i-backpack', t('Turtle: my collection'), 0],
    ['gifts', 'i-gift', t('Turtle: gifts'), received],
    ['free', 'i-star', t('Turtle: free items'), 0],
  ]

  return (
    <div className="ts">
      {accountId ? (
        <TopbarPortal>
          <div className="tb-actions ts-top">
            <span className={'ts-bal' + (bump ? ' bump' : '')} key={bump} data-tip={t('Turtle: your Shells')}>
              <ShellIcon size={22} />
              <b>{inventory ? balance.toLocaleString(locale) : '—'}</b>
            </span>
            <button className="btn sm secondary ts-top-cart" onClick={() => setDrawer(true)} aria-label={t('Turtle: cart')} data-tip={t('Turtle: cart')}>
              <Icon id="i-mo-bag" />
              {cart.length ? <span className="ts-badge">{cart.length}</span> : null}
            </button>
          </div>
        </TopbarPortal>
      ) : null}

      <header className="card ts-hero">
        <div className="ts-hero-copy">
          <span className="ts-eyebrow">TurtleClient</span>
          <h1>{t('Turtle: Turtle Shop')}</h1>
          <p>{t('Turtle: cosmetics for your Turtle wardrobe. Everything you buy stays on your Minecraft account.')}</p>
        </div>
        {accountId ? (
          <div className="ts-wallet">
            <span className="ts-wallet-label">{t('Turtle: your Shells')}</span>
            <span className={'ts-wallet-bal' + (bump ? ' bump' : '')} key={'w' + bump}>
              <ShellIcon size={34} />
              <b>{inventory ? balance.toLocaleString(locale) : loading ? '…' : '—'}</b>
            </span>
            {plusUntil ? <span className="ts-chip is-plus"><Icon id="i-crown" />{t('Turtle: Turtle Plus active until {date}', { date: plusUntil })}</span> : null}
            {rewards && rewards.daily_amount > 0 ? (
              rewards.daily_claimed ? (
                <span className="ts-chip"><Icon id="i-check" />{t('Turtle: daily reward claimed')}{rewards.daily_streak > 1 ? ' · ' + t('Turtle: {n}-day streak', { n: rewards.daily_streak }) : ''}</span>
              ) : (
                <button className="btn sm primary ts-daily" disabled={busy === 'daily'} onClick={() => void daily()}>
                  <Icon id="i-gift" />
                  {t('Turtle: claim daily reward · +{n}', { n: rewards.daily_amount })}
                </button>
              )
            ) : null}
            {notice ? <span className="ts-note" role="status">{notice}</span> : null}
          </div>
        ) : null}
      </header>

      <nav className="ts-tabs" aria-label={t('Turtle: Turtle Shop')}>
        {tabs.map(([id, icon, label, badge]) => (
          <button key={id} className={'sv-chip' + (tab === id ? ' on' : '')} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon id={icon} />
            {label}
            {badge ? <span className="ts-badge">{badge}</span> : null}
          </button>
        ))}
        {accountId ? (
          <button className="btn sm secondary ts-refresh" disabled={loading} onClick={() => void refreshShop()}>
            <Icon id="i-restart" />
            {t('Turtle: refresh')}
          </button>
        ) : null}
      </nav>

      {tab === 'free' ? (
        <TurtleCatalog />
      ) : !accountId ? (
        <div className="card ts-empty-card">
          <ShellIcon size={56} />
          <p>{t('Turtle: the shop needs a Microsoft Minecraft account. Free items are available in the Free tab.')}</p>
        </div>
      ) : error && !inventory ? (
        <div className="card ts-empty-card">
          <Icon id="i-alert" className="icon ts-empty-ic" />
          <p role="alert">{t(error)}</p>
          <button className="btn md primary" disabled={loading} onClick={() => void refreshShop()}>{t('Turtle: refresh')}</button>
        </div>
      ) : !inventory ? (
        <div className="ts-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="ts-card is-skeleton" />)}
          <p className="ts-sr" role="status">{t('Turtle: loading shop…')}</p>
        </div>
      ) : tab === 'gifts' ? (
        <GiftInbox />
      ) : tab === 'mine' ? (
        owned.length ? (
          <>
            <p className="faint-note">{t('Turtle: equip new items in the client wardrobe with Right Shift.')}</p>
            <div className="ts-grid">
              {owned.map(line => (
                <article key={line.key} className={'ts-card is-owned r-' + line.rarity}>
                  <div className="ts-card-art"><ShopArt line={line} /></div>
                  <div className="ts-card-body"><span className="ts-kind">{kind(line)}</span><h3 title={line.name}>{line.name}</h3></div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="card ts-empty-card">
            <Icon id="i-backpack" className="icon ts-empty-ic" />
            <p>{t('Turtle: you do not own any shop items yet.')}</p>
          </div>
        )
      ) : (
        <>
          {error ? <p className="ts-alert" role="alert">{t(error)}</p> : null}
          <div className="ts-tools">
            <div className="ts-cats" role="toolbar" aria-label={t('Turtle: categories')}>
              {categories.filter(([id]) => id === 'all' || present.has(id)).map(([id, icon, label]) => (
                <button key={id} className={'sv-chip' + (filter.category === id ? ' on' : '')} aria-pressed={filter.category === id} onClick={() => patch({ category: id })}>
                  <Icon id={icon} />
                  {label}
                </button>
              ))}
            </div>
            <div className="ts-search-row">
              <label className="input sm ts-search">
                <Icon id="i-search" />
                <input type="search" placeholder={t('Turtle: search items')} aria-label={t('Turtle: search items')} value={filter.query} maxLength={48} onChange={e => patch({ query: e.target.value })} />
              </label>
              <select className="input sm ts-sort" aria-label={t('Turtle: sort')} value={filter.sort} onChange={e => patch({ sort: e.target.value as ShopSort })}>
                <option value="featured">{t('Turtle: featured')}</option>
                <option value="price-asc">{t('Turtle: price: low to high')}</option>
                <option value="price-desc">{t('Turtle: price: high to low')}</option>
                <option value="name">{t('Turtle: name')}</option>
              </select>
              <label className="ts-toggle"><input type="checkbox" checked={filter.affordable} onChange={e => patch({ affordable: e.target.checked })} />{t('Turtle: affordable only')}</label>
              <label className="ts-toggle"><input type="checkbox" checked={filter.hideOwned} onChange={e => patch({ hideOwned: e.target.checked })} />{t('Turtle: hide owned')}</label>
            </div>
          </div>

          {bundles.length ? (
            <section className="ts-sec">
              <h2>{t('Turtle: bundles')}</h2>
              <div className="ts-grid is-wide">
                {bundles.map(entry => <ShopCard key={entry.key} entry={entry} balance={balance} inCart={inCart.has(entry.key)} onCart={() => toggleCart(entry)} onGift={() => setGift(entry)} />)}
              </div>
            </section>
          ) : null}
          {items.length ? (
            <section className="ts-sec">
              {bundles.length ? <h2>{t('Turtle: items')}</h2> : null}
              <div className="ts-grid">
                {items.map(entry => <ShopCard key={entry.key} entry={entry} balance={balance} inCart={inCart.has(entry.key)} onCart={() => toggleCart(entry)} onGift={() => setGift(entry)} />)}
              </div>
            </section>
          ) : null}
          {!visible.length ? (
            <div className="card ts-empty-card">
              <Icon id="i-search" className="icon ts-empty-ic" />
              <p>{entries.length ? t('Turtle: no items match your filters.') : t('Turtle: no items yet.')}</p>
            </div>
          ) : null}
        </>
      )}

      {cart.length && accountId && !drawer ? (
        <button className="ts-cart-fab" onClick={() => setDrawer(true)}>
          <Icon id="i-mo-bag" />
          <span>{t('Turtle: cart')}</span>
          <span className="ts-badge">{cart.length}</span>
          {inventory ? <Shells amount={cartSummary(inventory, cart).total} locale={locale} /> : null}
        </button>
      ) : null}

      {accountId ? <CartDrawer open={drawer && on} onClose={() => setDrawer(false)} onCheckout={() => { setDrawer(false); setPaying(true) }} /> : null}
      {paying && on ? <CheckoutDialog onClose={() => setPaying(false)} /> : null}
      {gift && on ? <GiftDialog line={gift} onClose={() => setGift(null)} /> : null}
    </div>
  )
}
