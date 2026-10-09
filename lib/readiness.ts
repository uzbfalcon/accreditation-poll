// Ball va tayyorgarlik toifalari — server (lib/db.ts), backoffice va yakuniy sahifa uchun yagona manba.
// Asos: «Tibbiyot tashkilotlarini akkreditatsiyalash milliy standartlari» (07.08.2025) — «Standartlar talablari va
// ularning baholanadigan elementlari bajarilishini hisoblash metodikasi», 1-jadval va 1–4-namunalar;
// toifalar — VM 16-son qarori, Reglamentning 37-bandi.
// Django admin'dagi nusxa: admin_panel/accreditation/scoring.py — o'zgartirilsa ikkalasi ham yangilanadi.

// Baholanadigan element koeffitsienti: Gold standart elementlari — 1,3, oddiy — 1,0
export const GOLD_WEIGHT = 1.3;
export const REGULAR_WEIGHT = 1.0;

// Metodika, 1-jadval: to'liq muvofiqlik — koeffitsient (1,0 / 1,3); qisman — 0,5 (oddiy va Gold uchun bir xil);
// to'liq rioya qilmaslik (va javobsiz) — 0. «Tadbiq etilmaydi» maksimal balldan chiqariladi (Reglament, 28-band).
export const PARTIAL_POINTS = 0.5;

export function pointsFor(answer: string | null | undefined, weight: number): number {
  if (answer === 'YES') return weight;
  if (answer === 'PARTIAL') return PARTIAL_POINTS;
  return 0;
}

export type ReadinessCategory = 'HIGHEST' | 'FIRST' | 'SECOND' | 'NOT_READY';

export const READINESS_CATEGORIES: Array<{ code: ReadinessCategory; label: string; minPercent: number }> = [
  { code: 'HIGHEST', label: 'Oliy toifa', minPercent: 95 },
  { code: 'FIRST', label: 'Birinchi toifa', minPercent: 85 },
  { code: 'SECOND', label: 'Ikkinchi toifa', minPercent: 75 },
  { code: 'NOT_READY', label: 'Tayyor emas', minPercent: 0 },
];

// Akkreditatsiyaga tayyor deb hisoblanadigan eng past chegara (ikkinchi toifa)
export const PASSING_PERCENT = 75;

// Toifa faqat foizdan, yaxlitlanmagan qiymat bo'yicha aniqlanadi (74,96% — 75% emas)
export function categorize(rawPercent: number): ReadinessCategory {
  return READINESS_CATEGORIES.find((c) => rawPercent >= c.minPercent)!.code;
}

// Ko'rsatish uchun foiz metodika namunalaridagidek bir xonagacha kesiladi: 263/308 = 85,389… → 85,3
// (1e-9 — 95,0 kabi aniq qiymatlar suzuvchi nuqta xatosi tufayli 94,9 bo'lib qolmasligi uchun)
export function truncatePercent(rawPercent: number): number {
  return Math.floor(rawPercent * 10 + 1e-9) / 10;
}

export function categoryLabel(code: string): string {
  return READINESS_CATEGORIES.find((c) => c.code === code)?.label ?? 'Tayyor emas';
}

export function isAccreditable(code: string): boolean {
  return code === 'HIGHEST' || code === 'FIRST' || code === 'SECOND';
}
