import {NextResponse} from "next/server";
import {lookupSteamProfile,SteamError} from "@/lib/steam";
import {validSteamId} from "@/lib/validation";
let windowStart=0;let calls=0;let active=0;
export async function POST(request:Request){
  const allowedOrigin=process.env.APP_ORIGIN??"http://127.0.0.1:5198";
  if(request.headers.get("origin")&&request.headers.get("origin")!==allowedOrigin)return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
  if(Number(request.headers.get("content-length")??0)>1024)return NextResponse.json({error:"Запрос слишком большой."},{status:413});
  let body;try{const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;if(!reader)throw new Error("Missing body");while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return NextResponse.json({error:"Запрос слишком большой."},{status:413});}chunks.push(value);}body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return NextResponse.json({error:"Некорректный запрос."},{status:400});}
  if(!validSteamId(body?.steamId))return NextResponse.json({error:"Введите корректный Steam ID из 17 цифр."},{status:400});
  if(Date.now()-windowStart>60000){windowStart=Date.now();calls=0;}
  if(calls>=30||active>=4)return NextResponse.json({error:"Слишком много проверок. Попробуйте через минуту."},{status:429,headers:{"Retry-After":"60"}});
  calls++;active++;
  try{return NextResponse.json(await lookupSteamProfile(body.steamId),{headers:{"Cache-Control":"no-store"}});}catch(error){return NextResponse.json({error:error instanceof SteamError?error.message:"Проверка Steam временно недоступна."},{status:error instanceof SteamError?error.status:503});}finally{active--;}
}
