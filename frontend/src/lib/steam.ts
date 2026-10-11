import {validSteamId} from "./validation.ts";
export class SteamError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
export async function lookupSteamProfile(steamId:string,fetcher:typeof fetch=fetch){
  if(!validSteamId(steamId))throw new SteamError(400,"Введите корректный Steam ID из 17 цифр.");
  let xml:string;
  try{
    const response=await fetcher(`https://steamcommunity.com/profiles/${steamId}/?xml=1`,{redirect:"error",signal:AbortSignal.timeout(12000),cache:"no-store"});
    if(!response.ok||!response.body)throw new Error("Steam unavailable");
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw new Error("Profile too large");}chunks.push(value);}
    xml=Buffer.concat(chunks).toString("utf8");
  }catch{throw new SteamError(502,"Steam временно не отвечает. Повторите проверку позже.");}
  const id=/<steamID64>(\d{17})<\/steamID64>/.exec(xml)?.[1];
  if(id!==steamId){if(/<error>/.test(xml)&&/could not be found|does not exist/i.test(xml))throw new SteamError(404,"Аккаунт с таким Steam ID не найден.");throw new SteamError(502,"Steam не подтвердил профиль. Повторите проверку.");}
  const name=/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/.exec(xml)?.[1]?.slice(0,100)??steamId;
  return {steamId,name,profileUrl:`https://steamcommunity.com/profiles/${steamId}`};
}
