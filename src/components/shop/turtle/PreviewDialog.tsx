import { useEffect, useState } from 'react'
import { intlTag, useT } from '../../../i18n'
import { backdropClose } from '../../../lib/dismiss'
import { bundleParts, giftable, isOwned } from '../../../lib/turtleShop'
import type { CartLine, ShopEntry, ShopInventory } from '../../../lib/turtleShop'
import { setScreen } from '../../../state/ui'
import { Icon } from '../../Icon'
import { Shells } from './ShellIcon'
import { useKindLabel, useRarityLabel } from './ShopCard'
import { TurtlePreview } from './TurtlePreview'

const item = (line: CartLine) => ({ kind: line.kind, id: line.id, hash: line.hash, slot: line.slot, owner: line.owner })

/**
 * Large preview of one shop item or a bundle. A bundle shows everything worn together
 * and each part on its own; the player's own skin wears it, as in the client.
 */
export function PreviewDialog({ entry, inventory, inCart, onCart, onBuyNow, onGift, onClose }: {
  entry: ShopEntry
  inventory: ShopInventory | null
  inCart: boolean
  onCart: () => void
  onBuyNow: () => void
  onGift: (line: CartLine) => void
  onClose: () => void
}) {
  const t = useT()
  const kind = useKindLabel()
  const rarity = useRarityLabel()
  const locale = intlTag()
  const parts = entry.bundle ? bundleParts(inventory, entry.id) : []
  const [focus, setFocus] = useState<string>('all')
  useEffect(() => setFocus('all'), [entry.key])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = entry.bundle ? (focus === 'all' ? parts : parts.filter(p => p.key === focus)) : [entry]
  const focused = entry.bundle && focus !== 'all' ? parts.find(p => p.key === focus) : null
  const buyable = !entry.owned && entry.price !== null
  const canGift = !entry.bundle && giftable(entry) && entry.price !== null && !entry.plusOnly

  return (
    <div className="modal-bg open vis" style={{ zIndex: 950 }} {...backdropClose(onClose)}>
      <div className={'modal ts-preview-dialog r-' + entry.rarity} role="dialog" aria-modal="true" aria-labelledby="ts-preview-title">
        <button className="btn sm secondary ts-ic-btn ts-preview-x" onClick={onClose} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
        <div className="ts-preview-stage">
          <TurtlePreview key={shown.map(s => s.key).join('|')} items={shown.map(item)} className="tp-large" />
          {focused ? <span className="ts-preview-cap">{focused.name}</span> : entry.bundle ? <span className="ts-preview-cap">{t('Turtle: everything together')}</span> : null}
        </div>
        <div className="ts-preview-info">
          <span className="ts-preview-tags">
            <span className="ts-rarity-chip">{entry.bundle ? t('Turtle: bundle') : rarity(entry.rarity)}</span>
            {entry.bundle ? null : <span className="ts-kind">{kind(entry)}</span>}
          </span>
          <h2 id="ts-preview-title">{entry.name}</h2>
          {entry.bundle ? (
            <>
              <p className="faint-note">{t('Turtle: everything in this bundle. Click a part to see it on its own.')}</p>
              <div className="ts-parts">
                <button className={'ts-part' + (focus === 'all' ? ' on' : '')} onClick={() => setFocus('all')}>
                  <span className="ts-part-art"><Icon id="i-box" /></span>
                  <span>{t('Turtle: everything together')}</span>
                </button>
                {parts.map(part => (
                  <button key={part.key} className={'ts-part r-' + part.rarity + (focus === part.key ? ' on' : '')} onClick={() => setFocus(part.key)}>
                    <span className="ts-part-art"><TurtlePreview items={[item(part)]} /></span>
                    <span>
                      {part.name}
                      <small>{kind(part)}{inventory && isOwned(inventory, part) ? ' · ' + t('Turtle: owned') : ''}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="faint-note">{entry.kind === 'emote' ? t('Turtle: emotes play from the emote wheel in the client.') : entry.kind === 'aura' || entry.kind === 'trail' ? t('Turtle: shown exactly as in the client.') : t('Turtle: worn on your own skin, as in the client.')}</p>
          )}
          <div className="ts-preview-price">
            {entry.owned ? (
              <span className="ts-owned"><Icon id="i-check" />{t('Turtle: owned')}</span>
            ) : entry.plusOnly ? (
              <span className="ts-plus"><Icon id="i-crown" />{t('Turtle: Turtle Plus only')}</span>
            ) : entry.price === 0 ? (
              <b>{t('Turtle: free')}</b>
            ) : (
              <Shells amount={entry.price ?? 0} size={22} locale={locale} />
            )}
            {entry.endsAt && !entry.owned ? <span className="ts-chip"><Icon id="i-clock" />{t('Turtle: until {date}', { date: new Date(entry.endsAt * 1000).toLocaleDateString(locale) })}</span> : null}
          </div>
          <div className="ts-preview-acts">
            {buyable ? (
              <>
                <button className="btn md primary" onClick={onBuyNow}><Icon id="i-wallet" />{t('Turtle: buy now')}</button>
                <button className={'btn md ' + (inCart ? 'secondary' : 'secondary')} onClick={onCart}><Icon id={inCart ? 'i-check' : 'i-plus'} />{inCart ? t('Turtle: remove from cart') : t('Turtle: add to cart')}</button>
              </>
            ) : null}
            {canGift ? <button className="btn md secondary" onClick={() => onGift(entry)}><Icon id="i-gift" />{t('Turtle: gift')}</button> : null}
            {entry.owned ? <button className="btn md primary" onClick={() => { onClose(); setScreen('skins') }}><Icon id="i-shirt" />{t('Turtle: open the wardrobe')}</button> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
