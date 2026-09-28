import {NextResponse} from "next/server";
import {unavailableTopup} from "@/lib/integrations";
export async function POST(_request:Request,{params}:{params:Promise<{kind:string}>}){const {kind}=await params;if(kind!=="balance"&&kind!=="steam")return NextResponse.json({error:"Не найдено."},{status:404});const result=unavailableTopup(kind);return NextResponse.json(result.body,{status:result.status});}
