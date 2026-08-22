import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://central-frota.onrender.com'),
  title: 'Central Frota | Operação integrada',
  description: 'Atendimento, planos de ação, equipe, notas fiscais, frota, DRE, Benner e Portal Fiscal em uma central de gestão.',
  openGraph: {
    title: 'Central Frota',
    description: 'Atendimento compartilhado e gestão completa da operação de frota.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Central Frota' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Central Frota',
    description: 'Atendimento compartilhado e gestão completa da operação de frota.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={geist.variable}>{children}</body></html>;
}
