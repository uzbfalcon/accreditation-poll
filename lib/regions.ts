import regionsData from '@/data/uz_regions.json';

// Hudud va tumanlar (SOATO) — manba: clamo-backend, scripts/import_regions.py orqali data/uz_regions.json
export interface RegionItem {
  code: string;
  name: string;
  districts: string[];
}

export const REGIONS: RegionItem[] = regionsData;

export function districtsOf(region: string): string[] {
  return REGIONS.find((r) => r.name === region)?.districts ?? [];
}

export function isKnownRegion(region: string): boolean {
  return REGIONS.some((r) => r.name === region);
}

export function isDistrictOf(region: string, district: string): boolean {
  return districtsOf(region).includes(district);
}

// Tashqi manbalardan (orginfo.uz va b.) kelgan erkin matnni ro'yxatdagi nomga moslash:
// «Samarqand sh.» → «Samarqand shahri», «Yunusobod» → «Yunusobod tumani». Aniq moslik bo'lmasa — '' (foydalanuvchi tanlaydi).
type Kind = 'city' | 'district' | 'region' | null;

function parsePlace(raw: string): { base: string; kind: Kind } {
  const s = raw.toLowerCase().replace(/[`ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const suffixes: Array<[RegExp, Kind]> = [
    [/ (shahri|shahar|sh\.?)$/, 'city'],
    [/ (tumani|tuman|t\.)$/, 'district'],
    [/ (viloyati|viloyat|vil\.?)$/, 'region'],
    [/ (respublikasi|resp\.?)$/, 'region'],
  ];
  for (const [re, kind] of suffixes) {
    if (re.test(s)) return { base: s.replace(re, '').trim(), kind };
  }
  return { base: s, kind: null };
}

function pickUnique<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null;
}

export function matchRegion(raw: string): string {
  const { base, kind } = parsePlace(raw || '');
  if (!base) return '';
  const candidates = REGIONS.filter((r) => parsePlace(r.name).base === base);
  const sameKind = candidates.filter((r) => {
    const k = parsePlace(r.name).kind;
    return kind === 'city' ? k === 'city' : kind === 'region' ? k === 'region' : true;
  });
  return pickUnique(sameKind)?.name ?? '';
}

export function matchDistrict(region: string, raw: string): string {
  const { base, kind } = parsePlace(raw || '');
  if (!base) return '';
  const candidates = districtsOf(region).filter((d) => parsePlace(d).base === base);
  if (kind) {
    return pickUnique(candidates.filter((d) => parsePlace(d).kind === kind)) ?? '';
  }
  // Turi ko'rsatilmagan va ham tuman, ham shahar bo'lsa («Nukus») — taxmin qilinmaydi
  return pickUnique(candidates) ?? '';
}
