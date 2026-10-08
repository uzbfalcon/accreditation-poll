import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'clamo_accreditation.db');

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
  }
  return dbInstance;
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

export interface InnLookupResult {
  inn: string;
  found: boolean;
  name: string;
  region: string;
  district: string;
  address: string;
  status: string;
}

export function lookupInnData(inn: string): InnLookupResult {
  const mockDb: Record<string, Omit<InnLookupResult, 'inn' | 'found'>> = {
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
      address: 'Turkiston ko\'chasi 14',
      status: 'ACTIVE',
    },
    '204992110': {
      name: "«ASAKA TUMAN TIBBIYOT BIRLASHMASI TUG'RUQ MAJMUASI»",
      region: 'Andijon viloyati',
      district: 'Asaka',
      address: 'Qorasuv ko\'chasi 2',
      status: 'ACTIVE',
    },
    '308221004': {
      name: '«BUXORO KARVON SINO NEVROLOGIYA VA REABILITATSIYA» MCHJ',
      region: 'Buxoro viloyati',
      district: 'Buxoro sh.',
      address: 'Ibn Sino ko\'chasi 18',
      status: 'ACTIVE',
    },
    '306771893': {
      name: '«CHIRCHIQ MED STAR DIAGNOSTIKA MARKAZI» MCHJ',
      region: 'Toshkent viloyati',
      district: 'Chirchiq sh.',
      address: 'Navoiy shoh ko\'chasi 7',
      status: 'ACTIVE',
    },
  };

  if (inn in mockDb) {
    return { inn, found: true, ...mockDb[inn] };
  }

  return {
    inn,
    found: true,
    name: `«TIBBIYOT DIAGNOSTIKA VA DAVOLASH #${inn.slice(-4)}» MCHJ`,
    region: 'Toshkent shahri',
    district: 'Yunusobod',
    address: "Markaziy shoh ko'cha 1-uy",
    status: 'ACTIVE',
  };
}

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

  const inn = (data.inn || '305123456').trim();
  const orgName = (data.name || '').trim() || lookupInnData(inn).name;
  const cadastre = data.cadastre_number || '';
  const region = data.region || 'Toshkent shahri';
  const district = data.district || 'Yunusobod';
  const fio = data.submitter_fio || "Mas'ul Shaxs";
  const phone = data.submitter_phone || '+998 71 200-00-00';
  const level = data.level || 'VILOYAT';
  const profile = data.profile || 'ARALASH';

  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const sessionId = `${inn}-${day}${month}`;
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

export function submitSession(sessionId: string) {
  const db = getDb();
  const updatedScore = calculateSessionScore(sessionId);

  db.prepare(`
    UPDATE audit_sessions 
    SET status = 'SUBMITTED', submitted_at = datetime('now')
    WHERE id = ?
  `).run(sessionId);

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
      date: r.submitted_at || '2026-10-06',
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
