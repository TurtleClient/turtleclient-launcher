import { useState } from 'react'
import { useT } from '../../../i18n'
import { answerGift, useTurtleShop } from '../../../state/turtleShop'
import { useTurtleFriends } from '../../../state/turtleFriends'
import { Head } from '../../Head'
import { Icon } from '../../Icon'

/** Open gifts: accept or decline what friends sent, withdraw what you sent (the Shells come back). */
export function GiftInbox() {
  const t = useT()
  const { gifts, me, busy } = useTurtleShop()
  const friends = useTurtleFriends().data.friends
  const [error, setError] = useState('')
  const received = gifts.filter(g => g.to === me)
  const sent = gifts.filter(g => g.from === me)
  const nameOf = (uuid: string) => friends.find(f => f.uuid === uuid)?.name || t('Turtle: a friend')

  async function answer(id: string, accept: boolean) {
    setError('')
    const failure = await answerGift(id, accept)
    if (failure) setError(failure)
  }

  if (!received.length && !sent.length)
    return (
      <div className="card ts-empty-card">
        <Icon id="i-gift" className="icon ts-empty-ic" />
        <p>{t('Turtle: no open gifts.')}</p>
        <p className="faint-note">{t('Turtle: use the gift button on an item to surprise a friend.')}</p>
      </div>
    )

  return (
    <div className="ts-inbox">
      {error ? <p className="ts-alert" role="alert">{t(error)}</p> : null}
      {received.length ? (
        <section className="card ts-inbox-sec">
          <h2>{t('Turtle: received gifts')}<span className="ts-count">{received.length}</span></h2>
          {received.map(g => (
            <div className="ts-gift-row" key={g.id}>
              <Head nick={g.sender} size={36} />
              <span className="ts-line-body"><b>{g.name}</b><small>{t('Turtle: from {name}', { name: g.sender })}</small></span>
              <span className="ts-acts">
                <button className="btn sm primary" disabled={!!busy} onClick={() => void answer(g.id, true)}>{t('Turtle: accept')}</button>
                <button className="btn sm secondary" disabled={!!busy} onClick={() => void answer(g.id, false)}>{t('Turtle: decline')}</button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {sent.length ? (
        <section className="card ts-inbox-sec">
          <h2>{t('Turtle: sent gifts')}<span className="ts-count">{sent.length}</span></h2>
          {sent.map(g => (
            <div className="ts-gift-row" key={g.id}>
              <Head nick={nameOf(g.to)} size={36} />
              <span className="ts-line-body"><b>{g.name}</b><small>{t('Turtle: to {name}', { name: nameOf(g.to) })} · {t('Turtle: awaiting acceptance')}</small></span>
              <span className="ts-acts">
                <button className="btn sm secondary" disabled={!!busy} onClick={() => void answer(g.id, false)}>{t('Turtle: withdraw')}</button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
