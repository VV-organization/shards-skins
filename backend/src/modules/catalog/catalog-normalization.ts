export type SkinCategory = 'knife'|'gloves'|'rifle'|'pistol'|'smg'|'heavy'|'other';
export type NormalizedSkin={categoryId:SkinCategory|null;weapon:string;condition:string;stattrak:boolean};
const wears:Record<string,string>={'Factory New':'FN','Minimal Wear':'MW','Field-Tested':'FT','Well-Worn':'WW','Battle-Scarred':'BS'};
export function normalizeSkin(marketName:string,metadata?:{categoryName?:string|null;productType?:string|null}):NormalizedSkin {
  const stattrak=/StatTrak(?:™)?/i.test(marketName);
  const plain=marketName.replace(/^(?:★\s*|StatTrak™?\s*|Souvenir\s*)+/i,'');
  const weapon=(plain.split('|')[0]??'').trim().replace(/\s*\([^()]+\)$/,'');
  const wear=/\(([^()]+)\)\s*$/.exec(marketName)?.[1];
  const condition=wear?wears[wear]??'':'';
  const meta=`${metadata?.categoryName??''} ${metadata?.productType??''}`.toLowerCase();
  let categoryId:SkinCategory|null=null;
  if(/Gloves|Hand Wraps/i.test(weapon)||/перчат|обмотк|gloves/.test(meta))categoryId='gloves';
  else if(/Knife|Bayonet|Karambit|Daggers|Kukri/i.test(weapon)||/нож|knives|knife/.test(meta))categoryId='knife';
  else if(/^(AK-47|AUG|FAMAS|Galil AR|M4A1-S|M4A4|SG 553|AWP|G3SG1|SCAR-20|SSG 08)$/.test(weapon))categoryId='rifle';
  else if(/^(Desert Eagle|Dual Berettas|Five-SeveN|Glock-18|P2000|P250|R8 Revolver|Tec-9|USP-S|CZ75-Auto)$/.test(weapon))categoryId='pistol';
  else if(/^(MAC-10|MP5-SD|MP7|MP9|P90|PP-Bizon|UMP-45)$/.test(weapon))categoryId='smg';
  else if(/^(MAG-7|Nova|Sawed-Off|XM1014|M249|Negev)$/.test(weapon))categoryId='heavy';
  else if(/sticker|наклейк|agent|агент|кейс|case|key|ключ|music|музык|patch|нашив|graffiti|граффит|charm|брелок/.test(meta))categoryId='other';
  return {categoryId,weapon,condition,stattrak};
}
