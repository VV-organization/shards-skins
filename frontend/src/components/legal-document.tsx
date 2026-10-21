import Link from 'next/link';

type LegalBlock = {kind: string; text?: string; id?: string; start?: number; items?: string[]};

export function LegalDocument({blocks, current}: {blocks: LegalBlock[]; current: 'privacy' | 'terms'}) {
  return <div className="page-container legal-page">
    <div className="legal-content">
      <nav className="legal-navigation" aria-label="Правовая информация">
        <Link href="/">Главная</Link>
        <Link href="/terms" aria-current={current === 'terms' ? 'page' : undefined}>Пользовательское соглашение</Link>
        <Link href="/privacy" aria-current={current === 'privacy' ? 'page' : undefined}>Политика конфиденциальности</Link>
      </nav>
      <article className="legal-document">
        {blocks.map((block, index) => {
          if (block.kind === 'title') return <h1 key={index}>{block.text}</h1>;
          if (block.kind === 'heading') return <h2 key={index}>{block.text}</h2>;
          if (block.kind === 'list') return <ol key={index} start={block.start}>{block.items?.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>;
          return <p key={index} className={block.kind === 'revision' ? 'legal-revision' : undefined}>{block.text || <br/>}</p>;
        })}
      </article>
    </div>
  </div>;
}
