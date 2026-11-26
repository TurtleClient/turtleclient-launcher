import { useEffect } from 'react'
import { intlTag, useT } from '../../../i18n'
import { cartSummary } from '../../../lib/turtleShop'
import { clearCart, removeFromCart, useTurtleShop } from '../../../state/turtleShop'
import { Icon } from '../../Icon'
import { ShopArt } from './ShopArt'
import { ShellIcon, Shells } from './ShellIcon'
import { useKindLabel } from './ShopCard'

/** Side panel: every line with its current Ocean price, the total and the balance afterwards. */
export function CartDrawer({ open, onClose, onCheckout }: { open: boolean; onClose: () => void; onCheckout: () => void }) {
  const t = useT()
  const kind = useKindLabel()
  const locale = intlTag()
  const { cart, inventory, busy } = useTurtleShop()
  const summary = cartSummary(inventory, cart)
  const balance = inventory?.balance ?? 0
  const missing = Math.max(0, summary.total - balance)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <>
      <div className={'ts-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <aside className={'ts-drawer' + (open ? ' on' : '')} aria-label={t('Turtle: cart')} aria-hidden={!open} inert={!open}>
        <header className="ts-drawer-head">
          <h2><Icon id="i-mo-bag" />{t('Turtle: cart')}<span className="ts-count">{cart.length}</span></h2>
          <button className="btn sm secondary ts-ic-btn" onClick={onClose} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
        </header>
        {cart.length === 0 ? (
          <div className="ts-empty">
            <ShellIcon size={48} />
            <p>{t('Turtle: your cart is empty.')}</p>
          </div>
        ) : (
          <ul className="ts-lines">
            {summary.lines.map(line => (
              <li key={line.key} className={'ts-line r-' + line.rarity}>
                <span className="ts-line-art"><ShopArt line={line} /></span>
                <span className="ts-line-body">
                  <b title={line.name}>{line.name}</b>
                  <small>{kind(line)}</small>
                </span>
                <span className="ts-line-price">
                  {line.owned ? <small className="ok">{t('Turtle: owned')}</small> : line.price === null ? <small className="bad">{t('Turtle: not available')}</small> : <Shells amount={line.price} locale={locale} />}
                </span>
                <button className="ts-line-x" onClick={() => removeFromCart(line.key)} aria-label={t('Turtle: remove from cart') + ': ' + line.name}><Icon id="i-trash" /></button>
              </li>
            ))}
          </ul>
        )}
        <footer className="ts-drawer-foot">
          <div className="ts-sum"><span>{t('Turtle: total')}</span><Shells amount={summary.total} size={18} locale={locale} /></div>
          <div className="ts-sum faint"><span>{t('Turtle: your Shells')}</span><Shells amount={balance} locale={locale} /></div>
          <div className={'ts-sum faint' + (missing ? ' bad' : '')}><span>{t('Turtle: after purchase')}</span>{missing ? <span>{t('Turtle: {n} Shells missing', { n: missing.toLocaleString(locale) })}</span> : <Shells amount={balance - summary.total} locale={locale} />}</div>
          {summary.blocked ? <p className="faint-note">{t('Turtle: items marked as not available cannot be bought and will be skipped.')}</p> : null}
          <div className="ts-drawer-acts">
            <button className="btn md secondary" disabled={!cart.length || !!busy} onClick={clearCart}>{t('Turtle: clear cart')}</button>
            <button className="btn md primary" disabled={!summary.payable || !!busy || !inventory} onClick={onCheckout}>{t('Turtle: go to checkout')}</button>
          </div>
        </footer>
      </aside>
    </>
  )
}
