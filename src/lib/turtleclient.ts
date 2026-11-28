import { tauri } from '../ipc/tauri'
export interface TurtleSettings { executable: string; resources: string; game_dir: string; minecraft_source?:string }
export interface TurtleUpdateStatus {phase:string;version:string;downloaded:number;total:number;error:string}
export interface TurtleStatus { settings: TurtleSettings; running: boolean;update?:TurtleUpdateStatus;preparation?:{phase:string} }
export interface Friend { uuid: string; name: string; online: boolean }
export interface FriendList { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }
export interface Cosmetic { id: string; name: string; slot: string; owner: string; hash: string; type?:string; access?:'free'|'paid'; price_minor?:number; currency?:string }
export interface WardrobeCategory { id: string; label: Record<string, string>; slots: string[] }
export interface Categories { categories: WardrobeCategory[]; assignments: Record<string, string>; items?:Record<string,{type?:string;access?:'free'|'paid';price_minor?:number;currency?:string}> }
export interface Catalog { models: Cosmetic[]; capes: Cosmetic[]; free: boolean; categories?: Categories }
export interface WardrobeSnapshot { player: { uuid: string; name: string }; equipped: Record<string, string>; cape: boolean; cape_revision?: string | null; categories: Categories; owned?:string[] }
export const TURTLE_API = 'https://45.133.9.162/turtleclient'
export function turtle<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = tauri()
  return bridge ? bridge.core.invoke<T>(command, args) : Promise.reject(new Error('turtle_native_required'))
}
export const emptyFriends = (): FriendList => ({ friends: [], incoming: [], outgoing: [] })
export function serviceError(error: unknown): string {
  const code = String(error)
  if (code.includes('settings_corrupt')) return 'Turtle: the saved configuration is damaged. Open Game settings and save your resource and world folders again.'
  if (code.includes('settings_failed')) return 'Turtle: configuration could not be saved. Check write access to the launcher folder and try again.'
  if (code.includes('profile_unavailable')) return 'Turtle: Minecraft account verification is temporarily unavailable. Check your connection and try again.'
  if (code.includes('horizon_auth_failed') || code.includes('horizon_auth_relogin')) return 'Turtle: sign in with a Microsoft Minecraft account.'
  if (code.includes('horizon_auth_missing')) return 'The sign-in component is missing or damaged. Update or reinstall TurtleClient Launcher.'
  if (code.includes('start_failed')) return 'Turtle: the client could not be started. Check whether Windows security blocked it and try again.'
  if (code.includes('log_failed') || code.includes('session_failed')) return 'Turtle: start files could not be prepared. Check write access to your game folder.'
  if (code.includes('turtle_update_')) return 'Turtle: client update failed. Check your connection and try again.'
  if (code.includes('resources_prepare_failed')) return 'Turtle: resource preparation failed. Check your connection or choose your Modrinth folder in Game settings.'
  if (code.includes('resources_busy')) return 'Turtle: Minecraft resources are already being prepared.'
  if (code.includes('resources_source_invalid')) return 'Turtle: choose the Modrinth app folder or a Minecraft installation folder.'
  if (code.includes('404')) return 'Turtle: player not found. They must connect to Friends first.'
  if (code.includes('401') || code.includes('connect_required')) return 'Turtle: connect to Friends again.'
  if (code.includes('429')) return 'Turtle: too many requests. Please wait.'
  if (code.includes('login_required')) return 'Turtle: sign in with a Microsoft Minecraft account.'
  if (code.includes('executable')) return 'Turtle: select the TurtleClient executable.'
  if (code.includes('resources')) return 'Turtle: select the prepared Minecraft 26.3 resources.'
  if (code.includes('game_dir')) return 'Turtle: select an absolute game folder.'
  if (code.includes('already_running')) return 'Turtle: the client is already running.'
  if (code.includes('native_required')) return 'Turtle: open the desktop launcher to use this feature.'
  return 'Turtle: the operation failed. Check your connection and configuration.'
}
