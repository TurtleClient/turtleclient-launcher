import { useEffect, useState } from 'react'
import { launchTurtleClient, stopTurtleClient } from './turtleLaunch'
import { turtle } from './turtleclient'
import type { TurtleStatus, TurtleUpdateStatus } from './turtleclient'
import { t } from '../i18n'
export function clientUpdateLabel(update?:TurtleUpdateStatus) {
  if(update?.phase==='preparing_resources')return t('Turtle: preparing Minecraft resources… The first start can take a few minutes.')
  if(update?.phase==='checking')return t('Turtle: checking client updates…')
  if(update?.phase==='downloading')return t('Turtle: downloading client… {percent}%',{percent:Math.floor(100*update.downloaded/Math.max(1,update.total))})
  if(update?.phase==='installing')return t('Turtle: installing client…')
  return t('Turtle: starting…')
}
export function useTurtleRuntime(enabled: boolean) {
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [clientUpdate,setClientUpdate]=useState<TurtleUpdateStatus | undefined>()
  const [poll, setPoll] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const update = () => turtle<TurtleStatus>('turtle_status').then(s => { if (live) {setRunning(s.running);setClientUpdate(s.preparation?.phase==='preparing_resources'?{phase:'preparing_resources',version:'26.3',downloaded:0,total:0,error:''}:s.update)} }).catch(() => {})
    void update()
    const timer = setInterval(() => void update(), 3000)
    return () => {live = false; clearInterval(timer)}
  }, [enabled, poll])
  return {
    running,
    stopping,
    busy:busy || ['checking','downloading','installing','preparing_resources'].includes(clientUpdate?.phase || ''),
    clientUpdate,
    launch: async () => {setBusy(true); try {await launchTurtleClient()} finally {setBusy(false); setPoll(n => n + 1)}},
    stop: async () => {setStopping(true); try {await stopTurtleClient()} finally {setStopping(false); setRunning(false); setPoll(n => n + 1)}},
  }
}
