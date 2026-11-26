import { useEffect, useRef } from 'react'
import type { PreviewItem } from '../../../lib/turtlePreview'
import { useAccounts } from '../../../state/accounts'
import { Icon } from '../../Icon'
import '../../../styles/pixel/turtle-preview.css'

const KIND_ICON: Record<string, string> = { aura: 'i-sparkle', trail: 'i-flame', emote: 'i-hand', pet: 'i-paw', cape: 'i-cape', model: 'i-star' }

/** Every preview figure wears the active player's own skin and name, as in the client. */
function usePlayerOnFigure() {
  const account = useAccounts(s => s.list.find(a => a.id === s.active) || null)
  useEffect(() => {
    if (!account) return
    let live = true
    void Promise.all([import('../../../lib/turtlePreview'), import('../../../lib/minecraftSkin')])
      .then(([preview, skins]) => {
        preview.setPreviewName(account.nick)
        return skins.loadMinecraftSkin(account).then(skin => {
          if (live) void preview.setPreviewSkin(skin.skin, skin.slim)
        })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [account?.id, account?.nick, account?.uuid])
}

/**
 * Animated figure wearing or playing the items, as on the Turtle website. The renderer
 * loads on first use, so screens without previews do not carry three.js at start.
 */
export function TurtlePreview({ items, className }: { items: PreviewItem[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  usePlayerOnFigure()
  const key = items.map(i => i.kind + ':' + i.id + ':' + i.hash).join('|')
  useEffect(() => {
    const el = ref.current
    if (!el || !items.length) return
    let off = () => {}
    let live = true
    void import('../../../lib/turtlePreview').then(module => {
      if (live) off = module.attachPreview(el, items)
    })
    return () => {
      live = false
      off()
    }
    // The key covers every field the figure depends on.
  }, [key])
  return (
    <div ref={ref} className={'tp' + (className ? ' ' + className : '')} aria-hidden="true">
      <Icon id={KIND_ICON[items[0]?.kind] || 'i-star'} className="icon tp-wait" />
      <canvas className="tp-canvas" />
    </div>
  )
}
