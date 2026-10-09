import Database from 'better-sqlite3';
import path from 'path';
// Standart va mezonlarning o'zbekcha matnlari (scripts/import_standards_xlsx.py yaratadi)
import standardsContent from '@/data/standards_uz.json';
import { OFERTA_SEED } from '@/data/oferta_seed';

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

    if ((dbInstance.pragma('user_version', { simple: true }) as number) < standardsContent.version) {
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
  }
  return dbInstance;
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

// Har bir bo'lim bo'yicha jami va javob berilgan mezonlar soni (domain_id tartibida)
function getDomainProgress(sessionId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT st.domain_id AS domain_id, COUNT(c.id) AS total, COUNT(sa.answer_value) AS answered
    FROM standards st
    JOIN criteria c ON c.standard_id = st.id
    LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
    GROUP BY st.domain_id
    ORDER BY st.domain_id
  `).all(sessionId) as Array<{ domain_id: number; total: number; answered: number }>;
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
  total_score: number;
  readiness_category: 'READY' | 'PARTIALLY_READY' | 'NOT_READY';
  has_critical_stop_factors: boolean;
  critical_violations: CriticalViolation[];
  domains: DomainStat[];
}

export function calculateSessionScore(sessionId: string): SessionScoreResult {
  const db = getDb();

  const query = `
    SELECT 
        c.id as criterion_id,
        c.standard_id,
        c.criterion_number,
        c.is_critical,
        s.domain_id,
        s.domain_name,
        sa.answer_value,
        sa.score_weight
    FROM criteria c
    JOIN standards s ON c.standard_id = s.id
    LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
    ORDER BY c.id ASC
  `;

  const rows = db.prepare(query).all(sessionId) as Array<{
    criterion_id: number;
    standard_id: number;
    criterion_number: number;
    is_critical: number;
    domain_id: number;
    domain_name: string;
    answer_value: string | null;
    score_weight: number | null;
  }>;

  const totalCriteria = rows.length;
  let yesCount = 0;
  let partialCount = 0;
  let noCount = 0;
  let naCount = 0;

  const domainStats: Record<number, DomainStat> = {
    1: { id: 1, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    2: { id: 2, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    3: { id: 3, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    4: { id: 4, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    5: { id: 5, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    6: { id: 6, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
    7: { id: 7, name: '', total: 0, yes: 0, partial: 0, no: 0, na: 0, score: 0.0 },
  };

  const criticalViolations: CriticalViolation[] = [];

  for (const r of rows) {
    const dId = r.domain_id;
    if (domainStats[dId]) {
      domainStats[dId].name = r.domain_name;
      domainStats[dId].total += 1;
    }

    const ans = r.answer_value;
    if (ans === 'YES') {
      yesCount += 1;
      if (domainStats[dId]) domainStats[dId].yes += 1;
    } else if (ans === 'PARTIAL') {
      partialCount += 1;
      if (domainStats[dId]) domainStats[dId].partial += 1;
    } else if (ans === 'NA') {
      naCount += 1;
      if (domainStats[dId]) domainStats[dId].na += 1;
    } else {
      // NO or UNANSWERED
      noCount += 1;
      if (domainStats[dId]) domainStats[dId].no += 1;

      // Check critical stop factors
      const stNum = r.standard_id;
      const cNum = r.criterion_number;
      const isCritical = CRITICAL_STOP_FACTORS.some(([s, c]) => s === stNum && c === cNum);
      if (isCritical) {
        criticalViolations.push({
          standard_id: stNum,
          criterion_number: cNum,
          message: `Standart #${stNum}, Mezon #${cNum}: Kritik xavfsizlik talabi bajarilmagan!`,
        });
      }
    }
  }

  // Calculate domain percentages
  for (const dId of Object.keys(domainStats).map(Number)) {
    const dData = domainStats[dId];
    const applicable = dData.total - dData.na;
    if (applicable > 0) {
      const points = dData.yes * 1.0 + dData.partial * 0.5;
      dData.score = Math.round((points / applicable) * 1000) / 10;
    } else {
      dData.score = 100.0;
    }
  }

  const applicableTotal = totalCriteria - naCount;
  let totalPercentage = 0.0;
  if (applicableTotal > 0) {
    const totalPoints = yesCount * 1.0 + partialCount * 0.5;
    totalPercentage = Math.round((totalPoints / applicableTotal) * 1000) / 10;
  }

  // Categorize
  let category: 'READY' | 'PARTIALLY_READY' | 'NOT_READY' = 'NOT_READY';
  if (totalPercentage >= 80.0 && criticalViolations.length === 0) {
    category = 'READY';
  } else if (totalPercentage >= 55.0) {
    category = 'PARTIALLY_READY';
  } else {
    category = 'NOT_READY';
  }

  // Update in database
  const updateStmt = db.prepare(`
    UPDATE audit_sessions
    SET 
        total_applicable = ?,
        criteria_yes = ?,
        criteria_partial = ?,
        criteria_no = ?,
        criteria_na = ?,
        total_score = ?,
        readiness_category = ?,
        has_critical_stop_factors = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);

  updateStmt.run(
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
    total_criteria: totalCriteria,
    applicable_criteria: applicableTotal,
    yes_count: yesCount,
    partial_count: partialCount,
    no_count: noCount,
    na_count: naCount,
    total_score: totalPercentage,
    readiness_category: category,
    has_critical_stop_factors: criticalViolations.length > 0,
    critical_violations: criticalViolations,
    domains: Object.values(domainStats),
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

  // Topshirilgan ariza bo'lsa — tashkilot ma'lumotlari ham, yangi sessiya ham yaratilmaydi
  const submitted = getSubmittedSessionByInn(inn);
  if (submitted) {
    throw new AlreadySubmittedError(submitted.submitted_at);
  }

  const cadastre = (data.cadastre_number || '').trim();
  const district = (data.district || '').trim();
  const profile = data.profile || 'ARALASH';

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
        name = ?, cadastre_number = ?, region = ?, district = ?, level = ?, profile = ?
      WHERE id = ?
    `).run(orgName, cadastre, region, district, level, profile, orgId);
  } else {
    orgId = `org-${inn}`;
    db.prepare(`
      INSERT INTO organizations (id, inn, name, cadastre_number, region, district, address, level, profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orgId, inn, orgName, cadastre, region, district, `${region}, ${district}`, level, profile, nowStr);
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

export function saveAnswer(sessionId: string, criterionId: number, answerValue: string, note: string = '') {
  const db = getDb();

  // Bo'limlar ketma-ketligi: oldingi bo'lim to'liq bo'lmasa keyingisiga javob berib bo'lmaydi;
  // yakuniy bo'limga o'tilgach, oldingi bo'limlar yopiladi.
  const session = db.prepare('SELECT final_stage_at, status FROM audit_sessions WHERE id = ?').get(sessionId) as
    { final_stage_at: string | null; status: string } | undefined;
  if (session?.status === 'SUBMITTED') {
    throw new FlowError("Ariza topshirilgan — javoblarni o'zgartirib bo'lmaydi");
  }
  const crit = db.prepare(`
    SELECT st.domain_id AS domain_id FROM criteria c JOIN standards st ON st.id = c.standard_id WHERE c.id = ?
  `).get(criterionId) as { domain_id: number } | undefined;
  if (!session || !crit) {
    throw new FlowError('Sessiya yoki mezon topilmadi');
  }
  const progress = getDomainProgress(sessionId);
  const lastDomainId = progress[progress.length - 1].domain_id;
  if (session.final_stage_at && crit.domain_id !== lastDomainId) {
    throw new FlowError(`Yakuniy ${lastDomainId}-bo'limga o'tilgan, oldingi bo'limlarni o'zgartirib bo'lmaydi`);
  }
  if (!session.final_stage_at && crit.domain_id === lastDomainId) {
    throw new FlowError(`${lastDomainId}-bo'limga o'tish hali tasdiqlanmagan`);
  }
  const incomplete = progress.find((p) => p.domain_id < crit.domain_id && p.answered < p.total);
  if (incomplete) {
    throw new FlowError(`Avval ${incomplete.domain_id}-bo'limni to'liq to'ldiring`);
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

// Yakuniy (oxirgi) bo'limga o'tish: oldingi barcha bo'limlar to'liq bo'lishi shart, qaytib bo'lmaydi
export function enterFinalStage(sessionId: string) {
  const db = getDb();
  const session = db.prepare('SELECT final_stage_at, status FROM audit_sessions WHERE id = ?').get(sessionId) as
    { final_stage_at: string | null; status: string } | undefined;
  if (!session) {
    throw new FlowError('Sessiya topilmadi');
  }
  if (session.status === 'SUBMITTED') {
    throw new FlowError('Ariza allaqachon topshirilgan');
  }
  if (!session.final_stage_at) {
    const progress = getDomainProgress(sessionId);
    const incomplete = progress.slice(0, -1).find((p) => p.answered < p.total);
    if (incomplete) {
      throw new FlowError(`Avval ${incomplete.domain_id}-bo'limni to'liq to'ldiring`);
    }
    db.prepare("UPDATE audit_sessions SET final_stage_at = datetime('now') WHERE id = ?").run(sessionId);
  }
  return { status: 'FINAL_STAGE' };
}

export function submitSession(sessionId: string) {
  const db = getDb();

  // Tekshiruv va topshirish bitta IMMEDIATE tranzaksiyada: yozish qulfi tekshiruvdan oldin olinadi,
  // shuning uchun parallel so'rovlar bir INN'dan ikkinchi topshirishni o'tkazib yubora olmaydi.
  const submit = db.transaction(() => {
    const session = db.prepare(`
      SELECT s.final_stage_at, s.status, s.submitted_at, o.inn FROM audit_sessions s
      JOIN organizations o ON o.id = s.org_id WHERE s.id = ?
    `).get(sessionId) as { final_stage_at: string | null; status: string; submitted_at: string | null; inn: string } | undefined;
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
    const incomplete = getDomainProgress(sessionId).find((p) => p.answered < p.total);
    if (!session.final_stage_at || incomplete) {
      throw new FlowError("Arizani topshirish uchun barcha bo'limlarni to'liq to'ldiring");
    }
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

  const readyRes = db.prepare("SELECT COUNT(*) as cnt FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'READY'").get() as { cnt: number };
  const readyCount = readyRes?.cnt || 0;

  const riskRes = db.prepare("SELECT COUNT(*) as cnt FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'NOT_READY'").get() as { cnt: number };
  const riskCount = riskRes?.cnt || 0;

  return {
    total_clinics: totalSubmitted,
    avg_score: avgScore,
    ready_clinics: readyCount,
    risk_clinics: riskCount,
    passing_threshold: 75.0,
  };
}

export function getBackofficeRegions(sortBy: string = 'score_desc') {
  const db = getDb();

  const rows = db.prepare(`
    SELECT 
        o.region,
        COUNT(s.id) as count,
        AVG(s.total_score) as avg_score,
        SUM(CASE WHEN s.readiness_category = 'READY' THEN 1 ELSE 0 END) as ready_count
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

export function getBackofficeDomains() {
  const db = getDb();

  const domains = db.prepare('SELECT DISTINCT domain_id, domain_name FROM standards ORDER BY domain_id').all() as Array<{
    domain_id: number;
    domain_name: string;
  }>;

  const baseScores: Record<number, number> = {
    1: 76.2, 2: 71.8, 3: 52.4, 4: 64.5, 5: 78.9, 6: 67.1, 7: 74.0,
  };

  return domains.map((d) => ({
    id: d.domain_id,
    name: d.domain_name,
    score: baseScores[d.domain_id] || 70.0,
    is_weakest: d.domain_id === 3,
  }));
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
  if (status !== 'all') {
    if (status === 'ready') {
      query += " AND s.readiness_category = 'READY'";
    } else if (status === 'partial') {
      query += " AND s.readiness_category = 'PARTIALLY_READY'";
    } else if (status === 'risk') {
      query += " AND s.readiness_category = 'NOT_READY'";
    }
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
      status: r.readiness_category === 'READY' ? 'ready' : (r.readiness_category === 'PARTIALLY_READY' ? 'partial' : 'risk'),
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
    csvContent += `"${r.name}",${r.inn},${r.region},${r.district},${r.level},${r.total_score}%,${r.readiness_category},${r.submitted_at || ''}\n`;
  }

  return csvContent;
}
