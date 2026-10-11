"use client";
import Link from "next/link";
import {Icon} from "./icon";
export function EmptyInventory(){return <section className="empty-basket"><Icon name="cart" size={32}/><h2>В корзине пока нет предметов</h2><p>Добавленные скины появятся здесь вместе с расчётом стоимости.</p><Link className="button primary" href="/catalog">Каталог CS2 <Icon name="arrow"/></Link></section>;}
