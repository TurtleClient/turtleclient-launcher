import type { CSSProperties } from 'react'

/** Shells, Turtle's shop currency: a pixel turtle shell seen from above. */
const ROWS = [
  '...oooooo...',
  '.ooggddggoo.',
  'ohhdggggdggo',
  'ohdddggdddgo',
  'odggdggdggdo',
  'odggdggdggdo',
  'ogdddggdddgo',
  'oggdggggdggo',
  '.ooggddggoo.',
  '...oooooo...',
]
const COLORS: Record<string, string> = { o: '#173d1c', g: '#4f9d3a', d: '#2d6a27', h: '#a8e07a' }
const RECTS = ROWS.flatMap((row, y) => Array.from(row).flatMap((c, x) => (COLORS[c] ? [{ x, y, fill: COLORS[c] }] : [])))

export function ShellIcon({ size = 18, className, style, title }: { size?: number; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg
      className={'shell-ic' + (className ? ' ' + className : '')}
      style={style}
      width={size}
      height={Math.round((size * 10) / 12)}
      viewBox="0 0 12 10"
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {RECTS.map(r => (
        <rect key={r.x + ':' + r.y} x={r.x} y={r.y} width={1} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** Amount with the shell icon, grouped by the player's locale. */
export function Shells({ amount, size = 16, locale }: { amount: number; size?: number; locale: string }) {
  return (
    <span className="shells">
      <ShellIcon size={size} />
      <b>{amount.toLocaleString(locale)}</b>
    </span>
  )
}
