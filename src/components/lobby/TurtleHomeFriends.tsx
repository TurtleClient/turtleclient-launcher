import { useMemo } from 'react'
import { useT } from '../../i18n'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { setScreen } from '../../state/ui'
import { turtleFriendsConnection, useTurtleFriends } from '../../state/turtleFriends'
import { serviceError } from '../../lib/turtleclient'
import { dismissInvite, openChat, samePlayer, useTurtleSocial } from '../../state/turtleSocial'
import { joinFriendWorld } from '../../lib/turtleLaunch'
import { RANK_COLOR, friendRank, useTurtleRanks } from '../../state/turtleRanks'
import '../../styles/pixel/turtle-home.css'

type Status = 'playing' | 'online' | 'offline'
interface Row { id: string; name: string; status: Status; unread: number; chat: string | null }

/**
 * Friends at the top right of Home (owner, 26.11.2026): who is playing TurtleClient,
 * who is online in the launcher or the game, and who is offline; a click opens the chat.
 * World invites from friends sit on top with a Join button that starts the client.
 */
export function TurtleHomeFriends() {
  const t = useT()
  const roster = useTurtleFriends()
  const social = useTurtleSocial()
  const ranks = useTurtleRanks()
  const rows = useMemo<Row[]>(() => {
    const list = roster.connected ? roster.data.friends : []
    const byId = new Map<string, Row>()
    for (const f of list) {
      const ocean = social.friends.find((o) => samePlayer(o.id, f.uuid))
      const playing = social.playing.some((p) => samePlayer(p, f.uuid))
      byId.set(f.uuid, {
        id: f.uuid,
        name: f.name,
        status: playing ? 'playing' : f.online || ocean?.online ? 'online' : 'offline',
        unread: ocean?.unread || 0,
        chat: ocean?.id || null,
      })
    }
    // Ocean may know a friend the roster has not loaded yet.
    for (const o of social.friends) {
      if ([...byId.keys()].some((k) => samePlayer(k, o.id))) continue
      const playing = social.playing.some((p) => samePlayer(p, o.id))
      byId.set(o.id, { id: o.id, name: o.name, status: playing ? 'playing' : o.online ? 'online' : 'offline', unread: o.unread, chat: o.id })
    }
    const rank: Record<Status, number> = { playing: 0, online: 1, offline: 2 }
    return [...byId.values()].sort((a, b) => rank[a.status] - rank[b.status] || b.unread - a.unread || a.name.localeCompare(b.name))
  }, [roster, social.friends, social.playing])

  if (!roster.accountId && !social.accountId) return null
  const online = rows.filter((r) => r.status !== 'offline')
  const offline = rows.filter((r) => r.status === 'offline')
  const requests = roster.connected ? roster.data.incoming.length : 0
  const nameOf = (id: string) => rows.find((r) => samePlayer(r.id, id))?.name || social.friends.find((f) => f.id === id)?.name || '?'

  const row = (r: Row) => (
    <button
      key={r.id}
      className={'thf-row is-' + r.status + (social.open && r.chat === social.open ? ' on' : '')}
      disabled={!r.chat}
      onClick={() => r.chat && openChat(social.open === r.chat ? null : r.chat)}
      title={r.chat ? t('Turtle: write to {name}', { name: r.name }) : undefined}
    >
      <span className="thf-head">
        <Head nick={r.name} size={36} />
        <i className="thf-dot" aria-hidden="true" />
      </span>
      <span className="thf-body">
        {/* A friend's rank colours the name, as in the client (owner, 27.11.2026). */}
        <b style={{ color: RANK_COLOR[friendRank(ranks, r.id)] }}>{r.name}</b>
        <small>{r.status === 'playing' ? t('Turtle: playing TurtleClient') : r.status === 'online' ? t('Turtle: online') : t('Turtle: offline')}</small>
      </span>
      {r.unread ? <span className="thf-unread">{r.unread > 99 ? '99+' : r.unread}</span> : <Icon id="i-msg" className="icon thf-chat" />}
    </button>
  )

  return (
    <aside className="thf" aria-label={t('Друзья')} data-private>
      <header className="thf-top">
        <span className="thf-title">
          <Icon id="i-users" />
          {t('Друзья')}
          <span className="thf-count">{online.length}/{rows.length}</span>
        </span>
        <button className="thf-add" onClick={() => setScreen('friends')} aria-label={t('Turtle: add friends')} title={t('Turtle: add friends')}>
          <Icon id="i-plus" />
          {requests ? <span className="thf-req">{requests}</span> : null}
        </button>
      </header>
      {social.invites.map((m) => (
        <div className="thf-invite" key={m.id}>
          <Head nick={nameOf(m.from)} size={28} />
          <span className="thf-invite-txt">{t('Turtle: {name} invites you to their world', { name: nameOf(m.from) })}</span>
          <span className="thf-invite-acts">
            <button className="btn sm primary" onClick={() => { dismissInvite(m.id); void joinFriendWorld(m.invite!.code, nameOf(m.from)) }}>
              <Icon id="i-play" />
              {t('Turtle: join')}
            </button>
            <button className="thf-x" onClick={() => dismissInvite(m.id)} aria-label={t('Turtle: close')}><Icon id="i-x" /></button>
          </span>
        </div>
      ))}
      <div className="thf-list">
        {!rows.length && roster.error && !roster.connected && !roster.connecting && !social.ready ? (
          // A failed sign-in used to leave "connecting…" here forever.
          <p className="thf-empty" role="alert">
            {t(serviceError(roster.error))}{' '}
            <button type="button" className="thf-retry" onClick={() => void turtleFriendsConnection.refresh()}>
              {t('Повторить')}
            </button>
          </p>
        ) : !rows.length ? (
          <p className="thf-empty">
            {roster.connected || social.ready ? t('Turtle: no friends yet. Send a request using their Minecraft name.') : t('Turtle: connecting…')}
          </p>
        ) : null}
        {online.length ? <div className="thf-cap">{t('Turtle: online')} ({online.length})</div> : null}
        {online.map(row)}
        {offline.length ? <div className="thf-cap">{t('Turtle: offline')} ({offline.length})</div> : null}
        {offline.map(row)}
      </div>
    </aside>
  )
}
