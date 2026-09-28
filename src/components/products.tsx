"use client";
import Image from "next/image";
import Link from "next/link";
import type {Product} from "@/lib/types";
import {conditionCode} from "@/lib/filters";
import {CartNotice,useShop} from "./shop-provider";
import {Icon} from "./icon";
import {Price} from "./price";
import {Modal} from "./modal";
import {SkinInspection} from "./skin-inspection";
export function ProductCard({product}:{product:Product}){
  const shop=useShop();const added=shop.cart.some(p=>p.id===product.id);
  return <article className={`product-card rarity-${product.categoryId}`}><div className="product-meta"><span>{product.stattrak?"STATTRAK™":"CS2"}</span><abbr title={product.condition}>{conditionCode(product.condition)}</abbr><button className="favorite-button" aria-label={`${shop.favorites.includes(product.id)?"Убрать из избранного":"В избранное"}: ${product.name}`} aria-pressed={shop.favorites.includes(product.id)} onClick={()=>shop.toggleFavorite(product.id)}><Icon name="heart" size={17}/></button></div><button className="product-image-button" aria-label={`Быстрый просмотр: ${product.name}`} onClick={()=>shop.setPreviewProduct(product)}><Image src={product.imageUrl} alt={product.name} width={400} height={300}/><span className="quick-label"><Icon name="eye" size={15}/> Быстрый просмотр</span></button><div className="product-info"><span className="weapon-name">{product.weapon}</span><h3><Link href={`/catalog/${product.id}`}>{product.finish}</Link></h3><div className="product-bottom"><Price minor={product.priceMinor}/><CartAction product={product} compact added={added}/></div></div></article>;
}
export function ProductDetails({product,quick=false}:{product:Product;quick?:boolean}){
  const shop=useShop();const category=shop.categories.find(c=>c.id===product.categoryId);
  return <div className={`product-detail ${quick?"quick-detail":"full-detail"}`}>{!quick?<SkinInspection product={product}/>:<div className="detail-visual"><span className="eyebrow">COUNTER-STRIKE 2 / {conditionCode(product.condition)}</span><Image src={product.imageUrl} alt={product.name} width={900} height={700} loading="eager"/><span className="detail-image-note">{product.weapon} <span>↗</span></span></div>}<div className="detail-content"><span className="eyebrow pink">{category?.name} {product.stattrak?" / STATTRAK™":""}</span>{quick?<h2>{product.weapon}<span>{product.finish}</span></h2>:<h1>{product.weapon}<span>{product.finish}</span></h1>}<p className="muted">{product.condition}</p>{!quick&&<div className="skin-specs"><div><span>Категория</span><strong>{category?.name}</strong></div><div><span>Качество</span><strong>{product.stattrak?"StatTrak™":/^Souvenir\s/i.test(product.name)?"Сувенирное":"Обычное"}</strong></div></div>}<div className="float-block"><div><span>Степень износа / Float</span><strong>{product.float===null?"Не указан":product.float.toFixed(6)}</strong></div><div className="float-track">{product.float!==null&&<span style={{left:`${Math.min(100,product.float*100)}%`}}/>}</div><div className="float-labels"><span>FN</span><span>MW</span><span>FT</span><span>WW</span><span>BS</span></div></div><div className="detail-price-block"><span className="eyebrow">СТОИМОСТЬ</span><Price minor={product.priceMinor} large/></div><CartAction product={product} added={shop.cart.some(p=>p.id===product.id)}/><div className="payment-row"><span>Способы оплаты</span><b>Карта</b><b>СБП</b></div>{quick&&<Link className="text-link" href={`/catalog/${product.id}`} onClick={()=>shop.setPreviewProduct(null)}>Подробнее о скине <Icon name="diagonal" size={16}/></Link>}<p className="product-description">{product.description}</p></div></div>;
}
export function QuickView(){
  const shop=useShop();return shop.previewProduct?<Modal wide title={shop.previewProduct.name} onClose={()=>shop.setPreviewProduct(null)}><ProductDetails product={shop.previewProduct} quick/><CartNotice/></Modal>:null;
}

export function CartAction({product,added,compact=false}:{product:Product;added:boolean;compact?:boolean}){
 const shop=useShop();
 const className=compact?`add-button ${added?"added":""}`:"button primary full";
 return added?<Link className={className} href="/cart" aria-label={compact?`Перейти в корзину: ${product.name}`:undefined} onClick={()=>{shop.setPreviewProduct(null);shop.dismissNotice();}}><Icon name="cart"/>{!compact&&<>Перейти в корзину<Icon name="arrow"/></>}</Link>:<button className={className} onClick={()=>shop.add(product)} aria-label={compact?`В корзину: ${product.name}`:undefined}><Icon name={compact?"plus":"cart"}/>{!compact&&<>В корзину<Icon name="arrow"/></>}</button>;
}
