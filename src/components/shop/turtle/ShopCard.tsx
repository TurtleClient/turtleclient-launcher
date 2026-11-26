import { intlTag, useT } from '../../../i18n'
import { giftable } from '../../../lib/turtleShop'
import type { CartLine, ShopEntry } from '../../../lib/turtleShop'
import { Icon } from '../../Icon'
import { ShopArt } from './ShopArt'
import { Shells } from './ShellIcon'

export function useKindLabel() {
  const t = useT()
  return (line: Pick<CartLine, 'kind' | 'slot' | 'bundle'>): string => {
    if (line.bundle) return t('Turtle: bundle')
    switch (line.kind) {
      case 'cape': return t('Turtle: cape')
      case 'aura': return t('Turtle: aura')
      case 'trail': return t('Turtle: trail')
      case 'emote': return t('Turtle: emote')
      case 'pet': return t('Turtle: pet')
    }
    if (line.slot === 'back') return t('Turtle: back item')
    if (line.slot === 'torso' || line.slot === 'shoulder') return t('Turtle: body item')
    if (line.slot === 'name_tag') return t('Turtle: name tag effect')
    return t('Turtle: head item')
  }
}

export function useRarityLabel() {
  const t = useT()
  return (rarity: string): string => {
    switch (rarity) {
      case 'rare': return t('Turtle: rare')
      case 'epic': return t('Turtle: epic')
      case 'legendary': return t('Turtle: legendary')
      case 'mythic': return t('Turtle: mythic')
      default: return t('Turtle: common')
    }
  }
}

export function ShopCard({ entry, balance, inCart, onCart, onGift }: { entry: ShopEntry; balance: number; inCart: boolean; onCart: () => void; onGift: () => void }) {
  const t = useT()
  const kind = useKindLabel()
  const rarity = useRarityLabel()
  const locale = intlTag()
  const short = entry.price !== null && !entry.owned && entry.price > balance
  const ends = entry.endsAt ? new Date(entry.endsAt * 1000).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) : ''
  return (
    <article className={'ts-card r-' + entry.rarity + (entry.owned ? ' is-owned' : '') + (entry.bundle ? ' is-bundle' : '')}>
      <div className="ts-card-art">
        <ShopArt line={entry} />
        <span className="ts-rarity">{entry.bundle ? t('Turtle: bundle') : rarity(entry.rarity)}</span>
        {entry.owned ? <span className="ts-flag is-owned"><Icon id="i-check" />{t('Turtle: owned')}</span> : inCart ? <span className="ts-flag"><Icon id="i-mo-bag" />{t('Turtle: in cart')}</span> : null}
        {ends && !entry.owned ? <span className="ts-ends"><Icon id="i-clock" />{t('Turtle: until {date}', { date: ends })}</span> : null}
      </div>
      <div className="ts-card-body">
        <span className="ts-kind">{kind(entry)}</span>
        <h3 title={entry.name}>{entry.name}</h3>
        <div className="ts-card-foot">
          <span className={'ts-price' + (short ? ' is-short' : '')} title={short ? t('Turtle: not enough Shells') : undefined}>
            {entry.owned ? t('Turtle: owned') : entry.plusOnly ? <span className="ts-plus"><Icon id="i-crown" />{t('Turtle: Turtle Plus only')}</span> : entry.price === 0 ? t('Turtle: free') : <Shells amount={entry.price ?? 0} locale={locale} />}
          </span>
          <span className="ts-acts">
            {giftable(entry) && entry.price !== null ? (
              <button className="btn sm secondary ts-ic-btn" onClick={onGift} aria-label={t('Turtle: gift') + ': ' + entry.name} data-tip={t('Turtle: gift')}>
                <Icon id="i-gift" />
              </button>
            ) : null}
            {!entry.owned && entry.price !== null ? (
              <button className={'btn sm ts-cart-btn ' + (inCart ? 'secondary is-in' : 'primary')} onClick={onCart} aria-pressed={inCart} aria-label={(inCart ? t('Turtle: remove from cart') : t('Turtle: add to cart')) + ': ' + entry.name}>
                <Icon id={inCart ? 'i-check' : 'i-plus'} />
                <span>{inCart ? t('Turtle: in cart') : t('Turtle: add to cart')}</span>
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </article>
  )
}
