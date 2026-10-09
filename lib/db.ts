import Database from 'better-sqlite3';
import path from 'path';
// Standart va mezonlarning o'zbekcha matnlari (scripts/import_standards_xlsx.py yaratadi)
import standardsContent from '@/data/standards_uz.json';
import { OFERTA_SEED } from '@/data/oferta_seed';
import { isDistrictOf, isKnownRegion, matchDistrict, matchRegion } from '@/lib/regions';
import { GOLD_WEIGHT, PASSING_PERCENT, REGULAR_WEIGHT, categorize, categoryLabel, pointsFor, truncatePercent, type ReadinessCategory } from '@/lib/readiness';

const DB_PATH = process.env.CLAMO_DB_PATH || path.join(process.cwd(), 'clamo_accreditation.db');

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');

    // Migration: yakuniy bo'limga o'tilgan vaqt (shundan keyin oldingi bo'limlar yopiladi)
    const sessionCols = dbInstance.prepare('PRAGMA table_info(audit_sessions)').all() as Array<{ name: string }>;
    if (!sessionCols.some((c) => c.name === 'final_stage_at')) {
      dbInstance.exec('ALTER TABLE audit_sessions ADD COLUMN final_stage_at TEXT');
    }
    // Joriy (tahrirlanadigan) bo'lim: undan oldingilari faqat ko'rish uchun, keyingilari yopiq
    if (!sessionCols.some((c) => c.name === 'current_section')) {
      dbInstance.exec('ALTER TABLE audit_sessions ADD COLUMN current_section INTEGER DEFAULT 1');
    }

    // Ma'lumotlar migratsiyalari PRAGMA user_version bo'yicha ketma-ket: 1–3 — standartlar matni (data/standards_uz.json
    // «version»), 4–5 — ballarni qayta hisoblash, 6 — hudud/tuman nomlarini ro'yxatga moslash.
    // Keyingi standartlar yangilanishi JSON'da version 7 dan boshlanishi kerak.
    const contentVersion = dbInstance.pragma('user_version', { simple: true }) as number;
    if (contentVersion < standardsContent.version) {
      applyStandardsContent(dbInstance);
    }

    // Statik sahifalar (oferta va h.k.): matn Django admin'da tahrirlanadi, bu yerda faqat boshlang'ich tahrir yoziladi
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS site_pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT
      )
    `);
    dbInstance
      .prepare("INSERT OR IGNORE INTO site_pages (slug, title, content, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run(OFERTA_SEED.slug, OFERTA_SEED.title, OFERTA_SEED.content);

    // v3: «Tegishli emas» atamasi «Tadbiq etilmaydi» ga almashtirildi (admin'da tahrirlangan oferta matnida ham)
    if (contentVersion < 3) {
      dbInstance
        .prepare("UPDATE site_pages SET content = replace(content, '«Tegishli emas»', '«Tadbiq etilmaydi»') WHERE content LIKE '%«Tegishli emas»%'")
        .run();
    }

    // v4: Gold vazni va 16-son qaror toifalari; v5: metodikaga to'liq moslash (qisman — 0,5, foiz kesiladi,
    // toifa faqat foizdan). Saqlangan ball/toifa barcha sessiyalar uchun qayta hisoblanadi (updated_at o'zgarmaydi)
    if (contentVersion < 5) {
      const db = dbInstance;
      const sessionIds = db.prepare('SELECT id FROM audit_sessions').all() as Array<{ id: string }>;
      db.transaction(() => {
        for (const { id } of sessionIds) calculateSessionScore(id, { touch: false });
        bumpUserVersion(db, 5);
      })();
    }

    // v6: hudud va tumanlar ro'yxati (data/uz_regions.json) joriy qilindi — avval erkin matn bilan kiritilgan
    // nomlar («Yunusobod», «Qo'qon sh.») ro'yxatdagi nomga o'tkaziladi; aniq moslik topilmasa o'zgarmaydi
    if (contentVersion < 6) {
      const db = dbInstance;
      const orgs = db.prepare('SELECT id, region, district FROM organizations').all() as Array<{
        id: string;
        region: string | null;
        district: string | null;
      }>;
      const update = db.prepare('UPDATE organizations SET region = ?, district = ? WHERE id = ?');
      db.transaction(() => {
        for (const org of orgs) {
          const region = matchRegion(org.region ?? '') || org.region;
          const district = (region && matchDistrict(region, org.district ?? '')) || org.district;
          if (region !== org.region || district !== org.district) update.run(region, district, org.id);
        }
        bumpUserVersion(db, 6);
      })();
    }
  }
  return dbInstance;
}

// Migratsiya raqamini faqat oshiradi: standartlar JSON'i kattaroq versiyani yozgan bo'lsa, u pasaytirilmaydi
function bumpUserVersion(db: Database.Database, version: number) {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < version) db.pragma(`user_version = ${version}`);
}

export interface SitePage {
  slug: string;
  title: string;
  content: string;
  updated_at: string | null;
}

export function getSitePage(slug: string): SitePage | null {
  const row = getDb().prepare('SELECT slug, title, content, updated_at FROM site_pages WHERE slug = ?').get(slug);
  return (row as SitePage | undefined) ?? null;
}

// Standart/mezon matnlarini JSON'dan yangilaydi. Mezonlar (standart, raqam) bo'yicha moslanadi —
// ID'lar saqlanadi, shuning uchun mavjud javoblar o'z mezoniga bog'langanicha qoladi; yangilari qo'shiladi.
// Gold / SOP belgilari faqat ma'lumot uchun (admin'da ko'rsatiladi) — ball hisobiga ta'sir qilmaydi.
function applyStandardsContent(db: Database.Database) {
  const addColumn = (table: string, column: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER DEFAULT 0`);
    }
  };
  addColumn('standards', 'is_gold');
  addColumn('criteria', 'is_gold');
  addColumn('criteria', 'sop_required');

  const domainNames = new Map(standardsContent.domains.map((d) => [d.id, d.name]));
  const updateStandard = db.prepare(`
    UPDATE standards SET title = ?, domain_id = ?, domain_name = ?, applicability_condition = ?, is_gold = ? WHERE id = ?
  `);
  const updateCriterion = db.prepare(`
    UPDATE criteria SET description = ?, is_gold = ?, sop_required = ? WHERE standard_id = ? AND criterion_number = ?
  `);
  const insertCriterion = db.prepare(`
    INSERT INTO criteria (id, standard_id, criterion_number, description, is_critical, is_gold, sop_required)
    VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM criteria), ?, ?, ?, 0, ?, ?)
  `);

  db.transaction(() => {
    for (const s of standardsContent.standards) {
      updateStandard.run(s.title, s.domain_id, domainNames.get(s.domain_id), s.applicability, s.gold ? 1 : 0, s.id);
    }
    for (const c of standardsContent.criteria) {
      const gold = c.gold ? 1 : 0;
      const sop = c.sop_required ? 1 : 0;
      if (updateCriterion.run(c.description, gold, sop, c.standard_id, c.number).changes === 0) {
        insertCriterion.run(c.standard_id, c.number, c.description, gold, sop);
      }
    }
    db.pragma(`user_version = ${standardsContent.version}`);
  })();
}

// Bo'limlar ketma-ketligi buzilganda (409) qaytariladigan xato
export class FlowError extends Error {}

// Kiritilgan ma'lumot noto'g'ri yoki to'liq emas (400)
export class InputError extends Error {}

// Bitta tashkilot (INN) arizani faqat bir marta topshiradi
export class AlreadySubmittedError extends FlowError {
  constructor(public submittedAt: string | null) {
    super("Ushbu INN bo'yicha ariza allaqachon topshirilgan. Har bir tashkilot arizani faqat bir marta topshirishi mumkin.");
  }
}

export function getSubmittedSessionByInn(inn: string): { id: string; submitted_at: string | null } | null {
  const row = getDb().prepare(`
    SELECT s.id, s.submitted_at FROM audit_sessions s
    JOIN organizations o ON o.id = s.org_id
    WHERE o.inn = ? AND s.status = 'SUBMITTED'
    ORDER BY s.submitted_at ASC LIMIT 1
  `).get(inn) as { id: string; submitted_at: string | null } | undefined;
  return row ?? null;
}

export const STANDARD_SERVICE_RULES: Record<number, string> = {
  31: 'has_sterilization_dept',
  32: 'has_endoscopy',
  33: 'has_surgery',
  49: 'has_emergency_blue_code',
  55: 'has_surgery',
  56: 'has_surgery',
  57: 'has_anesthesia',
  58: 'has_emergency_blue_code',
  59: 'has_laboratory',
  60: 'has_laboratory',
  61: 'has_laboratory',
  62: 'has_radiology_ultrasound',
  63: 'has_radiology_ultrasound',
  64: 'has_mri',
  75: 'has_academic_base',
};

export const CRITICAL_STOP_FACTORS: [number, number][] = [
  [16, 2], // Zaxira elektr generatori
  [38, 1], // Yuqori xavfli dorilar va konsentrlangan elektrolitlar
  [55, 4], // Jarrohlik nazorat varag'i (Sign-in, Time-out, Sign-out)
  [58, 1], // «Ko'k kod» 3 daqiqalik shoshilinch reanimatsiya
];

export interface DomainStat {
  id: number;
  name: string;
  total: number;
  yes: number;
  partial: number;
  no: number;
  na: number;
  score: number;
}

export interface CriticalViolation {
  standard_id: number;
  criterion_number: number;
  message: string;
}

export interface SessionScoreResult {
  session_id: string;
  total_criteria: number;
  applicable_criteria: number;
  yes_count: number;
  partial_count: number;
  no_count: number;
  na_count: number;
  // Olingan va maksimal ball (metodika: Gold — 1,3, oddiy — 1,0, qisman — 0,5; «Tadbiq etilmaydi» chiqariladi)
  earned_points: number;
  max_points: number;
  // Foiz — olingan ball / maksimal ball × 100, bir xonagacha kesilgan (toifa yaxlitlanmagan qiymat bo'yicha)
  total_score: number;
  readiness_category: ReadinessCategory;
  has_critical_stop_factors: boolean;
  critical_violations: CriticalViolation[];
  domains: DomainStat[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// touch=false — natija qayta hisoblanadi, lekin sessiyaning updated_at vaqti o'zgarmaydi (migratsiyalar uchun)
export function calculateSessionScore(sessionId: string, options: { touch?: boolean } = {}): SessionScoreResult {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
        c.id AS criterion_id,
        c.standard_id,
        c.criterion_number,
        c.is_gold,
        s.domain_id,
        s.domain_name,
        sa.answer_value
    FROM criteria c
    JOIN standards s ON c.standard_id = s.id
    LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
    ORDER BY c.id ASC
  `).all(sessionId) as Array<{
    criterion_id: number;
    standard_id: number;
    criterion_number: number;
    is_gold: number | null;
    domain_id: number;
    domain_name: string;
    answer_value: string | null;
  }>;

  let yesCount = 0;
  let partialCount = 0;
  let noCount = 0;
  let naCount = 0;
  let earned = 0;
  let max = 0;
  const domainStats: Record<number, DomainStat & { earned: number; max: number }> = {};
  const criticalViolations: CriticalViolation[] = [];

  for (const r of rows) {
    const d = (domainStats[r.domain_id] ??= {
      id: r.domain_id, name: r.domain_name, total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0, earned: 0, max: 0,
    });
    d.total += 1;

    const ans = r.answer_value;
    if (ans === 'NA') {
      naCount += 1;
      d.na += 1;
      continue;
    }

    const weight = r.is_gold ? GOLD_WEIGHT : REGULAR_WEIGHT;
    const points = pointsFor(ans, weight);
    max += weight;
    earned += points;
    d.max += weight;
    d.earned += points;

    if (ans === 'YES') {
      yesCount += 1;
      d.yes += 1;
    } else if (ans === 'PARTIAL') {
      partialCount += 1;
      d.partial += 1;
    } else {
      // NO yoki javob berilmagan
      noCount += 1;
      d.no += 1;
      if (CRITICAL_STOP_FACTORS.some(([st, cn]) => st === r.standard_id && cn === r.criterion_number)) {
        criticalViolations.push({
          standard_id: r.standard_id,
          criterion_number: r.criterion_number,
          message: `Standart #${r.standard_id}, Mezon #${r.criterion_number}: Kritik xavfsizlik talabi bajarilmagan!`,
        });
      }
    }
  }

  const domains: DomainStat[] = Object.values(domainStats)
    .sort((a, b) => a.id - b.id)
    .map(({ earned: e, max: m, ...d }) => ({ ...d, score: m > 0 ? truncatePercent((e / m) * 100) : 100.0 }));

  const applicableTotal = rows.length - naCount;
  const rawPercentage = max > 0 ? (earned / max) * 100 : 0.0;
  const totalPercentage = truncatePercent(rawPercentage);
  // Metodika bo'yicha toifa faqat foizdan; kritik stop-faktorlar ma'lumot sifatida qaytariladi
  const category = categorize(rawPercentage);

  db.prepare(`
    UPDATE audit_sessions
    SET
        total_applicable = ?,
        criteria_yes = ?,
        criteria_partial = ?,
        criteria_no = ?,
        criteria_na = ?,
        total_score = ?,
        readiness_category = ?,
        has_critical_stop_factors = ?${options.touch === false ? '' : ",\n        updated_at = datetime('now')"}
    WHERE id = ?
  `).run(
    applicableTotal,
    yesCount,
    partialCount,
    noCount,
    naCount,
    totalPercentage,
    category,
    criticalViolations.length > 0 ? 1 : 0,
    sessionId
  );

  return {
    session_id: sessionId,
    total_criteria: rows.length,
    applicable_criteria: applicableTotal,
    yes_count: yesCount,
    partial_count: partialCount,
    no_count: noCount,
    na_count: naCount,
    earned_points: round1(earned),
    max_points: round1(max),
    total_score: totalPercentage,
    readiness_category: category,
    has_critical_stop_factors: criticalViolations.length > 0,
    critical_violations: criticalViolations,
    domains,
  };
}

export interface InitializeSessionInput {
  inn: string;
  name?: string;
  cadastre_number?: string;
  region?: string;
  district?: string;
  level?: string;
  profile?: string;
  submitter_fio?: string;
  submitter_phone?: string;
  services?: Record<string, boolean>;
  bed_capacity?: number | string;
  daily_visits?: number | string;
  departments_count?: number | string;
  reset?: boolean;
}

export function initializeSession(data: InitializeSessionInput) {
  const db = getDb();

  const inn = (data.inn || '').trim();
  const orgName = (data.name || '').trim();
  const region = (data.region || '').trim();
  const fio = (data.submitter_fio || '').trim();
  const phone = (data.submitter_phone || '').trim();
  const level = data.level || '';
  if (!/^\d{9}$/.test(inn)) {
    throw new InputError("INN 9 xonali raqam bo'lishi kerak");
  }
  if (!orgName || !region || !fio || !phone || !['RESPUBLIKA', 'VILOYAT', 'TUMAN'].includes(level)) {
    throw new InputError("Tashkilot nomi, viloyat, daraja, mas'ul shaxs F.I.O va telefon raqami majburiy");
  }
  if (!isKnownRegion(region)) {
    throw new InputError("Hudud ro'yxatdan tanlanishi kerak");
  }
  if (!isDistrictOf(region, (data.district || '').trim())) {
    throw new InputError("Tuman / shahar tanlangan hududdan tanlanishi kerak");
  }

  // Topshirilgan ariza bo'lsa — tashkilot ma'lumotlari ham, yangi sessiya ham yaratilmaydi
  const submitted = getSubmittedSessionByInn(inn);
  if (submitted) {
    throw new AlreadySubmittedError(submitted.submitted_at);
  }

  const cadastre = (data.cadastre_number || '').trim();
  const district = (data.district || '').trim();
  const profile = data.profile || 'ARALASH';

  // Quvvati: o'rinlar (ambulator klinikada 0 bo'lishi mumkin), kunlik tashriflar, bo'linmalar — manfiy bo'lmagan butun son
  const toCount = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v.trim()) : Number(v);
    return v !== '' && v !== null && v !== undefined && Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : null;
  };
  const bedCapacity = toCount(data.bed_capacity);
  const dailyVisits = toCount(data.daily_visits);
  const departmentsCount = toCount(data.departments_count);
  if (bedCapacity === null || dailyVisits === null || departmentsCount === null) {
    throw new InputError("Quvvati: o'rinlar, kunlik tashriflar va bo'linmalar soni 0 yoki undan katta butun son bo'lishi kerak");
  }

  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  // Tashkilotning mavjud qoralamasi bo'lsa — o'sha davom ettiriladi (kuniga yangi sessiya ochilmaydi)
  const existingDraft = db.prepare(`
    SELECT s.id FROM audit_sessions s JOIN organizations o ON o.id = s.org_id
    WHERE o.inn = ? AND s.status = 'DRAFT'
    ORDER BY s.updated_at DESC LIMIT 1
  `).get(inn) as { id: string } | undefined;
  const sessionId = existingDraft?.id ?? `${inn}-${day}${month}`;
  const nowStr = now.toISOString().replace('T', ' ').slice(0, 19);

  // 1. Upsert Organization
  const existingOrg = db.prepare('SELECT id FROM organizations WHERE inn = ?').get(inn) as { id: string } | undefined;
  let orgId = '';
  if (existingOrg) {
    orgId = existingOrg.id;
    db.prepare(`
      UPDATE organizations SET
        name = ?, cadastre_number = ?, region = ?, district = ?, level = ?, profile = ?,
        bed_capacity = ?, daily_visits = ?, departments_count = ?
      WHERE id = ?
    `).run(orgName, cadastre, region, district, level, profile, bedCapacity, dailyVisits, departmentsCount, orgId);
  } else {
    orgId = `org-${inn}`;
    db.prepare(`
      INSERT INTO organizations (id, inn, name, cadastre_number, region, district, address, level, profile,
        bed_capacity, daily_visits, departments_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orgId, inn, orgName, cadastre, region, district, `${region}, ${district}`, level, profile,
      bedCapacity, dailyVisits, departmentsCount, nowStr);
  }

  // 2. Organization Services
  const srv = data.services || {};
  db.prepare(`
    INSERT OR REPLACE INTO organization_services 
    (org_id, has_emergency_blue_code, has_surgery, has_anesthesia, has_laboratory, has_radiology_ultrasound, has_mri, has_endoscopy, has_sterilization_dept, has_academic_base)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    srv.has_emergency_blue_code !== false ? 1 : 0,
    srv.has_surgery !== false ? 1 : 0,
    srv.has_anesthesia !== false ? 1 : 0,
    srv.has_laboratory !== false ? 1 : 0,
    srv.has_radiology_ultrasound !== false ? 1 : 0,
    srv.has_mri ? 1 : 0,
    srv.has_endoscopy !== false ? 1 : 0,
    srv.has_sterilization_dept !== false ? 1 : 0,
    srv.has_academic_base ? 1 : 0
  );

    // 3. Audit Session
    const existingSession = db.prepare('SELECT id FROM audit_sessions WHERE id = ?').get(sessionId);
    if (!existingSession) {
      db.prepare(`
        INSERT INTO audit_sessions (id, org_id, submitter_fio, submitter_phone, status, total_applicable, total_score, readiness_category, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', 275, 0.0, 'NOT_READY', ?)
      `).run(sessionId, orgId, fio, phone, nowStr);
    } else {
      if (data.reset) {
        db.prepare('DELETE FROM session_answers WHERE session_id = ?').run(sessionId);
        db.prepare(`
          UPDATE audit_sessions SET
            submitter_fio = ?, submitter_phone = ?, total_score = 0.0, criteria_yes = 0, criteria_partial = 0, criteria_no = 0, criteria_na = 0, readiness_category = 'NOT_READY', updated_at = ?
          WHERE id = ?
        `).run(fio, phone, nowStr, sessionId);
      } else {
        db.prepare(`
          UPDATE audit_sessions SET
            submitter_fio = ?, submitter_phone = ?, updated_at = ?
          WHERE id = ?
        `).run(fio, phone, nowStr, sessionId);
      }
    }

  // 4. Pre-fill N/A criteria based on disabled services
  const servicesRow = db.prepare('SELECT * FROM organization_services WHERE org_id = ?').get(orgId) as Record<string, number>;
  for (const [stIdStr, srvCol] of Object.entries(STANDARD_SERVICE_RULES)) {
    const stId = Number(stIdStr);
    if (!servicesRow || servicesRow[srvCol] === 0) {
      const critRows = db.prepare('SELECT id FROM criteria WHERE standard_id = ?').all(stId) as Array<{ id: number }>;
      const insertAnswer = db.prepare(`
        INSERT OR REPLACE INTO session_answers (session_id, criterion_id, answer_value, score_weight, updated_at)
        VALUES (?, ?, 'NA', NULL, ?)
      `);
      for (const c of critRows) {
        insertAnswer.run(sessionId, c.id, nowStr);
      }
    }
  }

  const scoreData = calculateSessionScore(sessionId);

  return {
    status: 'INITIALIZED',
    session_id: sessionId,
    org_id: orgId,
    org_name: orgName,
    score: scoreData,
  };
}

export interface CriterionItem {
  id: number;
  number: number;
  description: string;
  is_critical: boolean;
  answer: string;
  note: string;
}

export interface StandardItem {
  id: number;
  title: string;
  applicability: string;
  criteria: CriterionItem[];
}

export interface DomainItem {
  id: number;
  name: string;
  standards: StandardItem[];
}

export function getChecklist(sessionId: string) {
  const db = getDb();

  const sessionRow = db.prepare(`
    SELECT s.*, o.name as org_name, o.inn as org_inn, o.region, o.district
    FROM audit_sessions s
    JOIN organizations o ON s.org_id = o.id
    WHERE s.id = ?
  `).get(sessionId);

  if (!sessionRow) {
    return null;
  }

  const rows = db.prepare(`
    SELECT 
        st.id as standard_id,
        st.domain_id,
        st.domain_name,
        st.title as standard_title,
        st.applicability_condition,
        c.id as criterion_id,
        c.criterion_number,
        c.description as criterion_desc,
        c.is_critical,
        sa.answer_value,
        sa.note
    FROM standards st
    JOIN criteria c ON c.standard_id = st.id
    LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
    ORDER BY st.domain_id, st.id, c.criterion_number
  `).all(sessionId) as Array<{
    standard_id: number;
    domain_id: number;
    domain_name: string;
    standard_title: string;
    applicability_condition: string;
    criterion_id: number;
    criterion_number: number;
    criterion_desc: string;
    is_critical: number;
    answer_value: string | null;
    note: string | null;
  }>;

  const domainsDict: Record<number, {
    id: number;
    name: string;
    standards: Record<number, StandardItem>;
  }> = {};

  for (const r of rows) {
    const dId = r.domain_id;
    if (!domainsDict[dId]) {
      domainsDict[dId] = {
        id: dId,
        name: r.domain_name,
        standards: {},
      };
    }

    const stId = r.standard_id;
    if (!domainsDict[dId].standards[stId]) {
      domainsDict[dId].standards[stId] = {
        id: stId,
        title: r.standard_title,
        applicability: r.applicability_condition,
        criteria: [],
      };
    }

    domainsDict[dId].standards[stId].criteria.push({
      id: r.criterion_id,
      number: r.criterion_number,
      description: (r.criterion_desc || '').replace(/^\(?Стандарт\s+\d+\s+талаби\s+бўйича\s+\d+-мезон\)?[:\s]*/i, '').trim(),
      is_critical: Boolean(r.is_critical),
      answer: r.answer_value || 'UNANSWERED',
      note: r.note || '',
    });
  }

  const resultDomains: DomainItem[] = [];
  for (const dId of Object.keys(domainsDict).map(Number).sort((a, b) => a - b)) {
    const domainItem = domainsDict[dId];
    const stList: StandardItem[] = [];
    for (const stId of Object.keys(domainItem.standards).map(Number).sort((a, b) => a - b)) {
      stList.push(domainItem.standards[stId]);
    }
    resultDomains.push({
      id: domainItem.id,
      name: domainItem.name,
      standards: stList,
    });
  }

  const scoreData = calculateSessionScore(sessionId);

  return {
    session: sessionRow,
    score: scoreData,
    domains: resultDomains,
  };
}

// Bo'limlar tartibi (domain_id bo'yicha)
function getSectionIds(): number[] {
  const rows = getDb().prepare('SELECT DISTINCT domain_id FROM standards ORDER BY domain_id').all() as Array<{ domain_id: number }>;
  return rows.map((r) => r.domain_id);
}

// Bo'limdagi javob berilmagan mezonlarni «Yo'q» deb belgilaydi; belgilangan mezonlar sonini qaytaradi
function markUnansweredAsNo(sessionId: string, sectionId: number): number {
  return getDb().prepare(`
    INSERT INTO session_answers (session_id, criterion_id, answer_value, score_weight, note, updated_at)
    SELECT ?, c.id, 'NO', 0.0, '', datetime('now')
    FROM criteria c JOIN standards st ON st.id = c.standard_id
    WHERE st.domain_id = ?
      AND NOT EXISTS (SELECT 1 FROM session_answers sa WHERE sa.session_id = ? AND sa.criterion_id = c.id)
  `).run(sessionId, sectionId, sessionId).changes;
}

export function saveAnswer(sessionId: string, criterionId: number, answerValue: string, note: string = '') {
  const db = getDb();

  // Topshirilgan arizaga javob yozilmaydi; faqat joriy bo'lim tahrirlanadi (oldingilari yakunlangan, keyingilari yopiq)
  const session = db.prepare('SELECT current_section, status FROM audit_sessions WHERE id = ?').get(sessionId) as
    { current_section: number | null; status: string } | undefined;
  if (session?.status === 'SUBMITTED') {
    throw new FlowError("Ariza topshirilgan — javoblarni o'zgartirib bo'lmaydi");
  }
  const crit = db.prepare(`
    SELECT st.domain_id AS domain_id FROM criteria c JOIN standards st ON st.id = c.standard_id WHERE c.id = ?
  `).get(criterionId) as { domain_id: number } | undefined;
  if (!session || !crit) {
    throw new FlowError('Sessiya yoki mezon topilmadi');
  }
  const currentSection = session.current_section ?? 1;
  if (crit.domain_id < currentSection) {
    throw new FlowError(`${crit.domain_id}-bo'lim yakunlangan — javoblarni o'zgartirib bo'lmaydi`);
  }
  if (crit.domain_id > currentSection) {
    throw new FlowError(`Avval ${currentSection}-bo'limni yakunlang`);
  }

  let weight: number | null = 0.0;
  if (answerValue === 'YES') weight = 1.0;
  else if (answerValue === 'PARTIAL') weight = 0.5;
  else if (answerValue === 'NA') weight = null;

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    INSERT INTO session_answers (session_id, criterion_id, answer_value, score_weight, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, criterion_id) DO UPDATE SET
        answer_value = excluded.answer_value,
        score_weight = excluded.score_weight,
        note = excluded.note,
        updated_at = excluded.updated_at
  `).run(sessionId, criterionId, answerValue, weight, note, nowStr);

  const updatedScore = calculateSessionScore(sessionId);
  return {
    status: 'SAVED',
    criterion_id: criterionId,
    answer_value: answerValue,
    score: updatedScore,
  };
}

// Joriy bo'limni yakunlab keyingisiga o'tish: javobsiz mezonlar «Yo'q» bo'ladi, bo'lim faqat ko'rish uchun qoladi.
// fromSection — mijoz yakunlayotgan bo'lim; takroriy so'rov (bo'lim allaqachon yakunlangan) xatosiz qaytadi.
export function advanceSection(sessionId: string, fromSection: number) {
  const db = getDb();
  const advance = db.transaction(() => {
    const session = db.prepare('SELECT current_section, status FROM audit_sessions WHERE id = ?').get(sessionId) as
      { current_section: number | null; status: string } | undefined;
    if (!session) {
      throw new FlowError('Sessiya topilmadi');
    }
    if (session.status === 'SUBMITTED') {
      throw new FlowError('Ariza allaqachon topshirilgan');
    }
    const current = session.current_section ?? 1;
    if (fromSection < current) {
      return { current_section: current, auto_no_count: 0 };
    }
    if (fromSection > current) {
      throw new FlowError(`Avval ${current}-bo'limni yakunlang`);
    }
    const sections = getSectionIds();
    const idx = sections.indexOf(current);
    if (idx === -1 || idx === sections.length - 1) {
      throw new FlowError("Bu oxirgi bo'lim — arizani topshiring");
    }
    const autoNo = markUnansweredAsNo(sessionId, current);
    db.prepare('UPDATE audit_sessions SET current_section = ? WHERE id = ?').run(sections[idx + 1], sessionId);
    return { current_section: sections[idx + 1], auto_no_count: autoNo };
  });
  const result = advance.immediate();
  return { ...result, score: calculateSessionScore(sessionId) };
}

export function submitSession(sessionId: string) {
  const db = getDb();

  // Tekshiruv va topshirish bitta IMMEDIATE tranzaksiyada: yozish qulfi tekshiruvdan oldin olinadi,
  // shuning uchun parallel so'rovlar bir INN'dan ikkinchi topshirishni o'tkazib yubora olmaydi.
  const submit = db.transaction(() => {
    const session = db.prepare(`
      SELECT s.current_section, s.status, s.submitted_at, o.inn FROM audit_sessions s
      JOIN organizations o ON o.id = s.org_id WHERE s.id = ?
    `).get(sessionId) as { current_section: number | null; status: string; submitted_at: string | null; inn: string } | undefined;
    if (!session) {
      throw new FlowError('Sessiya topilmadi');
    }
    if (session.status === 'SUBMITTED') {
      throw new AlreadySubmittedError(session.submitted_at);
    }
    const other = getSubmittedSessionByInn(session.inn);
    if (other) {
      throw new AlreadySubmittedError(other.submitted_at);
    }
    // Ariza faqat oxirgi bo'limdan topshiriladi; uning javobsiz mezonlari «Yo'q» bo'ladi
    const sections = getSectionIds();
    const lastSection = sections[sections.length - 1];
    if ((session.current_section ?? 1) !== lastSection) {
      throw new FlowError(`Arizani topshirish uchun barcha bo'limlarni ketma-ket yakunlang (hozir ${session.current_section ?? 1}-bo'lim)`);
    }
    markUnansweredAsNo(sessionId, lastSection);
    const updatedScore = calculateSessionScore(sessionId);
    db.prepare(`
      UPDATE audit_sessions
      SET status = 'SUBMITTED', submitted_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
    return updatedScore;
  });

  const updatedScore = submit.immediate();
  return {
    status: 'SUBMITTED',
    message: 'Akkreditatsiya arizasi muvaffaqiyatli qabul qilindi!',
    final_score: updatedScore,
  };
}

export function getBackofficeSummary() {
  const db = getDb();

  const countRes = db.prepare("SELECT COUNT(*) as cnt, AVG(total_score) as avg_score FROM audit_sessions WHERE status = 'SUBMITTED'").get() as {
    cnt: number;
    avg_score: number | null;
  };
  const totalSubmitted = countRes?.cnt || 0;
  const avgScore = Math.round((countRes?.avg_score || 0.0) * 10) / 10;

  const readyRes = db.prepare("SELECT COUNT(*) as cnt FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category IN ('HIGHEST', 'FIRST', 'SECOND')").get() as { cnt: number };
  const readyCount = readyRes?.cnt || 0;

  const riskRes = db.prepare("SELECT COUNT(*) as cnt FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'NOT_READY'").get() as { cnt: number };
  const riskCount = riskRes?.cnt || 0;

  return {
    total_clinics: totalSubmitted,
    avg_score: avgScore,
    ready_clinics: readyCount,
    risk_clinics: riskCount,
    passing_threshold: PASSING_PERCENT,
  };
}

export function getBackofficeRegions(sortBy: string = 'score_desc') {
  const db = getDb();

  const rows = db.prepare(`
    SELECT 
        o.region,
        COUNT(s.id) as count,
        AVG(s.total_score) as avg_score,
        SUM(CASE WHEN s.readiness_category IN ('HIGHEST', 'FIRST', 'SECOND') THEN 1 ELSE 0 END) as ready_count
    FROM audit_sessions s
    JOIN organizations o ON s.org_id = o.id
    WHERE s.status = 'SUBMITTED'
    GROUP BY o.region
  `).all() as Array<{
    region: string;
    count: number;
    avg_score: number | null;
    ready_count: number;
  }>;

  const results = rows.map((r) => ({
    name: r.region,
    count: r.count,
    avgScore: Math.round((r.avg_score || 0.0) * 10) / 10,
    ready: r.ready_count,
  }));

  if (sortBy === 'score_desc') {
    results.sort((a, b) => b.avgScore - a.avgScore);
  } else if (sortBy === 'count_desc') {
    results.sort((a, b) => b.count - a.count);
  } else {
    results.sort((a, b) => a.name.localeCompare(b.name));
  }

  return results;
}

// Bo'limlar bo'yicha milliy natija: topshirilgan har bir arizaning bo'lim foizi (shu bo'limdagi olingan ball /
// maksimal ball, «Tadbiq etilmaydi» chiqarilgan) hisoblanadi va arizalar bo'yicha o'rtachasi olinadi —
// «O'rtacha milliy ball» bilan bir xil tartib (har klinika teng vaznda). Ariza bo'lmasa score = null.
export function getBackofficeDomains() {
  const db = getDb();

  const domains = db.prepare('SELECT DISTINCT domain_id, domain_name FROM standards ORDER BY domain_id').all() as Array<{
    domain_id: number;
    domain_name: string;
  }>;

  const rows = db.prepare(`
    SELECT s.id AS session_id, st.domain_id, c.is_gold, sa.answer_value
    FROM audit_sessions s
    CROSS JOIN criteria c
    JOIN standards st ON st.id = c.standard_id
    LEFT JOIN session_answers sa ON sa.session_id = s.id AND sa.criterion_id = c.id
    WHERE s.status = 'SUBMITTED'
  `).all() as Array<{ session_id: string; domain_id: number; is_gold: number | null; answer_value: string | null }>;

  // session_id → domain_id → { earned, max }
  const perSession = new Map<string, Map<number, { earned: number; max: number }>>();
  for (const r of rows) {
    if (r.answer_value === 'NA') continue;
    const weight = r.is_gold ? GOLD_WEIGHT : REGULAR_WEIGHT;
    let byDomain = perSession.get(r.session_id);
    if (!byDomain) perSession.set(r.session_id, (byDomain = new Map()));
    const d = byDomain.get(r.domain_id) ?? { earned: 0, max: 0 };
    d.max += weight;
    d.earned += pointsFor(r.answer_value, weight);
    byDomain.set(r.domain_id, d);
  }

  const results = domains.map((d) => {
    const percents: number[] = [];
    perSession.forEach((byDomain) => {
      const stat = byDomain.get(d.domain_id);
      if (stat && stat.max > 0) percents.push((stat.earned / stat.max) * 100);
    });
    const avg = percents.length > 0 ? percents.reduce((sum, p) => sum + p, 0) / percents.length : null;
    return {
      id: d.domain_id,
      name: d.domain_name,
      score: avg === null ? null : truncatePercent(avg),
      sessions: percents.length,
      is_weakest: false,
    };
  });

  // Eng zaif bo'lim — faqat ma'lumot bo'lsa va akkreditatsiya chegarasidan past bo'lsa belgilanadi
  const scored = results.filter((d) => d.score !== null);
  if (scored.length > 0) {
    const weakest = scored.reduce((min, d) => (d.score! < min.score! ? d : min));
    if (weakest.score! < PASSING_PERCENT) weakest.is_weakest = true;
  }

  return results;
}

export interface ClinicFilterParams {
  region?: string;
  district?: string;
  level?: string;
  status?: string;
  search?: string;
}

export function getBackofficeClinics(params: ClinicFilterParams) {
  const db = getDb();

  const region = params.region || 'all';
  const district = params.district || 'all';
  const level = params.level || 'all';
  const status = params.status || 'all';
  const search = (params.search || '').toLowerCase().trim();

  let query = `
    SELECT 
        s.id as session_id,
        s.status,
        s.total_score,
        s.readiness_category,
        s.criteria_yes,
        s.total_applicable,
        s.submitted_at,
        s.submitter_fio,
        s.submitter_phone,
        o.id as org_id,
        o.name,
        o.inn,
        o.region,
        o.district,
        o.level,
        o.profile,
        o.bed_capacity,
        o.daily_visits
    FROM audit_sessions s
    JOIN organizations o ON s.org_id = o.id
    WHERE 1=1
  `;
  const args: any[] = [];

  if (region !== 'all') {
    query += ' AND o.region = ?';
    args.push(region);
  }
  if (district !== 'all') {
    query += ' AND o.district = ?';
    args.push(district);
  }
  if (level !== 'all') {
    query += ' AND o.level = ?';
    args.push(level);
  }
  if (status !== 'all' && ['HIGHEST', 'FIRST', 'SECOND', 'NOT_READY'].includes(status)) {
    query += ' AND s.readiness_category = ?';
    args.push(status);
  }

  query += ' ORDER BY s.total_score DESC';

  const rows = db.prepare(query).all(...args) as Array<any>;

  const filtered = [];
  for (const r of rows) {
    const name = (r.name || '').toLowerCase();
    const inn = (r.inn || '').toString();
    const fio = (r.submitter_fio || '').toLowerCase();

    if (search) {
      if (!name.includes(search) && !inn.includes(search) && !fio.includes(search)) {
        continue;
      }
    }

    filtered.push({
      session_id: r.session_id,
      org_id: r.org_id,
      name: r.name,
      inn: r.inn,
      region: r.region,
      district: r.district,
      level: r.level,
      profile: r.profile,
      capacity: `${r.bed_capacity || 0} o'rin • ${r.daily_visits || 0} qabul`,
      responsible: r.submitter_fio,
      phone: r.submitter_phone,
      criteriaDone: r.criteria_yes,
      totalCriteria: r.total_applicable,
      score: r.total_score,
      category: r.readiness_category as ReadinessCategory,
      // Faqat haqiqatda topshirilgan sessiyalar uchun sana; qoralamada null
      date: r.status === 'SUBMITTED' ? r.submitted_at || null : null,
      submitted: r.status === 'SUBMITTED',
    });
  }

  return filtered;
}

export function getClinicPassport(sessionId: string) {
  const db = getDb();

  const row = db.prepare(`
    SELECT s.*, o.name, o.inn, o.cadastre_number, o.region, o.district, o.address, o.level, o.profile, o.bed_capacity, o.daily_visits
    FROM audit_sessions s
    JOIN organizations o ON s.org_id = o.id
    WHERE s.id = ?
  `).get(sessionId);

  if (!row) {
    return null;
  }

  const scoreData = calculateSessionScore(sessionId);

  return {
    clinic: row,
    score: scoreData,
  };
}

export function getExportCsv() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT o.name, o.inn, o.region, o.district, o.level, s.total_score, s.readiness_category, s.submitted_at
    FROM audit_sessions s
    JOIN organizations o ON s.org_id = o.id
    ORDER BY s.total_score DESC
  `).all() as Array<{
    name: string;
    inn: string;
    region: string;
    district: string;
    level: string;
    total_score: number;
    readiness_category: string;
    submitted_at: string;
  }>;

  let csvContent = 'Tashkilot Nomi,INN,Viloyat,Tuman,Daraja,Tayyorgarlik Bali (%),Holati,Topshirilgan Sana\n';
  for (const r of rows) {
    csvContent += `"${r.name}",${r.inn},${r.region},${r.district},${r.level},${r.total_score}%,${categoryLabel(r.readiness_category)},${r.submitted_at || ''}\n`;
  }

  return csvContent;
}
