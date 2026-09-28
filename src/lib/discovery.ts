import type {Product} from "./types.ts";
import {prismToRub, parseAmount} from "./money.ts";

export const curatedColors = {
  orange: [
    "baron-2543db74-1727-4fe4-b923-decbc9dd9d1e", // Desert Eagle | Механо-пушка
    "baron-9329f0e9-76fc-4ae9-947e-d4b6d9e405c4", // FAMAS | Авария
    "swap-ba19f94fd9cd", // AK-47 | Asiimov
    "swap-35d1bd8ccb42", // M9 Bayonet | Tiger Tooth
    "baron-278fde16-087b-4014-9ca3-3517bff94bce", // AUG | Пламенный Ёрмунганд
  ],
  blue: [
    "swap-0a7a560b8522", // P250 | Undertow
    "baron-83abe985-036c-4fc4-9eae-50dba886f7c5", // USP-S | Путеводитель
    "swap-75bd510204bb", // M4A4 | Cyber Security
    "baron-4d87d012-3437-4ce8-8cdb-510b213f41d7", // Desert Eagle | Ржавый кобальт
    "swap-792a31fd6da7", // Butterfly Knife | Blue Steel
    "swap-118b28a7085c", // Karambit | Blue Steel
  ],
  mono: [
    "baron-1a5f3d48-c150-4cf6-ad3a-9e5916c737c3", // USP-S | Printstream
    "swap-1557c8700f3a", // USP-S | Whiteout
    "baron-1058eb36-9557-4a3c-bde0-12a4937ea9cd", // Керамбит | Черный глянец
    "swap-466dad7996bd", // Falchion Knife | Black Laminate
    "baron-765cbc04-26de-413a-97c4-27ad9bfb150c", // Штык-нож M9 | Черный глянец
  ],
} as const;

export type DiscoveryColor = keyof typeof curatedColors;

export function filterDiscovery(products:Product[], color:DiscoveryColor, budgetRub:string) {
  const budget=budgetRub.trim() ? parseAmount(budgetRub) : null;
  if (budgetRub.trim() && budget===null) return {count:0,items:[] as Product[],invalidBudget:true};
  const available=new Map(products.map(product=>[product.id,product]));
  const matching=curatedColors[color]
    .map(id=>available.get(id))
    .filter((product):product is Product=>Boolean(product))
    .filter(product=>budget===null || prismToRub(product.priceMinor)<=budget);
  return {count:matching.length,items:matching.slice(0,3),invalidBudget:false};
}
