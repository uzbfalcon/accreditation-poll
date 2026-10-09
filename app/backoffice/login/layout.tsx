import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kirish — CLAMO Backoffice',
  robots: { index: false, follow: false },
};

export default function BackofficeLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
