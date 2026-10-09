// Ball va tayyorgarlik toifalari — server (lib/db.ts), backoffice va yakuniy sahifa uchun yagona manba.
// Django admin'dagi nusxa: admin_panel/accreditation/scoring.py — o'zgartirilsa ikkalasi ham yangilanadi.

// Mezon vazni: Gold mezonlar (standartlar faylida «Gold» belgisi) 1.3, qolganlari 1
export const GOLD_WEIGHT = 1.3;
export const REGULAR_WEIGHT = 1.0;

// Javob ulushi: Bor — to'liq, Qisman — yarmi, Yo'q/javobsiz — 0; «Tadbiq etilmaydi» maksimal balldan chiqariladi
export const ANSWER_SHARE: Record<string, number> = { YES: 1.0, PARTIAL: 0.5, NO: 0.0 };

export type ReadinessCategory = 'HIGHEST' | 'FIRST' | 'SECOND' | 'NOT_READY';

// VM 2021-yil 14-yanvardagi 16-son qarori, Reglamentning 37-bandi bo'yicha akkreditatsiya toifalari
export const READINESS_CATEGORIES: Array<{ code: ReadinessCategory; label: string; minPercent: number }> = [
  { code: 'HIGHEST', label: 'Oliy toifa', minPercent: 95 },
  { code: 'FIRST', label: 'Birinchi toifa', minPercent: 85 },
  { code: 'SECOND', label: 'Ikkinchi toifa', minPercent: 75 },
  { code: 'NOT_READY', label: 'Tayyor emas', minPercent: 0 },
];

// Akkreditatsiyaga tayyor deb hisoblanadigan eng past chegara (ikkinchi toifa)
export const PASSING_PERCENT = 75;

// Kritik stop-faktor buzilgan bo'lsa — foizidan qat'i nazar toifa berilmaydi
export function categorize(percent: number, hasCriticalViolation: boolean): ReadinessCategory {
  if (hasCriticalViolation) return 'NOT_READY';
  return READINESS_CATEGORIES.find((c) => percent >= c.minPercent)!.code;
}

export function categoryLabel(code: string): string {
  return READINESS_CATEGORIES.find((c) => c.code === code)?.label ?? 'Tayyor emas';
}

export function isAccreditable(code: string): boolean {
  return code === 'HIGHEST' || code === 'FIRST' || code === 'SECOND';
}
