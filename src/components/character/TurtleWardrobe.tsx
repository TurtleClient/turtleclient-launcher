import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useT } from '../../i18n'
import { categoryOf, lineOf } from '../../lib/turtleShop'
import type { CartLine, TurtleCategory } from '../../lib/turtleShop'
import { useAccounts } from '../../state/accounts'
import { loadEmoteWheel, moved, saveEmoteWheel, useEmoteWheel } from '../../state/turtleEmoteWheel'
import { refreshShop, setShopPet, useTurtleShop, wearShopItem } from '../../state/turtleShop'
import { useTurtleWardrobe, wearTurtle } from '../../state/turtleWardrobe'
import { setScreen } from '../../state/ui'
import { Icon } from '../Icon'
import { TurtlePreview } from '../shop/turtle/TurtlePreview'
import { ItemGrid, ItemTile } from './ItemTile'
import type { PreviewItem } from '../../lib/turtlePreview'
import '../../styles/pixel/turtle-wardrobe.css'

/** The emote under the pointer, played by the big figure with what the player wears (owner, 26.11.2026). */
export const useEmoteHover = create<{ items: PreviewItem[] | null; key: string }>(() => ({ items: null, key: '' }))
const previewOf = (line: CartLine): PreviewItem => ({ kind: line.kind === 'team_cape' ? 'cape' : line.kind, id: line.id, hash: line.hash, slot: line.slot, owner: line.owner })

const dashed = (id: string) => (/^[0-9a-f]{32}$/i.test(id) ? id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : id).toLowerCase()

/**
 * The Turtle wardrobe: only what the player owns, in the client's catalogue categories.
 * Models, aura and trail are worn through Ocean, the cape through the cape service,
 * MiniMe through Ocean's pet route; emotes go on the client's emote wheel.
 */
export function TurtleWardrobe({ category }: { category: string }) {
  const t = useT()
  const { inventory, accountId, busy, loading, error, me } = useTurtleShop()
  const wardrobe = useTurtleWardrobe()
  const wheel = useEmoteWheel()
  const account = useAccounts(s => s.list.find(a => a.id === s.active))
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (category === 'emote' || category === 'all') void loadEmoteWheel()
  }, [category])
  useEffect(() => setNotice(''), [category])
  useEffect(() => () => useEmoteHover.setState({ items: null, key: '' }), [category])

  if (!accountId) return <p className="faint-note">{t('Turtle: sign in with a Microsoft Minecraft account.')}</p>
  if (!inventory)
    return error ? (
      <div className="tw-empty"><p role="alert">{t(error)}</p><button className="btn md primary" disabled={loading} onClick={() => void refreshShop()}>{t('Turtle: refresh')}</button></div>
    ) : (
      <p className="faint-note" role="status">{t('Turtle: loading shop…')}</p>
    )

  const owned = inventory.items.map(lineOf).filter(line => category === 'all' || categoryOf(line) === category)
  const worn = (line: CartLine) => {
    if (line.kind === 'team_cape') return !!inventory.team_cape_equipped
    if (line.kind === 'cape') return !!wardrobe.snapshot?.cape && wardrobe.snapshot.cape_revision === line.hash
    if (line.kind === 'pet') return !!inventory.pet
    if (line.kind === 'emote') return wheel.favorites.includes(line.id)
    return (inventory.equipped ?? []).some(entry => entry.hash === line.hash)
  }
  const status = (line: CartLine, on: boolean) => {
    if (line.kind === 'emote') return on ? t('Turtle: on your emote wheel. Click to remove.') : t('Turtle: click to add to the emote wheel.')
    if (line.kind === 'pet') return on ? t('Turtle: MiniMe follows you. Click to put it away.') : t('Turtle: click to let MiniMe follow you.')
    return on ? t('Turtle: equipped — click to unequip') : t('Turtle: click to equip')
  }
  async function toggle(line: CartLine) {
    setNotice('')
    const on = worn(line)
    let failure = ''
    if (line.kind === 'emote') {
      await saveEmoteWheel(on ? wheel.favorites.filter(id => id !== line.id) : [...wheel.favorites, line.id])
      return
    }
    if (line.kind === 'pet') {
      const uuid = dashed(me || account?.uuid || '')
      failure = await setShopPet(on ? null : { uuid, name: account?.nick || '', mode: 0, personality: 0 })
    } else if (line.kind === 'cape') {
      await wearTurtle('cape', on ? null : line.hash)
      failure = useTurtleWardrobe.getState().error ? 'Turtle: the cape could not be changed. Check your connection and try again.' : ''
    } else if (line.kind === 'team_cape') failure = await wearShopItem('team_cape', line.hash, !on)
    else failure = await wearShopItem(line.slot, line.hash, !on)
    if (failure) setNotice(t(failure))
  }

  const emotes = category === 'emote' || category === 'all' ? inventory.items.map(lineOf).filter(line => line.kind === 'emote') : []
  // What the figure wears while an emote plays: models, capes, aura and trail, as on Home.
  const wearing = inventory.items.map(lineOf).filter(line => !['emote', 'pet', 'name_tag'].includes(line.kind) && line.slot !== 'name_tag' && worn(line)).map(previewOf)
  const hover = (line: CartLine | null) => useEmoteHover.setState(line ? { items: [...wearing, previewOf(line)], key: line.key } : { items: null, key: '' })
  const nameOf = (id: string) => emotes.find(line => line.id === id)?.name || id

  return (
    <div className="tw">
      {notice ? <p className="ts-alert tw-alert" role="alert">{notice}</p> : null}
      {category === 'emote' ? (
        <section className="tw-wheel" aria-label={t('Turtle: emote wheel')}>
          <div className="tw-wheel-head">
            <h3><Icon id="i-hand" />{t('Turtle: emote wheel')}</h3>
            <span className="faint-note">{t('Turtle: the order here is the order on your wheel in the client.')}</span>
          </div>
          {wheel.error ? <p className="ts-alert" role="alert">{t(wheel.error)}</p> : null}
          {wheel.favorites.length ? (
            <ol className="tw-slots">
              {wheel.favorites.map((id, index) => (
                <li key={id} className="tw-slot">
                  <span className="tw-slot-n">{index + 1}</span>
                  <span className="tw-slot-name" title={nameOf(id)}>{nameOf(id)}</span>
                  <button className="tw-mini" disabled={wheel.busy || index === 0} onClick={() => void saveEmoteWheel(moved(wheel.favorites, id, -1))} aria-label={t('Turtle: move earlier') + ': ' + nameOf(id)}><Icon id="i-chev-r" className="icon tw-left" /></button>
                  <button className="tw-mini" disabled={wheel.busy || index === wheel.favorites.length - 1} onClick={() => void saveEmoteWheel(moved(wheel.favorites, id, 1))} aria-label={t('Turtle: move later') + ': ' + nameOf(id)}><Icon id="i-chev-r" /></button>
                  <button className="tw-mini" disabled={wheel.busy} onClick={() => void saveEmoteWheel(wheel.favorites.filter(x => x !== id))} aria-label={t('Turtle: remove') + ': ' + nameOf(id)}><Icon id="i-x" /></button>
                </li>
              ))}
            </ol>
          ) : wheel.loaded && !wheel.error ? (
            <p className="faint-note">{t('Turtle: your emote wheel is empty. Click an emote below to add it.')}</p>
          ) : null}
        </section>
      ) : null}
      {owned.length ? (
        <ItemGrid>
          {owned.map(line => {
            const on = worn(line)
            const text = status(line, on)
            // Team capes are GIFs in Ocean's asset store, shown like any cape.
            const preview = [previewOf(line)]
            const emote = line.kind === 'emote'
            return (
              <div
                key={line.key}
                className="tw-tile"
                onMouseEnter={emote ? () => hover(line) : undefined}
                onMouseLeave={emote ? () => hover(null) : undefined}
                onFocus={emote ? () => hover(line) : undefined}
                onBlur={emote ? () => hover(null) : undefined}
              >
              <ItemTile
                name={line.name}
                itemId={line.id}
                rarity={line.rarity}
                art={<TurtlePreview items={preview} />}
                on={on}
                status={<span className="ch-tile-note" title={text}>{text}</span>}
                loading={busy === 'wear:' + line.hash || (busy === 'pet' && line.kind === 'pet') || (wheel.busy && line.kind === 'emote') || (line.kind === 'cape' && wardrobe.busy === 'cape')}
                onClick={() => {
                  if (!busy) void toggle(line)
                }}
              />
              </div>
            )
          })}
        </ItemGrid>
      ) : (
        <div className="tw-empty">
          <Icon id="i-backpack" className="icon tw-empty-ic" />
          <p>{t('Turtle: you do not own anything here yet.')}</p>
          <button className="btn md primary" onClick={() => setScreen('rubies')}><Icon id="i-ws-shop" />{t('Turtle: open the shop')}</button>
        </div>
      )}
    </div>
  )
}

/** Wardrobe sections: the client's catalogue (bundles are bought, not worn). */
export const TURTLE_WARDROBE_CATEGORIES: TurtleCategory[] = ['head', 'back', 'torso', 'shoulder', 'cape', 'name_tag', 'aura', 'trail', 'pet', 'emote']
