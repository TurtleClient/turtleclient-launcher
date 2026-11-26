import { useEffect, useRef, useState } from 'react'
import { intlTag, useT } from '../../../i18n'
import { backdropClose } from '../../../lib/dismiss'
import { shopError } from '../../../lib/turtleShop'
import type { CartLine, GiftQuote } from '../../../lib/turtleShop'
import { quoteGift, sendGift, useTurtleShop } from '../../../state/turtleShop'
import { useTurtleFriends } from '../../../state/turtleFriends'
import { Head } from '../../Head'
import { Icon } from '../../Icon'
import { ShopArt } from './ShopArt'
import { Shells } from './ShellIcon'
import { useKindLabel } from './ShopCard'

/** Gift a single item to a friend: Ocean quotes the price, the friend accepts or the Shells return. */
export function GiftDialog({ line, onClose }: { line: CartLine; onClose: () => void }) {
  const t = useT()
  const kind = useKindLabel()
  const locale = intlTag()
  const { inventory, accountId, busy } = useTurtleShop()
  const friendsState = useTurtleFriends()
  const friends = friendsState.accountId === accountId && friendsState.connected ? friendsState.data.friends : []
  const [peer, setPeer] = useState('')
  const [quote, setQuote] = useState<GiftQuote | null>(null)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const asked = useRef(0)
  const friend = friends.find(f => f.uuid === peer)
  const balance = inventory?.balance ?? 0

  useEffect(() => {
    setQuote(null)
    setError('')
    if (!peer) return
    const ask = ++asked.current
    quoteGift(peer, line)
      .then(q => ask === asked.current && setQuote(q))
      .catch(e => ask === asked.current && setError(shopError(e)))
  }, [peer, line])

  async function send() {
    if (!quote || !peer) return
    const failure = await sendGift(peer, line, quote, message)
    if (failure) setError(failure)
    else setSent(true)
  }

  const close = () => busy !== 'gift' && onClose()
  const blocked = !quote || quote.owned || !quote.affordable || busy === 'gift'

  return (
    <div className="modal-bg open vis" style={{ zIndex: 960 }} {...backdropClose(close)}>
      <div className="modal mw-sm ts-gift" role="dialog" aria-modal="true" aria-labelledby="ts-gift-title">
        <div className="ts-modal-head">
          <h3 id="ts-gift-title"><Icon id="i-gift" />{sent ? t('Turtle: gift sent') : t('Turtle: send a gift')}</h3>
          <button className="btn sm secondary ts-ic-btn" onClick={close} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
        </div>
        <div className={'ts-gift-item r-' + line.rarity}>
          <span className="ts-line-art lg"><ShopArt line={line} /></span>
          <span><small>{kind(line)}</small><b>{line.name}</b></span>
        </div>
        {sent && friend ? (
          <>
            <div className="ts-done"><span className="ts-done-ic"><Icon id="i-check" /></span><p>{t('Turtle: {name} can accept the gifts in their shop.', { name: friend.name })}</p></div>
            <div className="ts-modal-acts"><button className="btn md primary" onClick={onClose}>{t('Turtle: done')}</button></div>
          </>
        ) : (
          <>
            {friends.length ? (
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
            )}
            {peer && !quote && !error ? <p className="faint-note" role="status">{t('Turtle: checking price…')}</p> : null}
            {quote ? (
              <div className="ts-totals">
                <div className="ts-sum"><span>{t('Turtle: gift price')}</span><Shells amount={quote.price} size={18} locale={locale} /></div>
                <div className={'ts-sum faint' + (quote.affordable ? '' : ' bad')}><span>{t('Turtle: your Shells')}</span><Shells amount={balance} locale={locale} /></div>
              </div>
            ) : null}
            {quote?.owned ? <p className="ts-alert">{t('Turtle: your friend already owns this or has it waiting as a gift.')}</p> : null}
            {quote && !quote.affordable ? <p className="ts-alert">{t('Turtle: not enough Shells for this purchase.')}</p> : null}
            {error ? <p className="ts-alert" role="alert">{t(error)}</p> : null}
            {peer ? (
              <label className="ts-message">
                <span>{t('Turtle: message for {name}', { name: friend?.name || '' })}</span>
                <textarea value={message} maxLength={140} rows={2} placeholder={t('Turtle: write a few words (optional)')} onChange={e => setMessage(e.target.value)} />
                <small>{message.length}/140</small>
              </label>
            ) : null}
            <p className="faint-note">{t('Turtle: your friend must accept each gift. If they decline, you get your Shells back.')}</p>
            <div className="ts-modal-acts">
              <button className="btn md secondary" onClick={close}>{t('Turtle: cancel')}</button>
              <button className="btn md primary" disabled={blocked} onClick={() => void send()}>
                <Icon id="i-send" />
                {quote ? t('Turtle: send gift for {n} Shells', { n: quote.price.toLocaleString(locale) }) : t('Turtle: send a gift')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
