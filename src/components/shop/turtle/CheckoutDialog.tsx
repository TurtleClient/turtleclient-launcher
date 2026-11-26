import { useEffect, useRef, useState } from 'react'
import { intlTag, useT } from '../../../i18n'
import { backdropClose } from '../../../lib/dismiss'
import { cartSummary, giftable } from '../../../lib/turtleShop'
import type { GiftQuote } from '../../../lib/turtleShop'
import { checkout, quoteCart, useTurtleShop } from '../../../state/turtleShop'
import type { CheckoutResult } from '../../../state/turtleShop'
import { useTurtleFriends } from '../../../state/turtleFriends'
import { Head } from '../../Head'
import { Icon } from '../../Icon'
import { ShopArt } from './ShopArt'
import { Shells } from './ShellIcon'

type Step = 'review' | 'running' | 'done'

/** One window for buying the cart for yourself or sending it to a friend as gifts. */
export function CheckoutDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const locale = intlTag()
  const { cart, inventory, accountId } = useTurtleShop()
  const friendsState = useTurtleFriends()
  const friends = friendsState.accountId === accountId && friendsState.connected ? friendsState.data.friends : []
  const [mode, setMode] = useState<'self' | 'gift'>('self')
  const [peer, setPeer] = useState('')
  const [quotes, setQuotes] = useState<Record<string, GiftQuote | string> | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [step, setStep] = useState<Step>('review')
  const [results, setResults] = useState<CheckoutResult[]>([])
  const [message, setMessage] = useState('')
  const asked = useRef(0)

  const summary = cartSummary(inventory, cart)
  const balance = inventory?.balance ?? 0
  const gift = mode === 'gift'
  const friend = friends.find(f => f.uuid === peer)

  useEffect(() => {
    setQuotes(null)
    if (!gift || !peer) return
    const ask = ++asked.current
    setQuoting(true)
    void quoteCart(peer)
      .then(next => ask === asked.current && setQuotes(next))
      .finally(() => ask === asked.current && setQuoting(false))
  }, [gift, peer, cart.length])

  const giftRows = summary.lines.map(line => {
    const quote = quotes?.[line.key]
    const ok = !!quote && typeof quote !== 'string' && !quote.owned
    const note = !giftable(line) ? t('Turtle: bundles and trails cannot be gifted.') : typeof quote === 'string' ? t(quote) : quote?.owned ? t('Turtle: your friend already owns this or has it waiting as a gift.') : ''
    return { line, price: ok ? (quote as GiftQuote).price : null, note }
  })
  const total = gift ? giftRows.reduce((sum, row) => sum + (row.price ?? 0), 0) : summary.total
  const count = gift ? giftRows.filter(row => row.price !== null).length : summary.payable
  const short = total > balance
  const ready = count > 0 && !short && (!gift || (!!peer && !!quotes && !quoting))

  async function confirm() {
    if (!ready) return
    setStep('running')
    setResults([])
    await checkout(gift ? { peer, quotes: quotes ?? {}, message } : null, setResults)
    setStep('done')
  }

  const close = () => step !== 'running' && onClose()
  const done = results.filter(r => r.status === 'bought' || r.status === 'gifted').length
  const statusText = (r: CheckoutResult) =>
    r.status === 'bought' ? t('Turtle: bought') : r.status === 'gifted' ? t('Turtle: gifted') : r.status === 'skipped' ? t('Turtle: already owned') : t(r.error || 'Turtle: failed')

  return (
    <div className="modal-bg open vis" style={{ zIndex: 960 }} {...backdropClose(close)}>
      <div className="modal mw-md ts-checkout" role="dialog" aria-modal="true" aria-labelledby="ts-checkout-title">
        <div className="ts-modal-head">
          <h3 id="ts-checkout-title"><Icon id="i-wallet" />{step === 'done' ? (gift ? t('Turtle: gifts sent') : t('Turtle: purchase complete')) : t('Turtle: checkout')}</h3>
          <button className="btn sm secondary ts-ic-btn" onClick={close} disabled={step === 'running'} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
        </div>

        {step === 'review' ? (
          <>
            <div className="ts-seg" role="radiogroup" aria-label={t('Turtle: who is it for?')}>
              <button role="radio" aria-checked={!gift} className={!gift ? 'on' : ''} onClick={() => setMode('self')}><Icon id="i-user" />{t('Turtle: for me')}</button>
              <button role="radio" aria-checked={gift} className={gift ? 'on' : ''} onClick={() => setMode('gift')}><Icon id="i-gift" />{t('Turtle: as a gift for a friend')}</button>
            </div>
            {gift ? (
              friends.length ? (
                <div className="ts-friends" role="radiogroup" aria-label={t('Turtle: choose a friend')}>
                  {friends.map(f => (
                    <button key={f.uuid} role="radio" aria-checked={peer === f.uuid} className={'ts-friend' + (peer === f.uuid ? ' on' : '')} onClick={() => setPeer(f.uuid)}>
                      <Head nick={f.name} size={28} />
                      <span>{f.name}</span>
                      {f.online ? <i className="ts-dot" aria-label={t('Turtle: online')} /> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="faint-note">{t('Turtle: no friends yet. Add friends on the Friends page to send gifts.')}</p>
              )
            ) : null}
            <ul className="ts-lines compact">
              {(gift ? giftRows : summary.lines.map(line => ({ line, price: line.owned ? null : line.price, note: line.owned ? t('Turtle: already owned') : line.price === null ? t('Turtle: not available') : '' }))).map(({ line, price, note }) => (
                <li key={line.key} className={'ts-line r-' + line.rarity + (note ? ' is-off' : '')}>
                  <span className="ts-line-art"><ShopArt line={line} /></span>
                  <span className="ts-line-body"><b title={line.name}>{line.name}</b>{note ? <small>{note}</small> : null}</span>
                  <span className="ts-line-price">{gift && peer && quoting ? <small>{t('Turtle: checking price…')}</small> : price !== null ? <Shells amount={price} locale={locale} /> : null}</span>
                </li>
              ))}
            </ul>
            {!gift || peer ? (
              <div className="ts-totals">
                <div className="ts-sum"><span>{t('Turtle: total')}</span><Shells amount={total} size={18} locale={locale} /></div>
                <div className="ts-sum faint"><span>{t('Turtle: your Shells')}</span><Shells amount={balance} locale={locale} /></div>
                <div className={'ts-sum faint' + (short ? ' bad' : '')}><span>{t('Turtle: after purchase')}</span>{short ? <span>{t('Turtle: {n} Shells missing', { n: (total - balance).toLocaleString(locale) })}</span> : <Shells amount={balance - total} locale={locale} />}</div>
              </div>
            ) : null}
            {gift && peer ? (
              <label className="ts-message">
                <span>{t('Turtle: message for {name}', { name: friend?.name || '' })}</span>
                <textarea value={message} maxLength={140} rows={2} placeholder={t('Turtle: write a few words (optional)')} onChange={e => setMessage(e.target.value)} />
                <small>{message.length}/140</small>
              </label>
            ) : null}
            {gift ? <p className="faint-note">{t('Turtle: your friend must accept each gift. If they decline, you get your Shells back.')}</p> : null}
            <div className="ts-modal-acts">
              <button className="btn md secondary" onClick={close}>{t('Turtle: cancel')}</button>
              <button className="btn md primary" disabled={!ready} onClick={() => void confirm()}>
                {gift && !peer ? t('Turtle: choose a friend') : gift ? t('Turtle: send gifts for {n} Shells', { n: total.toLocaleString(locale) }) : t('Turtle: buy for {n} Shells', { n: total.toLocaleString(locale) })}
              </button>
            </div>
          </>
        ) : (
          <>
            {step === 'done' ? (
              <div className="ts-done">
                <span className={'ts-done-ic' + (done ? '' : ' bad')}><Icon id={done ? 'i-check' : 'i-alert'} /></span>
                <p>{gift && friend ? t('Turtle: {name} can accept the gifts in their shop.', { name: friend.name }) : done ? t('Turtle: equip new items in the client wardrobe with Right Shift.') : t('Turtle: nothing was bought.')}</p>
              </div>
            ) : (
              <p className="faint-note" role="status">{t('Turtle: processing…')}</p>
            )}
            <ul className="ts-lines compact" aria-live="polite">
              {results.map(r => (
                <li key={r.key} className={'ts-line st-' + r.status}>
                  <span className="ts-line-ic"><Icon id={r.status === 'failed' ? 'i-x' : 'i-check'} /></span>
                  <span className="ts-line-body"><b>{r.name}</b><small>{statusText(r)}</small></span>
                </li>
              ))}
            </ul>
            <div className="ts-modal-acts">
              <button className="btn md primary" disabled={step === 'running'} onClick={onClose}>{t('Turtle: done')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
