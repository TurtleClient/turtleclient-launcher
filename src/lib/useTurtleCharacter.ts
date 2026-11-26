import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { SkinViewEngine } from '../vendor/mine3d'
import { useAccounts } from '../state/accounts'
import { useTurtleWardrobe } from '../state/turtleWardrobe'
import { useTurtleShop } from '../state/turtleShop'
import { buildTurtleCosmetic } from './turtleGeometry'
import { turtle } from './turtleclient'
import { loadImg } from './skinArms'

/** The engine's root anchor sits at the neck; the effects are drawn with the feet at y = 0. */
const FEET_BELOW_NECK = 24

export function useTurtleCharacter(viewer:RefObject<SkinViewEngine | null>,ready:number,onDressed?:()=>void) {
  const notify=useRef(onDressed);notify.current=onDressed
  const wardrobe=useTurtleWardrobe()
  const active=useAccounts(s=>s.active)
  // Ocean's inventory (shop items included) or, until it answers, the older wardrobe.
  const mine=(!!wardrobe.snapshot && wardrobe.accountId===active) || wardrobe.oceanAccount===active
  const effectKey=mine?wardrobe.effects.map(e=>e.kind+':'+e.id).join(','):''
  useEffect(()=>{
    const engine=viewer.current
    if(!engine || !ready)return
    engine.clearCosmetics()
    if(!mine)return
    let alive=true
    const built:Awaited<ReturnType<typeof buildTurtleCosmetic>>[]=[]
    const effects:{dispose():void}[]=[]
    void Promise.all(Object.values(wardrobe.models).filter(model=>model.slot!=='name_tag').map(model=>
      buildTurtleCosmetic(model).then(result=>{
        if(!alive){result.dispose();return}
        built.push(result)
        for(const piece of result.pieces)engine.attachCosmetic(piece.anchor,piece.object)
      }).catch(()=>{})
    )).then(async()=>{
      if(!alive || !wardrobe.effects.length)return
      // Auras and trails as on the website and in the client: drawn around the figure.
      const {turtleAura,turtleTrail}=await import('./turtleEffects')
      if(!alive)return
      for(const worn of wardrobe.effects){
        // The effect animates itself each frame, exactly as the client draws it.
        const effect=worn.kind==='aura'?turtleAura(worn.id):turtleTrail(worn.id)
        effect.object.position.y=-FEET_BELOW_NECK
        engine.attachCosmetic('root',effect.object)
        effects.push(effect)
      }
    }).then(()=>{if(alive)notify.current?.()})
    return ()=>{alive=false;engine.clearCosmetics();built.forEach(model=>model.dispose());effects.forEach(effect=>effect.dispose())}
  },[ready,active,mine,wardrobe.models,effectKey,viewer])
  // The cape Ocean serves for the player: a bought cape, or the team cape (a GIF) when worn.
  const teamCape=useTurtleShop(s=>s.accountId===active && !!s.inventory?.team_cape_equipped)
  const accountUuid=useAccounts(s=>s.list.find(a=>a.id===s.active)?.uuid||'')
  useEffect(()=>{
    const engine=viewer.current
    if(!engine || !ready)return
    const own=!!wardrobe.snapshot && wardrobe.accountId===active
    const uuid=own?wardrobe.snapshot!.player.uuid:wardrobe.oceanAccount===active?accountUuid:''
    if(!uuid || !((own && wardrobe.snapshot!.cape) || teamCape)){engine.clearCape();return}
    let alive=true
    void turtle<string|null>('turtle_cape',{uuid}).then(src=>src?loadImg(src):null).then(image=>{if(alive)return image?engine.setCape(image):engine.clearCape()}).then(()=>{if(alive)notify.current?.()}).catch(()=>{})
    return()=>{alive=false}
  },[ready,active,wardrobe.accountId,wardrobe.oceanAccount,wardrobe.snapshot?.cape,wardrobe.snapshot?.cape_revision,teamCape,accountUuid,viewer])
}
