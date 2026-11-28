import type { TurtleSettings } from './turtleclient'

/** Keep explicit edits while refreshing managed paths after an update. */
export function mergeTurtleSettings(current: TurtleSettings | null, next: TurtleSettings, dirty: ReadonlySet<keyof TurtleSettings>): TurtleSettings {
  const result = { ...next }
  if (current) for (const field of dirty) Object.assign(result, { [field]: current[field] })
  return result
}
