import { expect, test } from 'bun:test'
import { serviceLoginErrorText } from './serviceLoginError'

test('Minecraft app approval and other refusals retain their distinct next steps', () => {
  const approval = serviceLoginErrorText('minecraft_app_registration_required')
  const forbidden = serviceLoginErrorText('minecraft_login_forbidden')
  expect(approval).toContain('https://aka.ms/mce-reviewappid')
  expect(approval).toContain('403')
  expect(forbidden).toContain('Minecraft Services')
  expect(forbidden).not.toContain('mce-reviewappid')
})

test('sign-in failures give a Turtle remedy without requiring another launcher', () => {
  expect(serviceLoginErrorText(new Error('horizon_auth_missing'))).toContain('TurtleClient Launcher')
  expect(serviceLoginErrorText(new Error('horizon_auth_missing'))).not.toContain('install Horizon')
  expect(serviceLoginErrorText('horizon_auth_failed')).toContain('Microsoft')
  expect(serviceLoginErrorText('horizon_auth_relogin')).toContain('Minecraft')
  expect(serviceLoginErrorText('http 500')).toBeUndefined()
})
