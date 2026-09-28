import {NextResponse} from "next/server";
import {unavailablePurchase} from "@/lib/integrations";
export async function POST(){const result=unavailablePurchase();return NextResponse.json(result.body,{status:result.status});}
