import type { Metadata } from 'next';
import AssessmentPortal from '@/components/AssessmentPortal';

export const metadata: Metadata = {
  title: "O'z-o'zini baholash — CLAMO akkreditatsiya",
};

// O'z-o'zini baholash chek-listi (topshirilgan ariza uchun — kvitansiya). Kirish: lib/session-access.ts
export default function AssessmentPage({ params }: { params: { sessionId: string } }) {
  return <AssessmentPortal sessionId={decodeURIComponent(params.sessionId)} />;
}
