import {Home} from "@/components/home";
import {getCatalog} from "@/lib/catalog";
export default function Page(){return <Home catalog={getCatalog()}/>;}
