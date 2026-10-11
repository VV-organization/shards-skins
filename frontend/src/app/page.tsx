import {Home} from "@/components/home";
import {getCatalog} from "@/lib/catalog";
export default async function Page(){return <Home catalog={await getCatalog()}/>;}
