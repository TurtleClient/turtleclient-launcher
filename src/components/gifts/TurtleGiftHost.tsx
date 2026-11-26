import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../i18n'
import { displayName, rarityOf } from '../../lib/turtleShop'
import type { GiftRow, OceanItem } from '../../lib/turtleShop'
import { answerGift, useTurtleShop } from '../../state/turtleShop'
import type { GiftNote } from '../../state/turtleShop'
import { setScreen, useUi } from '../../state/ui'
import { Icon } from '../Icon'
import { useKindLabel, useRarityLabel } from '../shop/turtle/ShopCard'
import { TurtlePreview } from '../shop/turtle/TurtlePreview'
import '../../styles/pixel/turtle-shop.css'
import '../../styles/pixel/turtle-gift.css'

const SEEN = 'turtle-gifts-seen:'
function readSeen(accountId: string | null): Set<string> {
  if (!accountId) return new Set()
  try {
    const rows = JSON.parse(localStorage.getItem(SEEN + accountId) || '[]') as unknown
    return new Set(Array.isArray(rows) ? rows.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function writeSeen(accountId: string | null, seen: Set<string>) {
  if (!accountId) return
  try {
    localStorage.setItem(SEEN + accountId, JSON.stringify([...seen].slice(-200)))
  } catch {
    // Only decides whether a gift pops up again by itself.
  }
}

type Stage = 'closed' | 'opening' | 'revealed'

/** What the gift is: from the friend's note, else the owned or listed item of that name. */
function giftItem(gift: GiftRow, note: GiftNote | undefined, items: OceanItem[]) {
  if (note) return { kind: note.item.kind, id: note.item.id, hash: note.item.hash, slot: note.item.slot, name: note.item.name, rarity: rarityOf(note.item.rarity) }
  const match = items.find(item => item.name === gift.name || displayName(item.name, item.id) === gift.name)
  return match ? { kind: match.kind, id: match.id, hash: match.hash, slot: match.slot, name: displayName(match.name, match.id), rarity: rarityOf(match.rarity) } : null
}

/**
 * Gifts from friends, app-wide: a full-screen present pops up when one arrives, with the
 * friend's message; opening accepts it and reveals the item on the player's own skin.
 * On Home a gift button stays while gifts are waiting.
 */
export default function TurtleGiftHost() {
  const t = useT()
  const kind = useKindLabel()
  const rarityLabel = useRarityLabel()
  const { gifts, me, notes, inventory, accountId } = useTurtleShop()
  const screen = useUi(s => s.screen)
  const received = useMemo(() => gifts.filter(g => g.to === me && g.kind === 'gift'), [gifts, me])
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<GiftRow | null>(null)
  const [stage, setStage] = useState<Stage>('closed')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // A gift nobody has seen yet opens the present by itself.
  useEffect(() => {
    if (open || !received.length) return
    const seen = readSeen(accountId)
    if (received.some(g => !seen.has(g.id))) setOpen(true)
  }, [received, accountId, open])
  useEffect(() => {
    if (!open) return
    if (!current || (stage === 'closed' && !received.some(g => g.id === current.id))) {
      const next = received[0] || null
      setCurrent(next)
      setStage('closed')
      setError('')
      if (!next) setOpen(false)
    }
  }, [open, received, current, stage])
  useEffect(() => {
    if (!current) return
    const seen = readSeen(accountId)
    seen.add(current.id)
    writeSeen(accountId, seen)
  }, [current, accountId])

  const items = [...(inventory?.items ?? []), ...(inventory?.catalog_items ?? [])]
  const item = current ? giftItem(current, notes[current.id], items) : null
  const note = current ? notes[current.id] : undefined

  async function unwrap() {
    if (!current || busy) return
    setBusy(true)
    setError('')
    setStage('opening')
    const failure = await answerGift(current.id, true)
    setBusy(false)
    if (failure) {
      setStage('closed')
      setError(t(failure))
      return
    }
    // Let the lid fly before the item appears.
    setTimeout(() => setStage('revealed'), 900)
  }
  async function decline() {
    if (!current || busy) return
    setBusy(true)
    const failure = await answerGift(current.id, false)
    setBusy(false)
    if (failure) setError(t(failure))
    else next()
  }
  function next() {
    setCurrent(null)
    setStage('closed')
  }
  function later() {
    setOpen(false)
    setCurrent(null)
    setStage('closed')
  }

  return (
    <>
      {screen === 'play' && received.length && !open ? (
        <button className="tg-home" onClick={() => setOpen(true)} aria-label={t('Turtle: open your gifts')}>
          <span className="tg-home-box"><Icon id="i-gift" /></span>
          <span>{t('Turtle: gifts')}</span>
          <span className="ts-badge">{received.length}</span>
        </button>
      ) : null}
      {open && current ? (
        <div className={'tg-screen is-' + stage} role="dialog" aria-modal="true" aria-label={t('Turtle: a gift from {name}!', { name: current.sender })}>
          <div className="tg-rays" aria-hidden="true" />
          {stage !== 'revealed' ? (
            <div className="tg-stage">
              <span className="tg-eyebrow">{t('Turtle: a gift from {name}!', { name: current.sender })}</span>
              <div className="tg-box" aria-hidden="true">
                <span className="tg-lid"><span className="tg-bow" /></span>
                <span className="tg-body" />
                <span className="tg-ribbon" />
              </div>
              {note?.text ? (
                <blockquote className="tg-note">
                  <p>{note.text}</p>
                  <cite>{current.sender}</cite>
                </blockquote>
              ) : null}
              {error ? <p className="ts-alert" role="alert">{error}</p> : null}
              <div className="tg-acts">
                <button className="btn lg primary tg-open" disabled={busy} onClick={() => void unwrap()}><Icon id="i-gift" />{t('Turtle: open')}</button>
                <button className="btn md secondary" disabled={busy} onClick={later}>{t('Turtle: later')}</button>
              </div>
              <button className="tg-decline" disabled={busy} onClick={() => void decline()}>{t('Turtle: decline gift')}</button>
            </div>
          ) : (
            <div className={'tg-reveal r-' + (item?.rarity || 'common')}>
              <span className="tg-eyebrow">{t('Turtle: you got')}</span>
              <div className="tg-figure">
                {item ? <TurtlePreview items={[{ kind: item.kind, id: item.id, hash: item.hash, slot: item.slot }]} className="tp-large" /> : <Icon id="i-gift" className="icon tg-figure-ic" />}
              </div>
              <span className="ts-rarity-chip">{item ? rarityLabel(item.rarity) : t('Turtle: gift')}</span>
              <h2>{item?.name || current.name}</h2>
              {item ? <span className="ts-kind">{kind({ kind: item.kind, slot: item.slot })}</span> : null}
              <p className="faint-note">{t('Turtle: from {name}', { name: current.sender })}</p>
              <div className="tg-acts">
                <button className="btn lg primary" onClick={() => { later(); setScreen('skins') }}><Icon id="i-shirt" />{t('Turtle: wear it in the wardrobe')}</button>
                <button className="btn md secondary" onClick={received.some(g => g.id !== current.id) ? next : later}>{received.some(g => g.id !== current.id) ? t('Turtle: next gift') : t('Turtle: close')}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}
