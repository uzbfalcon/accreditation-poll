'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatTashkentDateTime } from '@/lib/format';
import ReadinessBadge, { scoreColorClass } from '@/components/ReadinessBadge';
import ReceiptPrintDocument from '@/components/ReceiptPrintDocument';
import { REGIONS, districtsOf } from '@/lib/regions';
import {
  Check,
  Clock,
  Award,
  X,
  Minus,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Lock,
  LayoutDashboard,
  CheckCircle2,
  Printer,
  Calendar,
  Hash,
} from 'lucide-react';

interface CriterionItem {
  id: number;
  number: number;
  description: string;
  is_critical: boolean;
  answer: string;
  note: string;
}

interface StandardItem {
  id: number;
  title: string;
  applicability: string;
  criteria: CriterionItem[];
}

interface DomainItem {
  id: number;
  name: string;
  standards: StandardItem[];
}

interface ScoreData {
  session_id: string;
  total_criteria: number;
  applicable_criteria: number;
  yes_count: number;
  partial_count: number;
  no_count: number;
  na_count: number;
  total_score: number;
  readiness_category: string;
  has_critical_stop_factors: boolean;
}

interface SubmissionConfirmation {
  sessionId: string;
  submittedAt: string;
  orgName: string;
  inn: string;
  cadastre: string;
  region: string;
  fio: string;
  phone: string;
  totalCriteria: number;
  completedCriteria: number;
  // Dastlabki baholash natijasi (server hisoblaydi: lib/readiness.ts — standartlar metodikasi)
  earnedPoints: number;
  maxPoints: number;
  scorePercent: number;
  category: string;
  hasCriticalViolations: boolean;
}

// Hujjatdagi «Amalda ko'rsatilayotgan xizmatlar» jadvali tartibida (avtomatik «Tadbiq etilmaydi» qoidalari: lib/db.ts STANDARD_SERVICE_RULES)
const SERVICE_OPTIONS = [
  { key: 'has_emergency_blue_code', label: 'Shoshilinch yordam' },
  { key: 'has_surgery', label: "Jarrohlik bo'limi" },
  { key: 'has_anesthesia', label: 'Anesteziya / sedatsiya' },
  { key: 'has_laboratory', label: 'Laboratoriya' },
  { key: 'has_radiology_ultrasound', label: 'Funksional diagnostika' },
  { key: 'has_mri', label: 'MRT xizmati' },
  { key: 'has_endoscopy', label: 'Endoskopiya' },
  { key: 'has_sterilization_dept', label: "Sterilizatsiya bo'linmasi" },
  { key: 'has_academic_base', label: "O'quv bazasi / ta'lim oluvchilar" },
] as const;

// Javob tugmalari: tanlangan va tanlanmagan holat uslublari
const ANSWER_OPTIONS = [
  { value: 'YES', label: 'Bor', Icon: Check, selected: 'bg-emerald-700 text-white border-emerald-700 shadow-xs ring-2 ring-emerald-600/30', idle: 'bg-white text-slate-700 border-slate-300 hover:border-emerald-600 hover:bg-emerald-50/30' },
  { value: 'PARTIAL', label: 'Qisman', Icon: Award, selected: 'bg-amber-600 text-white border-amber-600 shadow-xs ring-2 ring-amber-500/30', idle: 'bg-white text-slate-700 border-slate-300 hover:border-amber-500 hover:bg-amber-50/30' },
  { value: 'NO', label: "Yo'q", Icon: X, selected: 'bg-rose-700 text-white border-rose-700 shadow-xs ring-2 ring-rose-600/30', idle: 'bg-white text-slate-700 border-slate-300 hover:border-rose-600 hover:bg-rose-50/30' },
  { value: 'NA', label: 'Tadbiq etilmaydi', Icon: Minus, selected: 'bg-slate-700 text-white border-slate-700 shadow-xs ring-2 ring-slate-600/30', idle: 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100 hover:text-slate-700' },
] as const;

export default function ChecklistPortalPage() {
  const router = useRouter();

  const [submissionSuccess, setSubmissionSuccess] = useState<SubmissionConfirmation | null>(null);
  const [receiptPrintedAt, setReceiptPrintedAt] = useState('');

  // Onboarding Form State
  const [inn, setInn] = useState('');
  const [orgName, setOrgName] = useState('');
  const [cadastre, setCadastre] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [level, setLevel] = useState('');
  const [fio, setFio] = useState('');
  const [phone, setPhone] = useState('');
  // Quvvati (o'rinlar, kunlik tashriflar, bo'linmalar) — raqamli maydonlar, bo'sh holatda ''
  const [bedCapacity, setBedCapacity] = useState('');
  const [dailyVisits, setDailyVisits] = useState('');
  const [departmentsCount, setDepartmentsCount] = useState('');
  const [innFound, setInnFound] = useState(false);
  // Ushbu INN bo'yicha ariza allaqachon topshirilganmi (bitta INN — bitta topshirish)
  const [alreadySubmitted, setAlreadySubmitted] = useState<{ at: string | null } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isSearchingInn, setIsSearchingInn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [offerAccepted, setOfferAccepted] = useState(false);
  // INN reyestrdan topilmasa — nom va hudud qo'lda kiritiladi
  const manualOrgEntry = inn.length === 9 && !isSearchingInn && !innFound;

  // Services State
  const [services, setServices] = useState({
    has_emergency_blue_code: false,
    has_surgery: false,
    has_anesthesia: false,
    has_laboratory: false,
    has_radiology_ultrasound: false,
    has_mri: false,
    has_endoscopy: false,
    has_sterilization_dept: false,
    has_academic_base: false,
  });

  // Checklist View State
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [activeDomainId, setActiveDomainId] = useState(1);
  const [stuckDomainIds, setStuckDomainIds] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Joriy (tahrirlanadigan) bo'lim: oldingilari faqat ko'rish uchun, keyingilari yopiq (server: current_section)
  const [currentSection, setCurrentSection] = useState(1);
  // Tasdiqlash oynasi: bo'limni yakunlab o'tish yoki arizani topshirish
  const [flowModal, setFlowModal] = useState<'advance' | 'submit' | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  // Javobsiz mezonlarni ajratib ko'rsatish (oynadagi «Javobsizlarni ko'rsatish» tugmasidan keyin)
  const [highlightUnanswered, setHighlightUnanswered] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced INN lookup
  useEffect(() => {
    setAlreadySubmitted(null);
    setStartError(null);
    // Boshqa INN uchun avvalgi nom/hudud qolib ketmasin
    setOrgName('');
    setRegion('');
    setDistrict('');
    if (inn.length === 9) {
      setIsSearchingInn(true);
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/organizations/lookup-inn/${inn}`);
          const data = await res.json();
          if (data.already_submitted) {
            setAlreadySubmitted({ at: data.submitted_at ?? null });
          }
          if (data.found) {
            setOrgName(data.name);
            if (data.region) setRegion(data.region);
            if (data.district) setDistrict(data.district);
            setInnFound(true);
          } else {
            setInnFound(false);
          }
        } catch (e) {
          console.error('INN lookup error:', e);
          setInnFound(false);
        } finally {
          setIsSearchingInn(false);
        }
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setInnFound(false);
      setIsSearchingInn(false);
    }
  }, [inn]);

  // Load full checklist (also used to resync after a rejected autosave)
  const loadChecklist = async (sessionId: string) => {
    const checkRes = await fetch(`/api/v1/audit-sessions/${sessionId}/checklist`);
    const checkData = await checkRes.json();
    const section = Number(checkData.session?.current_section) || 1;
    setDomains(checkData.domains);
    setScore(checkData.score);
    setCurrentSection(section);
    setActiveDomainId(section);
    return section;
  };

  // Start Checklist
  const handleStartChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    // readOnly maydonlar brauzerda «required» bo'yicha tekshirilmaydi — shu yerda tekshiriladi
    if (!/^\d{9}$/.test(inn) || !orgName.trim() || !region || !district) {
      setStartError("INN (9 xonali), tashkilot nomi, hudud va tumanni to'ldiring");
      return;
    }
    setStartError(null);
    setIsInitializing(true);

    try {
      const payload = {
        inn,
        name: orgName,
        cadastre_number: cadastre,
        region,
        district,
        level,
        submitter_fio: fio,
        submitter_phone: phone,
        bed_capacity: Number(bedCapacity),
        daily_visits: Number(dailyVisits),
        departments_count: Number(departmentsCount),
        services,
      };

      const res = await fetch('/api/v1/audit-sessions/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'ALREADY_SUBMITTED') {
          setAlreadySubmitted({ at: data.submitted_at ?? null });
        } else {
          setStartError(data.error || "Chek-listni boshlab bo'lmadi");
        }
        return;
      }

      setActiveSessionId(data.session_id);
      setScore(data.score);
      await loadChecklist(data.session_id);
    } catch (err) {
      alert("Xatolik: Serverga ulanib bo'lmadi");
    } finally {
      setIsInitializing(false);
    }
  };

  // Scroll handler: Manages 100% Full-Width Sticky Headers & Sidebar TOC with Hysteresis
  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const scrollTop = scrollArea.scrollTop;
    const newStuckMap: Record<number, boolean> = {};
    let currentActiveId = activeDomainId;

    domains.forEach((d) => {
      const sec = document.getElementById(`domain-section-${d.id}`);
      if (!sec) return;

      const secTop = sec.offsetTop;
      const secHeight = sec.offsetHeight;
      const wasStuck = Boolean(stuckDomainIds[d.id]);

      // Hysteresis deadband: 45px to enter sticky, 20px to exit sticky.
      // This mathematically guarantees zero jitter / oscillation / "bijirlash".
      const isPastStart = wasStuck ? scrollTop >= (secTop + 20) : scrollTop >= (secTop + 45);
      const isBeforeEnd = scrollTop < (secTop + secHeight - 35);

      newStuckMap[d.id] = isPastStart && isBeforeEnd;

      // Sidebar TOC sync
      if (scrollTop >= secTop - 60 && scrollTop < secTop + secHeight - 60) {
        currentActiveId = d.id;
      }
    });

    // CRITICAL: Only trigger React state update if stuck states actually changed!
    let stuckChanged = false;
    for (const d of domains) {
      if (Boolean(newStuckMap[d.id]) !== Boolean(stuckDomainIds[d.id])) {
        stuckChanged = true;
        break;
      }
    }
    if (stuckChanged) {
      setStuckDomainIds(newStuckMap);
    }

    if (!isProgrammaticScrollRef.current && currentActiveId !== activeDomainId) {
      setActiveDomainId(currentActiveId);
    }
  }, [domains, stuckDomainIds, activeDomainId]);

  const scrollToDomain = (domainId: number) => {
    setActiveDomainId(domainId);
    const scrollArea = scrollAreaRef.current;
    const targetEl = document.getElementById(`domain-section-${domainId}`);
    if (targetEl && scrollArea) {
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }

      scrollArea.scrollTo({
        top: Math.max(0, targetEl.offsetTop),
        behavior: 'smooth',
      });

      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        handleScroll();
      }, 600);
    }
  };

  // Save single answer (Optimistic UI update)
  const handleSaveAnswer = async (criterionId: number, answerValue: string) => {
    if (!activeSessionId) return;
    // Faqat joriy bo'lim tahrirlanadi (tugmalar boshqa bo'limlarda o'chirilgan; bu — qo'shimcha himoya)
    const owner = domains.find((d) => d.standards.some((st) => st.criteria.some((c) => c.id === criterionId)));
    if (owner && owner.id !== currentSection) return;

    // 1. Optimistic update in state
    setDomains((prev) =>
      prev.map((d) => ({
        ...d,
        standards: d.standards.map((st) => ({
          ...st,
          criteria: st.criteria.map((c) =>
            c.id === criterionId ? { ...c, answer: answerValue } : c
          ),
        })),
      }))
    );

    // 2. Send PATCH to API
    try {
      const res = await fetch(`/api/v1/audit-sessions/${activeSessionId}/save-answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterion_id: criterionId, answer_value: answerValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Server rejected (e.g. section order rule) — show reason and resync with saved state
        alert(data.error || "Javobni saqlab bo'lmadi");
        await loadChecklist(activeSessionId);
        return;
      }
      if (data.score) {
        setScore(data.score);
      }
    } catch (e) {
      console.error('Autosave xatoligi:', e);
    }
  };

  // Overall checklist progress (question completion count, no score or readiness shown to clinic)
  const checklistProgress = useMemo(() => {
    let total = 0;
    let answered = 0;
    for (const d of domains) {
      for (const st of d.standards) {
        for (const c of st.criteria) {
          total++;
          if (c.answer && c.answer !== 'UNANSWERED') {
            answered++;
          }
        }
      }
    }
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    return { total, answered, pct };
  }, [domains]);

  // Final submission (tasdiqlash — o'zimizning oynamiz orqali, brauzerning confirm() emas)
  const handleSubmitAssessment = () => {
    if (!activeSessionId) return;
    setFlowModal('submit');
  };

  // Chop etish vaqti hujjatga yoziladi; PDF fayl nomi sahifa sarlavhasidan olinadi
  const handlePrintReceipt = () => {
    if (!submissionSuccess) return;
    const now = formatTashkentDateTime(new Date().toISOString());
    setReceiptPrintedAt(`${now.date}, ${now.time}`);
    const previousTitle = document.title;
    document.title = `CLAMO_kvitansiya_${submissionSuccess.sessionId}`;
    // Yangi vaqt DOM'ga tushishi uchun keyingi kadrda chop etiladi
    setTimeout(() => {
      window.print();
      document.title = previousTitle;
    }, 50);
  };

  const handleConfirmSubmit = async () => {
    if (!activeSessionId) return;
    {
      setIsSubmitting(true);
      try {
        const res = await fetch(`/api/v1/audit-sessions/${activeSessionId}/submit`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Xatolik: Arizani topshirib bo'lmadi");
          return;
        }
        const finalScore = data.final_score;

        // Brauzerning «uz-UZ» formati «2026 M10 9» ko'rinishida chiqadi — umumiy Toshkent formati ishlatiladi
        const submittedAtParts = formatTashkentDateTime(new Date().toISOString());
        const formattedDate = `${submittedAtParts.date}, ${submittedAtParts.time}`;

        setSubmissionSuccess({
          sessionId: activeSessionId,
          submittedAt: formattedDate,
          orgName: orgName || 'Tibbiyot muassasasi',
          inn: inn || '—',
          cadastre: cadastre || '—',
          region: region || "O'zbekiston Respublikasi",
          fio: fio || '—',
          phone: phone || '—',
          // Topshirishda javobsiz mezonlar «Yo'q» bo'ladi — hisob serverdagi natijadan
          totalCriteria: finalScore.total_criteria,
          completedCriteria:
            finalScore.yes_count + finalScore.partial_count + finalScore.no_count + finalScore.na_count,
          earnedPoints: finalScore.earned_points,
          maxPoints: finalScore.max_points,
          scorePercent: finalScore.total_score,
          category: finalScore.readiness_category,
          hasCriticalViolations: finalScore.has_critical_stop_factors,
        });
        setFlowModal(null);
      } catch (e) {
        alert("Xatolik: Arizani topshirib bo'lmadi");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Calculate per-domain completion progress for sidebar & headers (no score or readiness shown to clinic)
  const domainStatsMap = useMemo(() => {
    const map: Record<number, { totalCriteria: number; answeredCount: number; completionPct: number }> = {};
    for (const d of domains) {
      let total = 0;
      let answered = 0;
      for (const st of d.standards) {
        for (const c of st.criteria) {
          total++;
          if (c.answer && c.answer !== 'UNANSWERED') {
            answered++;
          }
        }
      }
      const completionPct = total > 0 ? Math.round((answered / total) * 100) : 0;
      map[d.id] = { totalCriteria: total, answeredCount: answered, completionPct };
    }
    return map;
  }, [domains]);

  // Bo'limlar oqimi: faqat joriy bo'lim tahrirlanadi; oldingilari yakunlangan (faqat ko'rish), keyingilari yopiq.
  // Keyingi bo'limga o'tishda joriy bo'limning javobsiz mezonlari «Yo'q» bo'ladi (server: advanceSection).
  const domainFlow = useMemo(() => {
    const lastDomain = domains[domains.length - 1];
    const nextDomain = domains.find((d) => d.id > currentSection);
    const stats = domainStatsMap[currentSection];
    return {
      lastDomain,
      nextDomain,
      visibleDomains: domains.filter((d) => d.id <= currentSection),
      isLastSection: Boolean(lastDomain && currentSection === lastDomain.id),
      unansweredInCurrent: stats ? stats.totalCriteria - stats.answeredCount : 0,
      canSubmit: Boolean(lastDomain && currentSection === lastDomain.id),
      isUnlocked: (id: number) => id <= currentSection,
      isEditable: (id: number) => id === currentSection,
    };
  }, [domains, domainStatsMap, currentSection]);

  const handleAdvanceSection = async () => {
    if (!activeSessionId || !domainFlow.nextDomain) return;
    setIsAdvancing(true);
    try {
      const res = await fetch(`/api/v1/audit-sessions/${activeSessionId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_section: currentSection }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Keyingi bo'limga o'tib bo'lmadi");
      }
      // Avtomatik «Yo'q» javoblar va yangi joriy bo'lim serverdan olinadi
      const section = await loadChecklist(activeSessionId);
      setFlowModal(null);
      setHighlightUnanswered(false);
      setTimeout(() => scrollToDomain(section), 50);
    } catch (e) {
      alert("Xatolik: Serverga ulanib bo'lmadi");
    } finally {
      setIsAdvancing(false);
    }
  };

  // Oynadan: joriy bo'limdagi birinchi javobsiz mezonga o'tish va javobsizlarni ajratib ko'rsatish
  const handleShowUnanswered = () => {
    setFlowModal(null);
    setHighlightUnanswered(true);
    const domain = domains.find((d) => d.id === currentSection);
    const first = domain?.standards.flatMap((st) => st.criteria).find((c) => !c.answer || c.answer === 'UNANSWERED');
    if (first) {
      setTimeout(() => document.getElementById(`criterion-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };

  // Oyna ochiq bo'lsa Esc bilan yopiladi (jarayon davom etayotganda emas)
  useEffect(() => {
    if (!flowModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAdvancing && !isSubmitting) setFlowModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flowModal, isAdvancing, isSubmitting]);

  const handleSidebarDomainClick = (domainId: number) => {
    if (domainFlow.isUnlocked(domainId)) {
      scrollToDomain(domainId);
    }
  };

  // --------------------------------------------------------------------------
  // VIEW: SUBMISSION SUCCESS / CONFIRMATION RECEIPT PAGE
  // --------------------------------------------------------------------------
  if (submissionSuccess) {
    return (
      <>
      <ReceiptPrintDocument data={submissionSuccess} printedAt={receiptPrintedAt} />
      <div className="min-h-full flex flex-col bg-slate-50 text-slate-900 print:hidden">
        {/* Navbar (Hidden in print) */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs no-print">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3.5 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="CLAMO"
                className="h-10 sm:h-11 w-auto object-contain"
              />
              <span className="bg-teal-50 text-teal-700 text-2xs font-bold px-2 py-0.5 rounded border border-teal-200 uppercase tracking-wider">
                Akkreditatsiya Tasdiqnomasi
              </span>
            </Link>

            <div className="flex items-center gap-3">
              <Link
                href="/backoffice"
                className="text-xs font-bold text-slate-700 hover:text-teal-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
                <span>Backoffice Monitoring &rarr;</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col items-center">
          {/* Status Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-800 text-xs font-bold mb-4 shadow-2xs no-print">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Akkreditatsiya arizasi muvaffaqiyatli qabul qilindi</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 text-center tracking-tight mb-2">
            Akkreditatsiya So&apos;rovnomasi Qabul Qilindi
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 text-center max-w-lg mb-8 no-print">
            Chek-list so&apos;rovnomasi to&apos;liq topshirildi va vakolatli ekspert komissiyasiga ko&apos;rib chiqish uchun yuborildi.
          </p>

          {/* Official Accreditation Receipt / Certificate Card */}
          <div className="w-full bg-white border border-slate-300 rounded-2xl shadow-xl overflow-hidden print:border-none print:shadow-none print:p-0">
            {/* Top decorative stripe */}
            <div className="h-2 bg-gradient-to-r from-teal-600 via-blue-600 to-indigo-600"></div>

            <div className="p-6 sm:p-10 space-y-8">
              {/* Receipt Header (Shows both on screen & print) */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.svg" alt="CLAMO" className="h-10 w-auto object-contain" />
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                      CLAMO TIBBIYOT AKKREDITATSIYASI
                    </h2>
                    <p className="text-xs text-slate-500">
                      Milliy sifat va xavfsizlik standartlari milliy tizimi
                    </p>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <span className="text-2xs font-bold uppercase tracking-wider text-slate-400 block">
                    Ariza Maqomi
                  </span>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold mt-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>QABUL QILINDI / JARAYONDA</span>
                  </div>
                </div>
              </div>

              {/* High-level ID and Date highlight cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                    <Hash className="w-3.5 h-3.5 text-teal-600" />
                    <span>Akkreditatsiya arizasi №</span>
                  </div>
                  <div className="font-mono font-extrabold text-lg text-teal-900 tracking-tight">
                    {submissionSuccess.sessionId}
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    <span>Topshirilgan sana va vaqt</span>
                  </div>
                  <div className="font-semibold text-sm text-slate-900">
                    {submissionSuccess.submittedAt}
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>To&apos;ldirilgan mezonlar</span>
                  </div>
                  <div className="font-bold text-sm text-emerald-700">
                    {submissionSuccess.completedCriteria} / {submissionSuccess.totalCriteria} ta mezon (
                    {submissionSuccess.totalCriteria > 0
                      ? Math.round((submissionSuccess.completedCriteria / submissionSuccess.totalCriteria) * 100)
                      : 0}
                    %)
                  </div>
                </div>
              </div>

              {/* Dastlabki baholash natijasi: ball va foiz (foiz = olingan ball / maksimal ball) */}
              <div className="rounded-xl border border-slate-200 p-5 sm:p-6">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Dastlabki baholash natijasi
                </h3>
                <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
                  <div className="shrink-0">
                    <div className={`text-4xl font-extrabold font-mono tracking-tight ${scoreColorClass(submissionSuccess.scorePercent)}`}>
                      {submissionSuccess.scorePercent}%
                    </div>
                    <div className="mt-2">
                      <ReadinessBadge category={submissionSuccess.category} size="md" />
                    </div>
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold font-mono text-slate-900">{submissionSuccess.earnedPoints}</span>
                      <span className="text-sm text-slate-500">
                        / {submissionSuccess.maxPoints} ball
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          submissionSuccess.scorePercent >= 85
                            ? 'bg-emerald-500'
                            : submissionSuccess.scorePercent >= 75
                            ? 'bg-teal-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, submissionSuccess.scorePercent)}%` }}
                      ></div>
                    </div>
                    <p className="text-caption text-slate-500 leading-relaxed">
                      Bajarilgan mezon: Gold — 1,3 ball, oddiy — 1 ball; «Qisman» — 0,5 ball; «Tadbiq etilmaydi» mezonlar
                      hisobga olinmaydi. Toifalar 16-son qaror (37-band) bo&apos;yicha: oliy — 95%, birinchi — 85%, ikkinchi — 75%.
                    </p>
                    {submissionSuccess.hasCriticalViolations && (
                      <p className="text-caption font-semibold text-rose-700 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        Kritik xavfsizlik talablaridan biri bajarilmagan — ekspert baholashida alohida e&apos;tibor qaratiladi.
                      </p>
                    )}
                  </div>
                </div>
                <p className="mt-4 pt-3 border-t border-slate-100 text-caption text-slate-400">
                  Natija o&apos;z-o&apos;zini baholash asosida hisoblangan dastlabki ko&apos;rsatkich. Rasmiy akkreditatsiya toifasini
                  akkreditatsiyalovchi organ belgilaydi.
                </p>
              </div>

              {/* Detailed Organisation Information */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Tibbiyot Tashkiloti va Ariza Beruvchi Ma&apos;lumotlari
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-xs bg-slate-50/70 rounded-xl p-5 border border-slate-200/80">
                  <div>
                    <span className="text-slate-500 block mb-0.5">Tashkilot to&apos;liq nomi:</span>
                    <span className="font-bold text-slate-900 text-sm">{submissionSuccess.orgName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Soliq to&apos;lovchining identifikatsiya raqami (STIR / INN):</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{submissionSuccess.inn}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Joylashgan hudud:</span>
                    <span className="font-semibold text-slate-800">{submissionSuccess.region}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Kadastr raqami:</span>
                    <span className="font-mono font-semibold text-slate-800">{submissionSuccess.cadastre}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Mas&apos;ul shaxs (F.I.O.):</span>
                    <span className="font-semibold text-slate-800">{submissionSuccess.fio}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">Bog&apos;lanish telefoni:</span>
                    <span className="font-mono font-semibold text-slate-800">{submissionSuccess.phone}</span>
                  </div>
                </div>
              </div>

              {/* Commission Review Information Box */}
              <div className="bg-teal-50/80 border border-teal-200 rounded-xl p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div className="text-xs text-teal-950 space-y-1">
                  <p className="font-bold">
                    Keyingi bosqich — Vakolatli ekspert komissiyasi ko&apos;rib chiqishi:
                  </p>
                  <p className="text-teal-800 leading-relaxed">
                    Siz topshirgan o&apos;z-o&apos;zini baholash chek-listi tizimda muhrlandi. Vakolatli akkreditatsiya ekspertlari
                    hujjatlarni o&apos;rganib chiqib, joyiga chiqish auditi sanasi va qo&apos;shimcha talablar bo&apos;yicha rasmiy xabarnoma yuboradi.
                  </p>
                </div>
              </div>

              {/* Chop etish — ekrandagi kartochka emas, components/ReceiptPrintDocument (A4 shakli) chiqadi */}
              <div className="pt-4 border-t border-slate-200 flex items-center">
                <button
                  type="button"
                  onClick={handlePrintReceipt}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition flex items-center gap-2 shadow-2xs hover:shadow-xs cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  <span>Kvitansiyani Chop Etish / PDF</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
      </>
    );
  }

  // --------------------------------------------------------------------------
  // VIEW 1: ONBOARDING VIEW
  // --------------------------------------------------------------------------
  if (!activeSessionId) {
    return (
      <div className="min-h-full flex flex-col bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3.5 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="CLAMO"
                className="h-10 sm:h-11 w-auto object-contain group-hover:scale-[1.02] transition-transform"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-teal-50 text-teal-700 text-2xs font-bold px-2 py-0.5 rounded border border-teal-200 uppercase tracking-wider">
                    Klinika Portali
                  </span>
                </div>
                <p className="text-caption text-slate-500 hidden sm:block">
                  75 ta standart va 275 ta mezon asosidagi milliy audit chek-listi
                </p>
              </div>
            </Link>

            <Link
              href="/backoffice"
              className="text-xs font-bold text-slate-700 hover:text-teal-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
              <span>Backoffice Monitoring &rarr;</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-teal-800 text-xs font-bold mb-3 shadow-2xs">
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              <span>Davlat Standartlari Asosida Rasmiy Akkreditatsiya So&apos;rovnomasi</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Klinika Pasporti va Xizmatlar Ro&apos;yxati
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
              Tashkilotingiz INN va xizmatlari profilini tasdiqlang. Tizim sizning yo&apos;nalishingizga mos mezonlarni belgilaydi.
            </p>
          </div>

          <div className="bg-white border border-slate-300 rounded-2xl shadow-xl p-6 sm:p-10 relative">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 rounded-t-2xl"></div>

            <form onSubmit={handleStartChecklist} className="space-y-6">
              {/* STEP 1: INN & ORG NAME */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Tashkilot INN&apos;i *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={9}
                      value={inn}
                      onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))}
                      placeholder="Masalan: 304907014"
                      inputMode="numeric"
                      pattern="\d{9}"
                      title="9 xonali raqam"
                      className="w-full pl-3 pr-32 py-2.5 bg-white border border-slate-300 rounded-xl font-mono text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      required
                    />
                    {isSearchingInn ? (
                      <span className="absolute right-2 top-2 text-2xs bg-cyan-50 text-cyan-800 font-bold px-2 py-1 rounded border border-cyan-200 flex items-center gap-1.5 shadow-2xs">
                        <span className="w-2.5 h-2.5 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin"></span>
                        Qidirilmoqda...
                      </span>
                    ) : innFound ? (
                      <span className="absolute right-2 top-2 text-2xs bg-emerald-50 text-emerald-800 font-bold px-2 py-1 rounded border border-emerald-200 flex items-center gap-1 shadow-2xs">
                        <Check className="w-3 h-3 text-emerald-600" />
                        Topildi
                      </span>
                    ) : inn.length === 9 ? (
                      <span className="absolute right-2 top-2 text-2xs bg-amber-50 text-amber-800 font-bold px-2 py-1 rounded border border-amber-200 flex items-center gap-1 shadow-2xs">
                        Topilmadi
                      </span>
                    ) : null}
                  </div>
                  <p className="text-caption text-slate-500 mt-1">9 xonali yuridik shaxs INN kodi</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Tashkilot nomi *
                  </label>
                  <input
                    type="text"
                    readOnly={!manualOrgEntry}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={manualOrgEntry ? 'Tashkilot nomini kiriting' : "INN kiritilgach avtomatik to'ldiriladi"}
                    className={`w-full px-3 py-2.5 border rounded-xl font-bold text-xs text-slate-800 ${
                      manualOrgEntry
                        ? 'bg-white border-slate-300 focus:ring-2 focus:ring-teal-500 focus:outline-none'
                        : 'bg-slate-50 border-slate-200 cursor-not-allowed'
                    }`}
                  />
                </div>
              </div>

              {/* STEP 2: DARAJA, KADASTR, HUDUD, TUMAN — hudud va tumanlar lib/regions.ts ro'yxatidan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label htmlFor="level" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Muassasa darajasi *
                  </label>
                  <div className="relative">
                    <select
                      id="level"
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      required
                      className={`w-full appearance-none pl-3 pr-10 py-2.5 border border-slate-300 rounded-xl text-xs bg-white cursor-pointer focus:ring-2 focus:ring-teal-500 focus:outline-none ${
                        level ? 'text-slate-800' : 'text-slate-400'
                      }`}
                    >
                      <option value="" disabled>
                        Tanlang
                      </option>
                      <option value="RESPUBLIKA">Respublika darajasi</option>
                      <option value="VILOYAT">Viloyat darajasi</option>
                      <option value="TUMAN">Tuman darajasi</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  </div>
                </div>

                <div>
                  <label htmlFor="cadastre" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Kadastr raqami *
                  </label>
                  <input
                    id="cadastre"
                    type="text"
                    value={cadastre}
                    onChange={(e) => setCadastre(e.target.value)}
                    placeholder="XX:XX:XX:XX:XX:XXXX"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="region" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Viloyat / Hudud *
                  </label>
                  <div className="relative">
                    <select
                      id="region"
                      value={region}
                      onChange={(e) => {
                        setRegion(e.target.value);
                        setDistrict('');
                      }}
                      required
                      className={`w-full appearance-none pl-3 pr-10 py-2.5 border border-slate-300 rounded-xl text-xs bg-white cursor-pointer focus:ring-2 focus:ring-teal-500 focus:outline-none ${
                        region ? 'text-slate-800 font-bold' : 'text-slate-400'
                      }`}
                    >
                      <option value="" disabled>
                        Tanlang
                      </option>
                      {REGIONS.map((r) => (
                        <option key={r.code} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  </div>
                </div>

                <div>
                  <label htmlFor="district" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Tuman / Shahar *
                  </label>
                  <div className="relative">
                    <select
                      id="district"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      required
                      disabled={!region}
                      className={`w-full appearance-none pl-3 pr-10 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none ${
                        region ? 'bg-white cursor-pointer' : 'bg-slate-50 cursor-not-allowed'
                      } ${district ? 'text-slate-800 font-bold' : 'text-slate-400'}`}
                    >
                      <option value="" disabled>
                        {region ? 'Tanlang' : 'Avval hududni tanlang'}
                      </option>
                      {districtsOf(region).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  </div>
                </div>
              </div>

              {/* STEP 2b: QUVVATI */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">Quvvati *</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { id: 'bed-capacity', label: "O'rinlar soni", value: bedCapacity, set: setBedCapacity, placeholder: 'Masalan: 120' },
                    { id: 'daily-visits', label: 'Tashriflar (sutkalik)', value: dailyVisits, set: setDailyVisits, placeholder: 'Masalan: 300' },
                    { id: 'departments', label: "Bo'linmalar soni", value: departmentsCount, set: setDepartmentsCount, placeholder: 'Masalan: 12' },
                  ].map((f) => (
                    <div key={f.id}>
                      <label htmlFor={f.id} className="block text-caption font-medium text-slate-600 mb-1">
                        {f.label}
                      </label>
                      <input
                        id={f.id}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
                        required
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* STEP 3: FIO & TELEFON */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    F.I.O (to&apos;ldiruvchi mas&apos;ul shaxs) *
                  </label>
                  <input
                    type="text"
                    value={fio}
                    onChange={(e) => setFio(e.target.value)}
                    placeholder="Familiya Ism Otasining ismi"
                    autoComplete="name"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Telefon raqam (tashkilotniki) *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+998 90 123-45-67"
                    autoComplete="tel"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>
              </div>

              {/* STEP 4: SERVICES APPLICABILITY CHECKBOXES */}
              <div className="pt-4 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Amalda ko&apos;rsatilayotgan tibbiy xizmatlar («Tadbiq etilmaydi» qoidalariga binoan):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-700">
                  {SERVICE_OPTIONS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                      <input
                        type="checkbox"
                        checked={services[key]}
                        onChange={(e) => setServices({ ...services, [key]: e.target.checked })}
                        className="w-4 h-4 text-teal-600 rounded"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Bitta INN — bitta topshirish */}
              {alreadySubmitted && (
                <div role="alert" className="flex items-start gap-2.5 p-3.5 rounded-xl border border-amber-300 bg-amber-50 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-bold">Ushbu INN bo&apos;yicha ariza allaqachon topshirilgan</p>
                    <p className="mt-0.5">
                      {alreadySubmitted.at
                        ? `Topshirilgan sana: ${formatTashkentDateTime(alreadySubmitted.at).date}, ${formatTashkentDateTime(alreadySubmitted.at).time}. `
                        : ''}
                      Har bir tashkilot arizani faqat bir marta topshirishi mumkin. Qayta ko&apos;rib chiqish zarur bo&apos;lsa,
                      administratorga murojaat qiling.
                    </p>
                  </div>
                </div>
              )}
              {startError && (
                <div role="alert" className="flex items-start gap-2.5 p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{startError}</span>
                </div>
              )}

              {/* Public Offer Consent */}
              <div className="pt-1">
                <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 cursor-pointer hover:bg-slate-100 transition">
                  <input
                    type="checkbox"
                    checked={offerAccepted}
                    onChange={(e) => setOfferAccepted(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded"
                    required
                  />
                  <div>
                    <span className="font-bold text-slate-800">
                      <a
                        href="/oferta"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-700 underline underline-offset-2 hover:text-teal-900"
                      >
                        Ommaviy oferta
                      </a>{' '}
                      shartlariga roziman *
                    </span>
                    <p className="text-caption text-slate-500">
                      Ommaviy oferta shartlari bilan tanishdim, shaxsga doir ma&apos;lumotlarimga ishlov berishga rozilik beraman
                      va kiritilgan ma&apos;lumotlarning to&apos;g&apos;riligini tasdiqlayman
                    </p>
                  </div>
                </label>
              </div>

              <button
                type="submit"
                disabled={isInitializing || !offerAccepted || Boolean(alreadySubmitted)}
                className="w-full py-3.5 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800 text-white font-bold text-sm rounded-xl shadow-lg transition cursor-pointer flex items-center justify-center gap-2 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg"
              >
                <span>{isInitializing ? "Tayyorlanmoqda..." : "Chek-list Savolnomasini Boshlash (75 Standart)"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // VIEW 2: CONTINUOUS CHECKLIST VIEW WITH EXACT CODROPS STUDIO GRADE SPEC
  // --------------------------------------------------------------------------
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
      {/* ========================================================================= */}
      {/* UNIFIED COMMAND HEADER (NAVBAR + LIVE READINESS METER + CONTROLS)         */}
      {/* ========================================================================= */}
      <header className="bg-white border-b border-slate-200 shrink-0 z-40 px-4 sm:px-6 h-14 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="CLAMO" className="h-8 sm:h-9 w-auto object-contain" />
          </Link>

          <span className="text-slate-300 hidden sm:inline">|</span>

          {/* Clinic & Session metadata — long names truncate, full name on hover */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs font-bold text-slate-800 truncate min-w-0 max-w-xl" title={orgName}>
              {orgName}
            </span>
            <span className="text-2xs font-mono font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 shrink-0 hidden sm:inline">
              № {activeSessionId}
            </span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <span className="text-caption text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="hidden lg:inline">Avtomatik saqlanmoqda</span>
          </span>

          <Link
            href="/backoffice"
            className="text-xs font-semibold text-slate-600 hover:text-teal-700 hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
            <span>Backoffice</span>
          </Link>

          <button
            onClick={handleSubmitAssessment}
            disabled={isSubmitting || !domainFlow.canSubmit}
            title={domainFlow.canSubmit ? undefined : `Arizani topshirish uchun bo'limlarni ketma-ket yakunlab, ${domainFlow.lastDomain?.id}-bo'limga yeting`}
            className="px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-teal-700"
          >
            <span>{isSubmitting ? "Topshirilmoqda..." : "Arizani Topshirish"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MAIN TWO COLUMN WORKSPACE                                                 */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR: PURE NAVIGATION MENU (TOC) */}
        <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-2xs">
          {/* Checklist Completion Progress (No Score / Readiness shown to clinic) */}
          <div className="p-3.5 border-b border-slate-200">
            <div className="flex items-center justify-between text-caption font-bold text-slate-700">
              <span>To&apos;ldirilgan mezonlar</span>
              <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                {checklistProgress.answered} / {checklistProgress.total}
              </span>
            </div>
            <div className="mt-2 w-full bg-slate-200 h-2 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full rounded-full bg-teal-600 transition-all duration-300"
                style={{ width: `${checklistProgress.pct}%` }}
              ></div>
            </div>
            <div className="mt-1.5 text-2xs text-slate-500 font-medium">
              {checklistProgress.pct}% savolga javob berildi
            </div>
          </div>

          <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-teal-600" />
              <span>Asosiy bo&apos;limlar</span>
            </span>
            <span className="text-2xs text-slate-500 font-mono font-medium">
              {domains.length} ta bo&apos;lim
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {domains.map((d) => {
              const isActive = activeDomainId === d.id;
              const dStats = domainStatsMap[d.id];
              const isCompleted = dStats && dStats.answeredCount === dStats.totalCriteria && dStats.totalCriteria > 0;
              const isUnlocked = domainFlow.isUnlocked(d.id);
              const isFinished = d.id < currentSection;
              const itemTitle = isFinished
                ? "Yakunlangan bo'lim — faqat ko'rish mumkin"
                : isUnlocked
                ? undefined
                : `Avval ${currentSection}-bo'limni yakunlang`;

              return (
                <div
                  key={d.id}
                  onClick={() => handleSidebarDomainClick(d.id)}
                  title={itemTitle}
                  aria-disabled={!isUnlocked}
                  className={`sidebar-nav-item p-3.5 flex items-center justify-between gap-2 ${
                    isActive && isUnlocked ? 'active-nav-item shadow-2xs' : ''
                  } ${isUnlocked ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                >
                  <div className="min-w-0 flex-1">
                    <span className={`text-sm line-clamp-2 leading-snug ${isActive && isUnlocked ? 'font-bold' : 'font-semibold'}`}>
                      {d.name}
                    </span>
                    <div className="flex items-center gap-2 mt-1 text-caption text-slate-500 font-medium">
                      <span>{d.standards.length} ta standart</span>
                      {isFinished && <span className="text-emerald-700 font-semibold">• yakunlangan</span>}
                      {dStats && (
                        <span className="font-mono text-slate-500">
                          • {dStats.answeredCount}/{dStats.totalCriteria}
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className={`sidebar-badge w-7 h-7 rounded-full text-xs flex items-center justify-center shrink-0 transition-all ${
                      isActive && isUnlocked
                        ? 'bg-teal-600 text-white font-bold shadow-xs scale-105'
                        : isCompleted
                        ? 'bg-emerald-100 text-emerald-800 font-bold'
                        : 'bg-slate-100 text-slate-600 font-semibold'
                    }`}
                  >
                    {isFinished || isCompleted ? '✓' : isUnlocked ? d.id : <Lock className="w-3 h-3" />}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* RIGHT MAIN CONTENT: FEED WITH 100% FULL-WIDTH STICKY HEADERS */}
        <section
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto w-full bg-slate-100/70 pb-36"
        >
          {domainFlow.visibleDomains.map((domain) => {
            const dStats = domainStatsMap[domain.id];
            const isStuck = Boolean(stuckDomainIds[domain.id]);
            const isCompleted = dStats && dStats.answeredCount === dStats.totalCriteria && dStats.totalCriteria > 0;

            return (
              <div
                key={domain.id}
                id={`domain-section-${domain.id}`}
                className="relative w-full pb-8"
              >
                {/* ========================================================================= */}
                {/* 100% FULL-WIDTH STICKY HEADER FLUSH AGAINST NAVBAR (TOP-0)                */}
                {/* Studio-Grade Single-Element Morphing: ZERO UNMOUNTING, ZERO FLICKER       */}
                {/* ========================================================================= */}
                <div
                  className={`sticky top-0 z-30 w-full transition-all duration-300 ease-out ${
                    isStuck
                      ? 'bg-white/95 backdrop-blur-md border-b-2 border-teal-600 shadow-sm py-2 px-4 sm:px-6'
                      : 'bg-transparent border-b-0 py-3 px-4 sm:px-6'
                  }`}
                >
                  <div
                    className={`mx-auto transition-all duration-300 ease-out ${
                      isStuck
                        ? 'max-w-3xl bg-transparent border-0 rounded-none p-0 shadow-none'
                        : 'max-w-3xl bg-teal-50/95 border border-teal-200 rounded-xl p-3.5 shadow-sm'
                    }`}
                  >
                    {/* PRIMARY ROW: PERMANENTLY MOUNTED, NEVER UNMOUNTED */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-bold transition-all duration-200 shrink-0 ${
                            isStuck
                              ? 'px-2 py-0.5 rounded text-caption bg-teal-700 text-white'
                              : 'px-2 py-0.5 rounded text-caption bg-teal-700 text-white shadow-2xs'
                          }`}
                        >
                          {domain.id}-BO&apos;LIM
                        </span>
                        <h2
                          className={`font-bold text-slate-900 transition-all duration-200 truncate ${
                            isStuck ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
                          }`}
                        >
                          {domain.name}
                          {isCompleted && isStuck && (
                            <span className="text-caption font-normal text-emerald-700 ml-1.5">
                              (Tugadi)
                            </span>
                          )}
                        </h2>
                        <span className="text-xs text-slate-500 hidden sm:inline shrink-0 font-medium">
                          ({domain.standards.length} ta standart • {dStats?.totalCriteria || 0} ta mezon)
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono font-bold transition-all duration-200 ${
                            isStuck
                              ? 'text-xs text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200'
                              : 'text-xs text-teal-800 bg-white px-2.5 py-0.5 rounded border border-teal-200 shadow-2xs'
                          }`}
                        >
                          {isCompleted
                            ? `✓ ${dStats?.totalCriteria} / ${dStats?.totalCriteria}`
                            : `${dStats?.answeredCount || 0} / ${dStats?.totalCriteria || 0}`}
                        </span>

                        {/* MINI PROGRESS BAR: EXPANDS IN STICKY MODE */}
                        <div
                          className={`transition-all duration-300 ease-out overflow-hidden flex items-center ${
                            isStuck ? 'w-16 sm:w-20 opacity-100 max-w-[80px]' : 'w-0 opacity-0 max-w-0 pointer-events-none'
                          }`}
                        >
                          <div className="w-16 sm:w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isCompleted ? 'bg-emerald-500' : 'bg-teal-600'
                              }`}
                              style={{ width: `${dStats?.completionPct || 0}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SECONDARY ROW: SMOOTHLY COLLAPSES WITHOUT JITTER IN STICKY MODE */}
                    <div
                      className={`transition-all duration-300 ease-out overflow-hidden ${
                        isStuck
                          ? 'max-h-0 opacity-0 mt-0 pt-0 border-transparent pointer-events-none'
                          : 'max-h-16 opacity-100 mt-2.5 pt-2 border-t border-teal-100'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-2.5 font-medium">
                          <span>To&apos;ldirildi: <strong className="text-slate-800 font-bold">{dStats?.answeredCount || 0} ta</strong></span>
                          <span className="text-slate-300">•</span>
                          <span>Qoldi: <strong className="text-slate-800 font-bold">{(dStats?.totalCriteria || 0) - (dStats?.answeredCount || 0)} ta</strong> mezon</span>
                        </div>

                        <div className="flex items-center gap-2 font-bold text-teal-800">
                          <span className="font-mono">{dStats?.completionPct || 0}%</span>
                          <div className="w-16 sm:w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isCompleted ? 'bg-emerald-500' : 'bg-teal-600'
                              }`}
                              style={{ width: `${dStats?.completionPct || 0}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* STANDARDS & CRITERIA CARDS (CENTERED INSIDE max-w-3xl)                     */}
                {/* ========================================================================= */}
                <div className="max-w-3xl mx-auto px-4 sm:px-6 space-y-3.5 pt-1">
                  {domain.id < currentSection && (
                    <div className="flex items-start gap-2.5 p-3 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600">
                      <Lock className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
                      <span>
                        Bu bo&apos;lim yakunlangan — javoblarni faqat ko&apos;rish mumkin, o&apos;zgartirib bo&apos;lmaydi.
                      </span>
                    </div>
                  )}
                  {domain.standards.map((st) => (
                    <div
                      key={st.id}
                      className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-2xs space-y-3.5 hover:border-slate-400/80 transition-colors"
                    >
                      {/* Standard Header */}
                      <div className="border-b border-slate-200/80 pb-2.5">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="font-extrabold text-teal-800 bg-teal-50/80 px-2 py-0.5 rounded border border-teal-200/70">
                            Standart {st.id}
                          </span>
                          <span className="text-caption text-slate-500 italic">
                            {st.applicability}
                          </span>
                        </div>
                        <h3 className="text-[15px] font-semibold text-slate-900 mt-2 leading-snug">
                          {st.title}
                        </h3>
                      </div>

                      {/* Criteria Questions */}
                      <div className="space-y-3">
                        {st.criteria.map((c) => (
                          <div
                            key={c.id}
                            id={`criterion-${c.id}`}
                            className={`p-4 bg-slate-50/90 rounded-xl border text-sm space-y-3 transition-all hover:bg-slate-50 ${
                              highlightUnanswered && domain.id === currentSection && (!c.answer || c.answer === 'UNANSWERED')
                                ? 'border-amber-400 ring-2 ring-amber-300/60'
                                : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-slate-800 leading-relaxed">
                                <strong className="text-slate-900 font-semibold">#{c.number}.</strong> {c.description}
                                {c.is_critical && (
                                  <span className="ml-1.5 inline-flex items-center gap-1 text-2xs text-rose-700 font-extrabold bg-rose-50 px-2 py-0.5 rounded border border-rose-300 uppercase tracking-wider">
                                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                                    <span>Kritik xavfsizlik talabi</span>
                                  </span>
                                )}
                              </span>
                            </div>

                            {/* 4 RESPONSE BUTTONS — faqat joriy bo'limda faol */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                              {ANSWER_OPTIONS.map(({ value, label, Icon, selected, idle }) => {
                                const isSelected = c.answer === value;
                                const editable = domain.id === currentSection;
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => handleSaveAnswer(c.id, value)}
                                    disabled={!editable}
                                    aria-pressed={isSelected}
                                    title={value === 'NA' ? 'Tadbiq etilmaydi' : undefined}
                                    className={`py-2 px-3 rounded-lg border font-semibold text-xs transition-all flex items-center justify-center gap-1.5 ${
                                      isSelected ? selected : editable ? idle : 'bg-white text-slate-400 border-slate-200'
                                    } ${editable ? 'cursor-pointer' : 'cursor-not-allowed'} ${!editable && !isSelected ? 'opacity-60' : ''}`}
                                  >
                                    <Icon className="w-3.5 h-3.5" />
                                    <span>{label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* SECTION GATE: joriy bo'limni yakunlab keyingisiga o'tish yoki (oxirgi bo'limda) arizani topshirish */}
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            {domainFlow.isLastSection ? (
              <button
                type="button"
                onClick={handleSubmitAssessment}
                disabled={isSubmitting}
                className="w-full py-3.5 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800 text-white font-bold text-sm rounded-xl shadow-lg transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isSubmitting ? 'Topshirilmoqda...' : 'Arizani Topshirish'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : domainFlow.nextDomain ? (
              <div className="p-5 bg-white border border-teal-200 rounded-2xl shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-700">
                  <div className="font-bold text-slate-900 text-sm">{currentSection}-bo&apos;limni yakunlash</div>
                  <div className="mt-0.5">
                    {domainFlow.unansweredInCurrent > 0
                      ? `${domainFlow.unansweredInCurrent} ta mezonga hali javob berilmagan.`
                      : "Barcha mezonlarga javob berildi."}{' '}
                    Keyingi — {domainFlow.nextDomain.id}-bo&apos;lim.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFlowModal('advance')}
                  className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                >
                  <span>Keyingi bo&apos;limga o&apos;tish</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* BO'LIMNI YAKUNLASH / ARIZANI TOPSHIRISH OYNASI (brauzerning confirm() o'rniga) */}
      {flowModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => !isAdvancing && !isSubmitting && setFlowModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="flow-modal-title"
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                {flowModal === 'advance' ? <Lock className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
              </span>
              <h2 id="flow-modal-title" className="font-bold text-slate-900 text-base">
                {flowModal === 'advance' ? `${currentSection}-bo'limni yakunlash` : 'Arizani topshirish'}
              </h2>
            </div>

            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              {flowModal === 'advance' ? (
                <>
                  {domainFlow.nextDomain?.id}-bo&apos;limga o&apos;tganingizdan so&apos;ng{' '}
                  <strong className="text-slate-900">
                    {currentSection}-bo&apos;limdagi javoblarni o&apos;zgartira olmaysiz
                  </strong>{' '}
                  — ularni faqat ko&apos;rish mumkin bo&apos;ladi.
                </>
              ) : (
                <>
                  Ariza komissiyaga yuboriladi.{' '}
                  <strong className="text-slate-900">Topshirilgandan keyin hech bir javobni o&apos;zgartirib bo&apos;lmaydi.</strong>
                </>
              )}
            </p>

            {domainFlow.unansweredInCurrent > 0 && (
              <div className="mt-4 p-3 rounded-xl border border-amber-300 bg-amber-50 text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p>
                    <strong>{domainFlow.unansweredInCurrent} ta mezonga javob berilmagan.</strong> Ular avtomatik ravishda{' '}
                    <strong>«Yo&apos;q»</strong> deb belgilanadi.
                  </p>
                  <button
                    type="button"
                    onClick={handleShowUnanswered}
                    disabled={isAdvancing || isSubmitting}
                    className="mt-1.5 font-bold text-amber-800 underline underline-offset-2 hover:text-amber-950 cursor-pointer"
                  >
                    Javobsiz mezonlarni ko&apos;rsatish
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={() => setFlowModal(null)}
                disabled={isAdvancing || isSubmitting}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 transition cursor-pointer"
              >
                Orqaga
              </button>
              <button
                type="button"
                autoFocus
                onClick={flowModal === 'advance' ? handleAdvanceSection : handleConfirmSubmit}
                disabled={isAdvancing || isSubmitting}
                className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition cursor-pointer disabled:opacity-60"
              >
                {flowModal === 'advance'
                  ? isAdvancing
                    ? "O'tilmoqda..."
                    : `Tasdiqlash va ${domainFlow.nextDomain?.id}-bo'limga o'tish`
                  : isSubmitting
                  ? 'Topshirilmoqda...'
                  : 'Tasdiqlash va topshirish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
