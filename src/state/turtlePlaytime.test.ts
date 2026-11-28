import { expect, mock, test } from 'bun:test'
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
} })
let read: () => Promise<unknown> = async () => ({ seconds: 7200 })
mock.module('../lib/turtleclient', () => ({ turtle: () => read() }))
const { refreshTurtlePlaytime, useTurtlePlaytime } = await import('./turtlePlaytime')
test('cached time survives restart and service errors, without leaking to another account', async () => {
  read = async () => ({ seconds: 7200 })
  await refreshTurtlePlaytime('Alice')
  useTurtlePlaytime.setState({ accountId: null, seconds: null })
  read = async () => { throw new Error('offline') }
  await refreshTurtlePlaytime('Alice')
  expect(useTurtlePlaytime.getState().seconds).toBe(7200)
  await refreshTurtlePlaytime('Bob')
  expect(useTurtlePlaytime.getState().seconds).toBeNull()
  read = async () => ({})
  await refreshTurtlePlaytime('Alice')
  expect(useTurtlePlaytime.getState().seconds).toBe(7200)
})
test('a late reply cannot replace the newly selected account', async () => {
  let finish!: (value: unknown) => void
  read = () => new Promise(resolve => { finish = resolve })
  const pending = refreshTurtlePlaytime('Alice')
  read = async () => ({ seconds: 60 })
  await refreshTurtlePlaytime('Bob')
  finish({ seconds: 7500 }); await pending
  expect(useTurtlePlaytime.getState()).toEqual({ accountId: 'Bob', seconds: 60 })
})
