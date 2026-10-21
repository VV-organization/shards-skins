import type {Metadata} from 'next';
import {LegalDocument} from '@/components/legal-document';
import blocks from '@/lib/legal/privacy.json';

export const metadata: Metadata = {title: 'Политика конфиденциальности', robots: {index: false, follow: true}};
export default function Page() {return <LegalDocument blocks={blocks} current="privacy"/>;}
