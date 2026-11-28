import { expect, test } from 'bun:test'
import { mergeTurtleSettings } from './turtleSettings'
test('updates refresh managed paths but preserve only deliberate user edits', () => {
  const before = { executable: 'old-client', resources: 'old-resources', game_dir: 'custom-worlds' }
  const fresh = { executable: 'new-client', resources: 'new-resources', game_dir: 'stored-worlds' }
  expect(mergeTurtleSettings(before, fresh, new Set(['game_dir']))).toEqual({ ...fresh, game_dir: 'custom-worlds' })
  expect(mergeTurtleSettings(before, fresh, new Set())).toEqual(fresh)
})
