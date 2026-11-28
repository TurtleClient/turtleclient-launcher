import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { turtle, serviceError } from '../lib/turtleclient'
import type { TurtleSettings, TurtleStatus } from '../lib/turtleclient'
import { Group, Row } from './SetKit'
import { setScreen, showToast } from '../state/ui'
import { useLobby } from '../state/lobbyMode'
import { clientUpdateLabel, useTurtleRuntime } from '../lib/useTurtleRuntime'
import { mergeTurtleSettings } from '../lib/turtleSettings'

export function TurtleRuntimeSettings() {
  const t = useT()
  const [config, setConfig] = useState<TurtleSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = useRef(new Set<keyof TurtleSettings>())
  const snapshot = useRef(0)
  const runtime=useTurtleRuntime(true)
  useEffect(() => {
    let live = true
    const ticket=++snapshot.current
    void turtle<TurtleStatus>('turtle_status').then(s => {if(live&&ticket===snapshot.current)setConfig(current=>mergeTurtleSettings(current,s.settings,dirty.current))}).catch(() => {})
    return () => {live=false}
  }, [runtime.clientUpdate?.phase])
  async function checkUpdates() {
    setBusy(true)
    try {await turtle('turtle_client_update')}
    catch(error){showToast(t(serviceError(error)),'error')}
    finally {setBusy(false)}
  }
  async function browse(field: keyof TurtleSettings) {
    const path = await turtle<string | null>('turtle_pick_path', { field }).catch(() => null)
    if (path) {dirty.current.add(field);setConfig(c => c && ({ ...c, [field]: path }))}
  }
  async function save() {
    setBusy(true)
    try {
      await turtle('turtle_configure', { settings: config, fields: [...dirty.current] })
      dirty.current.clear()
      const ticket=++snapshot.current
      const saved=await turtle<TurtleStatus>('turtle_status').catch(()=>null)
      if(saved&&ticket===snapshot.current)setConfig(saved.settings)
      showToast(t('Turtle: configuration saved.'))
    }
    catch (e) { showToast(t(serviceError(e)), 'error') }
    finally { setBusy(false) }
  }
  return <Group title="TurtleClient">
    <Row title={t('Turtle: play TurtleClient')}>
      <button className="btn sm primary" onClick={() => {useLobby.getState().pickNative(); setScreen('play')}}>{t('Turtle: select in lobby')}</button>
    </Row>
    <Row title={t('Turtle: automatic client updates')} hint={runtime.busy?clientUpdateLabel(runtime.clientUpdate):runtime.clientUpdate?.version?t('Turtle: client version {version}',{version:runtime.clientUpdate.version}):t('Turtle: checked whenever the launcher starts.')}>
      <button className="btn sm secondary" disabled={busy || runtime.busy} onClick={()=>void checkUpdates()}>{t('Turtle: check for client updates')}</button>
    </Row>
    {config && <Row title={t('Turtle: executable')} hint={config.executable} />}
    {config && (['minecraft_source', 'resources', 'game_dir'] as const).map(field => <Row key={field} title={t(field === 'minecraft_source' ? 'Turtle: Minecraft source (Modrinth or other launcher)' : field === 'resources' ? 'Turtle: resources' : 'Turtle: game folder')} hint={config[field] || t('Turtle: automatic')}>
      <button className="btn sm secondary" disabled={busy || runtime.busy} onClick={() => void browse(field)}>{t('Turtle: browse')}</button>
    </Row>)}
    <Row title={t('Turtle: native client')} hint={t('Turtle: Modrinth and other launchers are detected automatically. Resources are prepared on the first start; no separate Horizon installation is needed.')}>
      <button className="btn sm primary" disabled={!config || busy || runtime.busy} onClick={() => void save()}>{t('Turtle: save configuration')}</button>
    </Row>
  </Group>
}
