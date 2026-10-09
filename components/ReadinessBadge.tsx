import { Award, CheckCircle2, AlertTriangle } from 'lucide-react';
import { categoryLabel } from '@/lib/readiness';

// 16-son qaror toifalari bo'yicha belgi (backoffice reyestri va yakuniy sahifa uchun)
const STYLES: Record<string, { className: string; Icon: typeof Award }> = {
  HIGHEST: { className: 'bg-emerald-50 text-emerald-800 border-emerald-300', Icon: Award },
  FIRST: { className: 'bg-teal-50 text-teal-800 border-teal-200', Icon: CheckCircle2 },
  SECOND: { className: 'bg-sky-50 text-sky-800 border-sky-200', Icon: CheckCircle2 },
  NOT_READY: { className: 'bg-rose-50 text-rose-700 border-rose-200', Icon: AlertTriangle },
};

export default function ReadinessBadge({ category, size = 'sm' }: { category: string; size?: 'sm' | 'md' }) {
  const { className, Icon } = STYLES[category] ?? STYLES.NOT_READY;
  const sizing = size === 'md' ? 'px-3 py-1 text-xs gap-1.5' : 'px-2 py-0.5 text-[11px] gap-1';
  return (
    <span className={`inline-flex items-center whitespace-nowrap border font-semibold rounded-full ${sizing} ${className}`}>
      <Icon className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      {categoryLabel(category)}
    </span>
  );
}

// Foiz rangi: oliy/birinchi toifa — yashil, ikkinchi — ko'k-yashil, akkreditatsiya chegarasidan past — qizil
export function scoreColorClass(percent: number): string {
  return percent >= 85 ? 'text-emerald-600' : percent >= 75 ? 'text-teal-600' : 'text-rose-600';
}
