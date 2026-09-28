import Link from "next/link";
export default function NotFound(){return <div className="page-container empty-state error-page"><span className="eyebrow pink">404 / НЕ НАЙДЕНО</span><h1>Этот раунд без результата</h1><p>Страница или скин больше не доступны.</p><Link className="button primary" href="/catalog">Вернуться в каталог ↗</Link></div>;}
