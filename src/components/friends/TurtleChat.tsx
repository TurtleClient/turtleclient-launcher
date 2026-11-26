import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { intlTag, useT } from '../../i18n'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { useUi } from '../../state/ui'
import { chatImage, openChat, samePlayer, sendChat, useTurtleSocial } from '../../state/turtleSocial'
import type { ChatMessage } from '../../state/turtleSocial'
import { useTurtleFriends } from '../../state/turtleFriends'
import { joinFriendWorld } from '../../lib/turtleLaunch'
import '../../styles/pixel/turtle-home.css'

function ChatImage({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    chatImage(id).then((url) => live && setSrc(url)).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [id])
  if (failed) return null
  return src ? <img className="tch-img" src={src} alt="" /> : <span className="tch-img is-wait" />
}

/**
 * The friends chat of the native client, in the launcher (owner, 26.11.2026): the same
 * Ocean thread, unread marks and world invites. Opens from the Home friends list or a
 * message toast; Enter sends, Shift+Enter starts a new line.
 */
export default function TurtleChat() {
  const t = useT()
  const locale = intlTag()
  const screen = useUi((s) => s.screen)
  const { open, friends, threads, me, playing } = useTurtleSocial()
  const roster = useTurtleFriends((s) => s.data.friends)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const friend = friends.find((f) => f.id === open)
  const messages = open ? threads[open] || [] : []
  useEffect(() => { setDraft(''); if (open) setTimeout(() => input.current?.focus(), 0) }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openChat(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  // Stay at the newest message unless the player scrolled up to read.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, open])
  if (!open || !friend) return null

  const playingNow = playing.some((p) => samePlayer(p, friend.id))
  const onlineNow = friend.online || roster.some((f) => samePlayer(f.uuid, friend.id) && f.online)
  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    pinned.current = true
    void sendChat(friend.id, text)
  }
  const time = (m: ChatMessage) => new Date(m.time * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const day = (m: ChatMessage) => new Date(m.time * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  const now = Date.now() / 1000

  return (
    <section className={'tch' + (screen === 'play' ? ' beside' : '')} role="dialog" aria-label={t('Turtle: chat with {name}', { name: friend.name })} data-private>
      <header className="tch-top">
        <Head nick={friend.name} size={36} />
        <span className="tch-who">
          <b>{friend.name}</b>
          <small className={playingNow ? 'is-playing' : onlineNow ? 'is-online' : ''}>
            {playingNow ? t('Turtle: playing TurtleClient') : onlineNow ? t('Turtle: online') : t('Turtle: offline')}
          </small>
        </span>
        <button className="tch-x" onClick={() => openChat(null)} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
      </header>
      <div className="tch-list" ref={list} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!messages.length ? <p className="tch-empty">{t('Turtle: no messages yet. Say hello!')}</p> : null}
        {messages.map((m, i) => {
          const mine = m.from === me || m.pending || m.failed
          const newDay = i === 0 || day(messages[i - 1]) !== day(m)
          return (
            <div key={m.id}>
              {newDay ? <div className="tch-day">{day(m)}</div> : null}
              <div className={'tch-msg' + (mine ? ' mine' : '') + (m.pending ? ' pending' : '') + (m.failed ? ' failed' : '')}>
                {m.invite ? (
                  <div className="tch-invite">
                    <Icon id="i-globe" />
                    <span>{mine ? t('Turtle: you invited {name} to your world', { name: friend.name }) : t('Turtle: {name} invites you to their world', { name: friend.name })}</span>
                    {!mine && m.invite.expires > now ? (
                      <button className="btn sm primary" onClick={() => void joinFriendWorld(m.invite!.code, friend.name)}><Icon id="i-play" />{t('Turtle: join')}</button>
                    ) : !mine ? <small>{t('Turtle: invite expired')}</small> : null}
                  </div>
                ) : (
                  <>
                    {m.image ? <ChatImage id={m.image} /> : null}
                    {m.text ? <p>{m.text}</p> : null}
                  </>
                )}
                <time>{m.failed ? t('Turtle: not sent') : time(m)}</time>
              </div>
            </div>
          )
        })}
      </div>
      <form className="tch-send" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          maxLength={1000}
          placeholder={t('Turtle: message to {name}', { name: friend.name })}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="btn md primary" disabled={!draft.trim()} aria-label={t('Turtle: send')}><Icon id="i-send" /></button>
      </form>
      {draft.length > 900 ? <span className="tch-count">{draft.length}/1000</span> : null}
    </section>
  )
}
