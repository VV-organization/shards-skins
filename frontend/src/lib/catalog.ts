import snapshot from "../data/catalog.json";
import type { Catalog, Product } from "./types";

export function getCatalog(): Catalog {
  if (process.env.NEXT_PUBLIC_CATALOG_MODE === "live") return {mode:"unavailable",products:[],categories:[],capturedAt:""};
  const basePath=process.env.NEXT_PUBLIC_BASE_PATH??"";
  return {...snapshot,products:snapshot.products.map(product=>({...product,imageUrl:basePath+product.imageUrl}))} as Catalog;
}
export const featuredIds = ["swap-0282387e3432", "swap-5c3715c0960b", "baron-1a5f3d48-c150-4cf6-ad3a-9e5916c737c3", "swap-6aa7ec4ed3fb", "swap-a360a2cd8d9d", "swap-8d1c7a992820", "swap-ba19f94fd9cd", "swap-64ba82db6655"];
export function featuredProducts(products: Product[]) {
  return featuredIds.map(id => products.find(p=>p.id===id)).filter((p):p is Product => Boolean(p));
}
