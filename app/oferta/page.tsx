import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSitePage } from '@/lib/db';
import LegalDocument from '@/components/LegalDocument';
import PrintButton from '@/components/PrintButton';

// Matn Django admin'da tahrirlanadi — har so'rovda bazadan o'qiladi
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ommaviy oferta — clamo.uz',
  description: 'CLAMO platformasidan foydalanish toʻgʻrisidagi ommaviy oferta',
};

export default function OfertaPage() {
  const page = getSitePage('oferta');
  if (!page) notFound();

  return (
    <div className="min-h-full bg-slate-50 print:bg-white">
      <header className="bg-white border-b border-slate-200 print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CLAMO" className="h-7 w-auto object-contain" />
          </Link>
          <PrintButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 print:p-0">
        <article className="bg-white border border-slate-200 rounded-2xl shadow-xs p-6 sm:p-10 print:border-0 print:shadow-none print:p-0">
          <LegalDocument content={page.content} />
          {page.updated_at && (
            <p className="mt-10 pt-4 border-t border-slate-100 text-xs text-slate-400">
              Oxirgi yangilanish: {page.updated_at}
            </p>
          )}
        </article>
      </main>
    </div>
  );
}
