import type { Metadata } from 'next';
import AssessmentPortal from '@/components/AssessmentPortal';

export const metadata: Metadata = {
  title: 'Tashkilot pasporti — CLAMO akkreditatsiya',
};

export default function PassportPage() {
  return <AssessmentPortal />;
}
