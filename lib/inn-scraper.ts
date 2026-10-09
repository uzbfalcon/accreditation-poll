/**
 * clamo.uz - Real-time INN Organization Lookup Engine
 * Concurrently queries orginfo.uz and ihamkor.uz with caching & fallback.
 */

export interface InnScraperResult {
  inn: string;
  found: boolean;
  name: string;
  region: string;
  district: string;
  address: string;
  status: string;
  source: 'orginfo.uz' | 'ihamkor.uz' | 'cache' | 'mock';
}

// In-memory cache to guarantee sub-millisecond responses on repeated queries
const innCache = new Map<string, InnScraperResult>();

// Known mock clinic database for instant demo testing
const KNOWN_MOCKS: Record<string, Omit<InnScraperResult, 'inn' | 'found' | 'source'>> = {
  '304882190': {
    name: '«SHIFO MED SERVIS KOP TARMOQLI KLINIKASI» MCHJ',
    region: 'Toshkent shahri',
    district: 'Yunusobod',
    address: "Amir Temur ko'chasi, 12-uy",
    status: 'ACTIVE',
  },
  '305119284': {
    name: '«AKFA MEDLINE RESPUBLIKA TIBBIYOT MARKAZI» MCHJ',
    region: 'Toshkent shahri',
    district: 'Olmazor',
    address: "Kichik halqa yo'li 5-A",
    status: 'ACTIVE',
  },
  '305123456': {
    name: '«CLAMO DIGITAL HEALTH SOLUTIONS» MCHJ',
    region: 'Toshkent shahri',
    district: 'Mirobod',
    address: "Nukus ko'chasi 24-uy",
    status: 'ACTIVE',
  },
  '201994821': {
    name: "«SAMARQAND VILOYAT BOLALAR KO'P TARMOQLI TIBBIYOT MARKAZI»",
    region: 'Samarqand viloyati',
    district: 'Samarqand sh.',
    address: "Dahbed ko'chasi 45-uy",
    status: 'ACTIVE',
  },
  '203114992': {
    name: "«QO'QON SHAHAR 2-SONLI SHOSHILINCH YORDAM SHIFOXONASI»",
    region: "Farg'ona viloyati",
    district: "Qo'qon sh.",
    address: "Turkiston ko'chasi 14",
    status: 'ACTIVE',
  },
  '204992110': {
    name: "«ASAKA TUMAN TIBBIYOT BIRLASHMASI TUG'RUQ MAJMUASI»",
    region: 'Andijon viloyati',
    district: 'Asaka',
    address: "Qorasuv ko'chasi 2",
    status: 'ACTIVE',
  },
  '308221004': {
    name: '«BUXORO KARVON SINO NEVROLOGIYA VA REABILITATSIYA» MCHJ',
    region: 'Buxoro viloyati',
    district: 'Buxoro sh.',
    address: "Ibn Sino ko'chasi 18",
    status: 'ACTIVE',
  },
  '306771893': {
    name: '«CHIRCHIQ MED STAR DIAGNOSTIKA MARKAZI» MCHJ',
    region: 'Toshkent viloyati',
    district: 'Chirchiq sh.',
    address: "Navoiy shoh ko'chasi 7",
    status: 'ACTIVE',
  },
};

/**
 * 1. Fetch organization details from orginfo.uz
 */
async function fetchFromOrgInfo(inn: string, signal: AbortSignal): Promise<InnScraperResult> {
  const url = `https://orginfo.uz/uz/search/organizations/?q=${encodeURIComponent(inn)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`orginfo.uz HTTP ${res.status}`);
  }

  const html = await res.text();
  const nameMatch = html.match(/<h6 class="card-title">([\s\S]*?)<\/h6>/);
  if (!nameMatch) {
    throw new Error('Tashkilot orginfo.uz da topilmadi');
  }

  const rawName = nameMatch[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/`/g, "'")
    .trim();

  const locMatch = html.match(/alt="location">([\s\S]*?)<\/p>/);
  let region = 'Toshkent shahri';
  let district = '';
  let address = '';

  if (locMatch) {
    const locLines = locMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (locLines.length > 0) {
      const parts = locLines[0].split(',').map((p) => p.trim());
      region = parts[0] || 'Toshkent shahri';
      district = parts[1] || '';
      address = locLines.slice(1).join(', ') || locLines[0] || '';
    }
  }

  const isLiquidated = html.includes('Tugatilgan');

  return {
    inn,
    found: true,
    name: rawName,
    region,
    district,
    address,
    status: isLiquidated ? 'LIQUIDATED' : 'ACTIVE',
    source: 'orginfo.uz',
  };
}

/**
 * 2. Fetch organization details from ihamkor.uz
 */
async function fetchFromIHamkor(inn: string, signal: AbortSignal): Promise<InnScraperResult> {
  const url = `https://ihamkor.uz/uz/search?q=${encodeURIComponent(inn)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`ihamkor.uz HTTP ${res.status}`);
  }

  const html = await res.text();
  // If Cloudflare blocked or no organization card
  if (html.includes('cf-wrapper') || html.includes('Attention Required')) {
    throw new Error('ihamkor.uz Cloudflare bilan himoyalangan');
  }

  const nameMatch = html.match(/<h[1-6][^>]*class="[^"]*company[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (!nameMatch) {
    throw new Error('Tashkilot ihamkor.uz da topilmadi');
  }

  return {
    inn,
    found: true,
    name: nameMatch[1].trim(),
    region: 'Toshkent shahri',
    district: '',
    address: '',
    status: 'ACTIVE',
    source: 'ihamkor.uz',
  };
}

/**
 * High-performance concurrent INN lookup
 * Runs orginfo.uz and ihamkor.uz simultaneously, returning whichever responds first!
 */
export async function lookupInnOnline(inn: string): Promise<InnScraperResult> {
  const cleanInn = inn.trim();

  // 1. In-memory Cache check (< 1ms)
  if (innCache.has(cleanInn)) {
    const cached = innCache.get(cleanInn)!;
    return { ...cached, source: 'cache' };
  }

  // 2. Concurrently race orginfo.uz and ihamkor.uz
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const promises = [
      fetchFromOrgInfo(cleanInn, controller.signal),
      fetchFromIHamkor(cleanInn, controller.signal),
    ];

    // Whichever succeeds first wins!
    const result = await Promise.any(promises);
    clearTimeout(timeoutId);

    // Save to cache
    innCache.set(cleanInn, result);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);

    // 3. Fallback: Check known mock database
    if (cleanInn in KNOWN_MOCKS) {
      const mock = KNOWN_MOCKS[cleanInn];
      const res: InnScraperResult = {
        inn: cleanInn,
        found: true,
        ...mock,
        source: 'mock',
      };
      innCache.set(cleanInn, res);
      return res;
    }

    // 4. Topilmadi — nom to'qib chiqarilmaydi; foydalanuvchi ma'lumotlarni qo'lda kiritadi
    return {
      inn: cleanInn,
      found: false,
      name: '',
      region: '',
      district: '',
      address: '',
      status: '',
      source: 'mock',
    };
  }
}
