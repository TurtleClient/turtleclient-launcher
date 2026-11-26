import type { CartLine } from '../../../lib/turtleShop'
import { Icon } from '../../Icon'
import { TurtlePreview } from './TurtlePreview'

const BUNDLE_TONE: Record<string, string> = { angel_bundle: 'angel', demon_bundle: 'demon', husky_bundle: 'husky' }

/** Picture for a shop entry: the item on an animated figure; bundles keep their themed tile. */
export function ShopArt({ line }: { line: CartLine }) {
  return (
    <div className={'ts-art r-' + line.rarity + (line.bundle ? ' is-bundle t-' + (BUNDLE_TONE[line.id] || 'other') : '')} aria-hidden="true">
      {line.bundle ? <Icon id="i-box" className="icon ts-art-ic" /> : <TurtlePreview items={[{ kind: line.kind, id: line.id, hash: line.hash, slot: line.slot, owner: line.owner }]} />}
    </div>
  )
}
