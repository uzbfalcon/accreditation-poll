import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'clamo.uz - Tibbiyot Akkreditatsiyasi Baholash Tizimi',
  description: 'O‘zbekiston Respublikasi Sog‘liqni saqlash vazirligi milliy akkreditatsiya standartlari (75 standart, 275 mezon) asosidagi baholash tizimi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz" className="h-full">
      <body className="bg-slate-50 text-slate-900 h-full flex flex-col antialiased selection:bg-teal-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
