import '../../styles/pixel/nametag.css'
import { useEffect, useState } from 'react'
import { useTurtleWardrobe } from '../../state/turtleWardrobe'
import { useAccounts } from '../../state/accounts'
import { turtleTagColor } from '../../lib/turtleTag'
import { BRAND } from '../../lib/branding'
import { useTurtleShop } from '../../state/turtleShop'
import { rankFromInventory, rankIcon, useTurtleRanks } from '../../state/turtleRanks'
import type { TurtleRank } from '../../state/turtleRanks'

/**
 * Ник над головой, как в Minecraft: пиксельный шрифт, полупрозрачная тёмная
 * плашка, тень у букв. Ставится над самой высокой точкой фигуры вместе с
 * косметикой — шляпа, нимб и крылья ника не перекрывают.
 */
export function Nametag({ nick, at, own=false }: { nick: string; at: { x: number; y: number } | null; own?:boolean }) {
  const wardrobe=useTurtleWardrobe()
  const active=useAccounts(state=>state.active)
  // The worn name tag effect: from Ocean's inventory, or from the older wardrobe until it answers.
  const mine=own && ((!!wardrobe.snapshot && wardrobe.accountId===active) || wardrobe.oceanAccount===active)
  const model=mine ? Object.values(wardrobe.models).find(model=>model.slot==='name_tag') : undefined
  const name=own && wardrobe.accountId===active ? wardrobe.snapshot?.player.name || nick : nick
  // The player's TurtleClient rank icon before their own name (owner, 27.11.2026).
  const ranked=useTurtleRanks(state=>state.accountId===active ? state.me : null)
  const inventory=useTurtleShop(state=>state.accountId===active ? state.inventory : null)
  const microsoft=useAccounts(state=>state.list.find(a=>a.id===state.active)?.kind==='microsoft')
  const rank:TurtleRank|null=!own || BRAND.services || !microsoft ? null : ranked ?? (inventory ? rankFromInventory(inventory.role,inventory.plus_until) : null)
  const [time,setTime]=useState(Date.now())
  useEffect(()=>{
    if(!model?.tag?.animation || !at)return
    let frame=0,last=0
    const update=(now:number)=>{if(now-last>=50){last=now;setTime(Date.now())}frame=requestAnimationFrame(update)}
    frame=requestAnimationFrame(update)
    return()=>cancelAnimationFrame(frame)
  },[model,!!at])
  if (!name || !at) return null
  return (
    <span className="mc-nametag" style={{ left: at.x + 'px', top: at.y + 'px',...(model?.tag?{borderBottom:'2px solid '+turtleTagColor(model.tag.animation,model.tag.line,time)}:{}) }}>
      {rank ? <img className="mc-nametag-rank" src={rankIcon(rank)} alt="" width={18} height={18} /> : null}
      {model?.tag ? [...name].map((char,index)=><span key={index} style={{color:turtleTagColor(model.tag!.animation,model.tag!.line,time,index,name.length)}}>{char}</span>) : name}
    </span>
  )
}

/** Где рисовать ник: над верхом кадра фигуры (NDC) в пикселях сцены. */
export function nametagSpot(
  ndc: { minX: number; maxX: number; maxY: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (((ndc.minX + ndc.maxX) / 2 + 1) / 2) * width,
    y: (1 - (ndc.maxY + 1) / 2) * height - 8,
  }
}
