import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'

/**
 * The client's emote wheel: `emote_favorites` in its own `config/turtleclient.json`.
 * The launcher changes it only while the client is closed, so the game cannot overwrite
 * the new order when it saves its settings.
 */
interface WheelState {
  favorites: string[]
  running: boolean
  loaded: boolean
  busy: boolean
  error: string
}
export const useEmoteWheel = create<WheelState>(() => ({ favorites: [], running: false, loaded: false, busy: false, error: '' }))

export function wheelError(error: unknown): string {
  const code = String(error)
  if (code.includes('already_running')) return 'Turtle: close the client to change the emote wheel.'
  if (code.includes('client_config_missing')) return 'Turtle: start the client once, then you can set the emote wheel here.'
  if (code.includes('native_required')) return 'Turtle: open the desktop launcher to use this feature.'
  return 'Turtle: the emote wheel could not be read or saved.'
}

export async function loadEmoteWheel() {
  try {
    const answer = await turtle<{ favorites: string[]; running: boolean }>('turtle_emote_wheel', {})
    useEmoteWheel.setState({ favorites: answer.favorites, running: answer.running, loaded: true, error: '' })
  } catch (e) {
    useEmoteWheel.setState({ loaded: true, error: wheelError(e) })
  }
}

export async function saveEmoteWheel(favorites: string[]) {
  if (useEmoteWheel.getState().busy) return
  useEmoteWheel.setState({ busy: true, error: '' })
  try {
    const answer = await turtle<{ favorites: string[]; running: boolean }>('turtle_emote_wheel', { favorites })
    useEmoteWheel.setState({ favorites: answer.favorites, running: answer.running, error: '' })
  } catch (e) {
    useEmoteWheel.setState({ error: wheelError(e) })
  } finally {
    useEmoteWheel.setState({ busy: false })
  }
}

/** Moves an emote one place earlier or later on the wheel. */
export function moved(list: readonly string[], id: string, step: -1 | 1): string[] {
  const at = list.indexOf(id)
  const to = at + step
  if (at < 0 || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[at], next[to]] = [next[to], next[at]]
  return next
}
