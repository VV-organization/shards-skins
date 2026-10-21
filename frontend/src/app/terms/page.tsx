import type {Metadata} from 'next';
import {LegalDocument} from '@/components/legal-document';
import blocks from '@/lib/legal/terms.json';

export const metadata: Metadata = {title: 'Пользовательское соглашение', robots: {index: false, follow: true}};
export default function Page() {return <LegalDocument blocks={blocks} current="terms"/>;}
