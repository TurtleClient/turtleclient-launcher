import { create } from 'zustand'
import { t } from '../i18n'
import { serviceError, turtle } from '../lib/turtleclient'
import { useAccounts } from './accounts'
import { showToast } from './ui'

/**
 * Friends chat and world invites through Ocean, the same threads the native client shows
 * in game. Ocean keeps the messages; the launcher polls `sync` for unread counts and
 * invites, and the open thread more often. Which friends are playing TurtleClient comes
 * from the Turtle service (the launchers' playtime beats).
 */
export interface ChatInvite { code: string; expires: number }
export interface ChatMessage {
  id: string
  from: string
  to: string
  time: number
  text: string
  image?: string | null
  invite?: ChatInvite | null
  read?: boolean
  nonce?: string
  /** Sent from here and not confirmed by Ocean yet, or refused. */
  pending?: boolean
  failed?: boolean
}
export interface OceanFriend { id: string; name: string; online: boolean; unread: number }
interface SyncReply { me?: { id: string; name: string }; friends?: OceanFriend[]; world_invites?: ChatMessage[] }

interface SocialState {
  accountId: string | null
  me: string | null
  friends: OceanFriend[]
  invites: ChatMessage[]
  playing: string[]
  threads: Record<string, ChatMessage[]>
  open: string | null
  ready: boolean
  error: string
}
const empty = (accountId: string | null): SocialState => ({ accountId, me: null, friends: [], invites: [], playing: [], threads: {}, open: null, ready: false, error: '' })
export const useTurtleSocial = create<SocialState>(() => empty(null))

const now = () => Math.floor(Date.now() / 1000)
const id = (s: string) => s.replace(/-/g, '').toLowerCase()
/** Same player in Ocean and the Turtle service, whichever way the UUID is written. */
export const samePlayer = (a: string, b: string) => id(a) === id(b)
export const liveInvites = (list: ChatMessage[]) => list.filter((m) => m.invite && m.invite.expires > now())

const dismissed = new Set<string>()
const seenInvites = new Set<string>()
let lastUnread = new Map<string, number>()

async function sync() {
  const accountId = useTurtleSocial.getState().accountId
  if (!accountId) return
  try {
    const reply = await turtle<SyncReply>('turtle_social', { accountId, action: 'sync' })
    if (useTurtleSocial.getState().accountId !== accountId) return
    const friends = reply.friends || []
    const invites = liveInvites(reply.world_invites || []).filter((m) => !dismissed.has(m.id))
    const state = useTurtleSocial.getState()
    // New messages and invites while the launcher is open: a toast, unless that chat is open.
    if (state.ready) {
      for (const f of friends) {
        const before = lastUnread.get(f.id) ?? 0
        if (f.unread > before && state.open !== f.id) showToast(t('Turtle: new message from {name}', { name: f.name }), 'ok', undefined, { label: t('Turtle: open chat'), run: () => openChat(f.id) })
      }
      for (const m of invites) {
        if (seenInvites.has(m.id)) continue
        const from = friends.find((f) => f.id === m.from)?.name || '?'
        showToast(t('Turtle: {name} invites you to their world', { name: from }), 'ok')
      }
    }
    for (const m of invites) seenInvites.add(m.id)
    lastUnread = new Map(friends.map((f) => [f.id, f.unread]))
    useTurtleSocial.setState({ me: reply.me?.id || null, friends, invites, ready: true, error: '' })
  } catch (e) {
    if (useTurtleSocial.getState().accountId === accountId) useTurtleSocial.setState({ error: serviceError(e) })
  }
}

async function syncPlaying() {
  const accountId = useTurtleSocial.getState().accountId
  if (!accountId) return
  try {
    const reply = await turtle<{ playing?: string[] }>('turtle_playtime', { accountId, friends: true })
    if (useTurtleSocial.getState().accountId === accountId) useTurtleSocial.setState({ playing: reply.playing || [] })
  } catch {
    /* The list stays as it was; presence is a nicety. */
  }
}

export async function loadThread(peer: string) {
  const accountId = useTurtleSocial.getState().accountId
  if (!accountId) return
  try {
    const reply = await turtle<{ messages?: ChatMessage[] }>('turtle_social', { accountId, action: 'thread', peer })
    const state = useTurtleSocial.getState()
    if (state.accountId !== accountId) return
    // Messages still on their way stay at the end until Ocean has them.
    const confirmed = reply.messages || []
    const waiting = (state.threads[peer] || []).filter((m) => (m.pending || m.failed) && !confirmed.some((c) => c.nonce && c.nonce === m.nonce))
    useTurtleSocial.setState({ threads: { ...state.threads, [peer]: [...confirmed, ...waiting] } })
    const friend = state.friends.find((f) => f.id === peer)
    if (friend?.unread && state.open === peer) await markRead(peer)
  } catch (e) {
    useTurtleSocial.setState({ error: serviceError(e) })
  }
}

async function markRead(peer: string) {
  const accountId = useTurtleSocial.getState().accountId
  if (!accountId) return
  await turtle('turtle_social', { accountId, action: 'read', peer }).catch(() => {})
  lastUnread.set(peer, 0)
  useTurtleSocial.setState((s) => ({ friends: s.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)) }))
}

export function openChat(peer: string | null) {
  useTurtleSocial.setState({ open: peer })
  if (peer) void loadThread(peer)
}

export async function sendChat(peer: string, text: string) {
  const state = useTurtleSocial.getState()
  const accountId = state.accountId
  const clean = text.trim()
  if (!accountId || !clean) return
  const nonce = crypto.randomUUID()
  const draft: ChatMessage = { id: 'local-' + nonce, from: state.me || '', to: peer, time: now(), text: clean, nonce, pending: true }
  const put = (update: (list: ChatMessage[]) => ChatMessage[]) =>
    useTurtleSocial.setState((s) => ({ threads: { ...s.threads, [peer]: update(s.threads[peer] || []) } }))
  put((list) => [...list, draft])
  try {
    await turtle('turtle_social', { accountId, action: 'send', peer, text: clean, nonce })
    await loadThread(peer)
    put((list) => list.filter((m) => m.nonce !== nonce || !m.pending))
  } catch (e) {
    put((list) => list.map((m) => (m.nonce === nonce ? { ...m, pending: false, failed: true } : m)))
    const code = String(e)
    showToast(t(code.includes('429') ? 'Turtle: slow down a little, then send again.' : code.includes('403') ? 'Turtle: you can only write to friends.' : serviceError(e)), 'error')
  }
}

/** Hides an invite in the launcher (Ocean lets it expire after ten minutes). */
export function dismissInvite(messageId: string) {
  dismissed.add(messageId)
  useTurtleSocial.setState((s) => ({ invites: s.invites.filter((m) => m.id !== messageId) }))
}

const images = new Map<string, Promise<string>>()
export function chatImage(imageId: string): Promise<string> {
  const accountId = useTurtleSocial.getState().accountId
  let pending = images.get(imageId)
  if (!pending) {
    pending = turtle<{ image: string }>('turtle_social', { accountId, action: 'image', id: imageId }).then((r) => r.image)
    pending.catch(() => images.delete(imageId))
    images.set(imageId, pending)
  }
  return pending
}

/** Polls while the launcher runs for the active Microsoft account; switching accounts starts over. */
export function watchTurtleSocial() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSync = Date.now()
  let lastPlaying = Date.now()
  const select = () => {
    const { list, active } = useAccounts.getState()
    const account = list.find((a) => a.id === active)
    const accountId = account?.kind === 'microsoft' ? account.id : null
    if (useTurtleSocial.getState().accountId === accountId) return
    lastUnread = new Map()
    seenInvites.clear()
    useTurtleSocial.setState(empty(accountId))
    if (accountId) {
      void sync()
      void syncPlaying()
    }
  }
  // The open thread every 4 s, unread counts and invites every 10 s (30 s while hidden),
  // who is playing every 30 s.
  const loop = () => {
    const state = useTurtleSocial.getState()
    if (state.accountId) {
      const visible = document.visibilityState === 'visible'
      const at = Date.now()
      if (state.open && visible) void loadThread(state.open)
      if (at - lastSync >= (visible ? 9500 : 29500)) { lastSync = at; void sync() }
      if (at - lastPlaying >= 29500) { lastPlaying = at; void syncPlaying() }
    }
    timer = setTimeout(loop, state.open ? 4000 : 5000)
  }
  const unsubscribe = useAccounts.subscribe(select)
  select()
  timer = setTimeout(loop, 5000)
  return () => {
    unsubscribe()
    clearTimeout(timer)
    useTurtleSocial.setState(empty(null))
  }
}
