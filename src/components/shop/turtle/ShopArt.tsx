import { useState } from 'react'
import { TURTLE_API } from '../../../lib/turtleclient'
import type { CartLine } from '../../../lib/turtleShop'
import { Icon } from '../../Icon'
import { ModelShot } from '../TurtleCatalog'

const KIND_ICON: Record<string, string> = { aura: 'i-sparkle', trail: 'i-flame', emote: 'i-hand', pet: 'i-paw', bundle: 'i-box', cape: 'i-cape' }
const BUNDLE_TONE: Record<string, string> = { angel_bundle: 'angel', demon_bundle: 'demon', husky_bundle: 'husky' }

/** Picture for a shop entry: 3D model, cape image, or a large kind symbol on a rarity backdrop. */
export function ShopArt({ line }: { line: CartLine }) {
  const [failed, setFailed] = useState(false)
  let body
  if (line.kind === 'model') body = <ModelShot item={line} />
  else if (line.kind === 'cape' && !failed)
    body = <img src={`${TURTLE_API}/api/shop/asset/${line.hash}`} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
  else body = <Icon id={KIND_ICON[line.kind] || 'i-star'} className="icon ts-art-ic" />
  return (
    <div className={'ts-art r-' + line.rarity + (line.bundle ? ' is-bundle t-' + (BUNDLE_TONE[line.id] || 'other') : '')} aria-hidden="true">
      {body}
    </div>
  )
}
