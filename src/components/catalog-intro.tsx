import type {Catalog} from '@/lib/types';
export function CatalogIntro({catalog,category}:{catalog:Catalog;category:string}){return <div className="catalog-intro"><span className="eyebrow">КОЛЛЕКЦИЯ PRISM / CS2</span><h1>{catalog.categories.find(c=>c.id===category)?.name??'Твой следующий скин.'}</h1><p>Рассмотри детали. Сравни. Выбери своё.</p></div>;}
