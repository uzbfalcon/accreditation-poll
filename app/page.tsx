'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  ChevronLeft,
  ChevronRight,
  Layers,
  LayoutDashboard,
  CheckCircle2,
  Printer,
  RotateCcw,
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
}

export default function ChecklistPortalPage() {
  const router = useRouter();

  const [submissionSuccess, setSubmissionSuccess] = useState<SubmissionConfirmation | null>(null);

  // Onboarding Form State
  const [inn, setInn] = useState('304907014');
  const [orgName, setOrgName] = useState('"AKFA MEDLINE" mas\'uliyati cheklangan jamiyati');
  const [cadastre, setCadastre] = useState('10:01:04:02:01:0045');
  const [region, setRegion] = useState('Toshkent shahri');
  const [level, setLevel] = useState('VILOYAT');
  const [fio, setFio] = useState('Alimov Jamshid Baxtiyorovich');
  const [phone, setPhone] = useState('+998 71 200-11-22');
  const [innFound, setInnFound] = useState(true);
  const [isSearchingInn, setIsSearchingInn] = useState(false);
  const [innSource, setInnSource] = useState<string>('orginfo.uz');
  const [isInitializing, setIsInitializing] = useState(false);
  const [resetDraft, setResetDraft] = useState(false);

  // Services State
  const [services, setServices] = useState({
    has_emergency_blue_code: true,
    has_surgery: true,
    has_laboratory: true,
    has_endoscopy: true,
    has_mri: false,
    has_sterilization_dept: true,
  });

  // Checklist View State
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [activeDomainId, setActiveDomainId] = useState(1);
  const [stuckDomainIds, setStuckDomainIds] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced INN lookup from orginfo.uz / ihamkor.uz
  useEffect(() => {
    if (inn.length === 9) {
      setIsSearchingInn(true);
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/organizations/lookup-inn/${inn}`);
          const data = await res.json();
          if (data.found) {
            setOrgName(data.name);
            if (data.region) setRegion(data.region);
            setInnFound(true);
            setInnSource(data.source || 'orginfo.uz');
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

  // Start Checklist
  const handleStartChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInitializing(true);

    try {
      const payload = {
        inn,
        name: orgName,
        cadastre_number: cadastre,
        region,
        level,
        submitter_fio: fio,
        submitter_phone: phone,
        services,
        reset: resetDraft,
      };

      const res = await fetch('/api/v1/audit-sessions/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      setActiveSessionId(data.session_id);
      setScore(data.score);

      // Load full checklist
      const checkRes = await fetch(`/api/v1/audit-sessions/${data.session_id}/checklist`);
      const checkData = await checkRes.json();
      setDomains(checkData.domains);
      setScore(checkData.score);
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

  // Final submission
  const handleSubmitAssessment = async () => {
    if (!activeSessionId) return;
    if (confirm("Haqiqatdan ham akkreditatsiya chek-listini yakunlab, komissiyaga topshirmoqchimisiz?")) {
      setIsSubmitting(true);
      try {
        await fetch(`/api/v1/audit-sessions/${activeSessionId}/submit`, {
          method: 'POST',
        });

        const now = new Date();
        const formattedDate = new Intl.DateTimeFormat('uz-UZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(now);

        setSubmissionSuccess({
          sessionId: activeSessionId,
          submittedAt: formattedDate,
          orgName: orgName || 'Tibbiyot muassasasi',
          inn: inn || '—',
          cadastre: cadastre || '—',
          region: region || "O'zbekiston Respublikasi",
          fio: fio || '—',
          phone: phone || '—',
          totalCriteria: checklistProgress.total || 273,
          completedCriteria: checklistProgress.answered || 273,
        });
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

  // --------------------------------------------------------------------------
  // VIEW: SUBMISSION SUCCESS / CONFIRMATION RECEIPT PAGE
  // --------------------------------------------------------------------------
  if (submissionSuccess) {
    return (
      <div className="min-h-full flex flex-col bg-slate-50 print:bg-white text-slate-900">
        {/* Navbar (Hidden in print) */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs no-print">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3.5 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="CLAMO"
                className="h-8 sm:h-9 w-auto object-contain"
              />
              <span className="bg-teal-50 text-teal-700 text-[10px] font-bold px-2 py-0.5 rounded border border-teal-200 uppercase tracking-wider">
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

          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 text-center tracking-tight mb-2">
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
                  <img src="/logo.png" alt="CLAMO" className="h-10 w-auto object-contain" />
                  <div>
                    <h2 className="text-base font-black text-slate-900 tracking-tight">
                      CLAMO TIBBIYOT AKKREDITATSIYASI
                    </h2>
                    <p className="text-xs text-slate-500">
                      Milliy sifat va xavfsizlik standartlari milliy tizimi
                    </p>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
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
                  <div className="font-mono font-black text-lg text-teal-900 tracking-tight">
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
                    {submissionSuccess.completedCriteria} / {submissionSuccess.totalCriteria} ta mezon (100%)
                  </div>
                </div>
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

              {/* Action Buttons (Hidden on print) */}
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition flex items-center gap-2 shadow-2xs hover:shadow-xs cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  <span>Kvitansiyani Chop Etish / PDF</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSubmissionSuccess(null);
                      setActiveSessionId(null);
                      setDomains([]);
                    }}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Yangi So&apos;rovnoma Boshlash</span>
                  </button>

                  <Link
                    href="/backoffice"
                    className="px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-md transition flex items-center gap-2 cursor-pointer"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Backoffice Monitoringi &rarr;</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
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
                src="/logo.png"
                alt="CLAMO"
                className="h-8 sm:h-9 w-auto object-contain group-hover:scale-[1.02] transition-transform"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-teal-50 text-teal-700 text-[10px] font-bold px-2 py-0.5 rounded border border-teal-200 uppercase tracking-wider">
                    Klinika Portali
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 hidden sm:block">
                  75 ta standart va 273 ta mezon asosidagi milliy audit chek-listi
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
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Tashkilot INN&apos;i *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={9}
                      value={inn}
                      onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))}
                      placeholder="Masalan: 304907014"
                      className="w-full pl-3 pr-32 py-2.5 bg-white border border-slate-300 rounded-xl font-mono text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      required
                    />
                    {isSearchingInn ? (
                      <span className="absolute right-2 top-2 text-[10px] bg-cyan-50 text-cyan-800 font-bold px-2 py-1 rounded border border-cyan-200 flex items-center gap-1.5 shadow-2xs">
                        <span className="w-2.5 h-2.5 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin"></span>
                        Qidirilmoqda...
                      </span>
                    ) : innFound ? (
                      <span className="absolute right-2 top-2 text-[10px] bg-emerald-50 text-emerald-800 font-bold px-2 py-1 rounded border border-emerald-200 flex items-center gap-1 shadow-2xs">
                        <Check className="w-3 h-3 text-emerald-600" />
                        {innSource === 'orginfo.uz' ? 'orginfo.uz' : (innSource === 'ihamkor.uz' ? 'ihamkor.uz' : 'Topildi')}
                      </span>
                    ) : inn.length === 9 ? (
                      <span className="absolute right-2 top-2 text-[10px] bg-amber-50 text-amber-800 font-bold px-2 py-1 rounded border border-amber-200 flex items-center gap-1 shadow-2xs">
                        Topilmadi
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>9 xonali yuridik shaxs INN kodi</span>
                    <span className="text-[10px] text-teal-700 font-medium">⚡️ orginfo.uz va ihamkor.uz orqali</span>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Tashkilot nomi *
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={orgName}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs text-slate-800 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* STEP 2: KADASTR, DARAJA, HUDUD */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Kadastr raqami *
                  </label>
                  <input
                    type="text"
                    value={cadastre}
                    onChange={(e) => setCadastre(e.target.value)}
                    placeholder="XX:XX:XX:XX:XX:XXXX"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Viloyat / Hudud *
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={region}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-xs text-slate-800 cursor-not-allowed select-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Muassasa darajasi *
                  </label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white"
                  >
                    <option value="VILOYAT">Viloyat darajasi</option>
                    <option value="RESPUBLIKA">Respublika darajasi</option>
                    <option value="TUMAN">Tuman darajasi</option>
                  </select>
                </div>
              </div>

              {/* STEP 3: FIO & TELEFON */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    F.I.O (to&apos;ldiruvchi mas&apos;ul shaxs) *
                  </label>
                  <input
                    type="text"
                    value={fio}
                    onChange={(e) => setFio(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Telefon raqam (tashkilotniki) *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-teal-500"
                    required
                  />
                </div>
              </div>

              {/* STEP 4: SERVICES APPLICABILITY CHECKBOXES */}
              <div className="pt-4 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Amalda ko&apos;rsatilayotgan tibbiy xizmatlar (ТЭ qoidalariga binoan):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-700">
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_emergency_blue_code}
                      onChange={(e) => setServices({ ...services, has_emergency_blue_code: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>Шошилинч / «Кўк код»</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_surgery}
                      onChange={(e) => setServices({ ...services, has_surgery: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>Жарроҳлик бўлими</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_laboratory}
                      onChange={(e) => setServices({ ...services, has_laboratory: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>Лаборатория</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_endoscopy}
                      onChange={(e) => setServices({ ...services, has_endoscopy: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>Эндоскопия (Гастро/Колоно)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_mri}
                      onChange={(e) => setServices({ ...services, has_mri: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>МРТ хизмати</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={services.has_sterilization_dept}
                      onChange={(e) => setServices({ ...services, has_sterilization_dept: e.target.checked })}
                      className="w-4 h-4 text-teal-600 rounded"
                    />
                    <span>Стерилизация бўлинмаси</span>
                  </label>
                </div>
              </div>

              {/* Reset Draft Option */}
              <div className="pt-1">
                <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 cursor-pointer hover:bg-slate-100 transition">
                  <input
                    type="checkbox"
                    checked={resetDraft}
                    onChange={(e) => setResetDraft(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded"
                  />
                  <div>
                    <span className="font-bold text-slate-800">🧹 Yangi so&apos;rovnoma boshlash (qoralamani tozalash)</span>
                    <p className="text-[11px] text-slate-500">
                      Ushbu INN bo&apos;yicha oldin kiritilgan javoblarni tozalab, yangidan toza chek-list boshlash
                    </p>
                  </div>
                </label>
              </div>

              <button
                type="submit"
                disabled={isInitializing}
                className="w-full py-3.5 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800 text-white font-bold text-sm rounded-xl shadow-lg transition cursor-pointer flex items-center justify-center gap-2 hover:shadow-xl"
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
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CLAMO" className="h-7 w-auto object-contain" />
          </Link>

          <span className="text-slate-300 hidden sm:inline">|</span>

          {/* Clinic & Session metadata */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-slate-800 truncate max-w-[160px] sm:max-w-xs md:max-w-sm">
              {orgName}
            </span>
            <span className="text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 shrink-0">
              № {activeSessionId}
            </span>
          </div>
        </div>

        {/* Center: Checklist Completion Progress (No Score / Readiness shown to clinic) */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 justify-end">
              <span>To&apos;ldirilgan mezonlar:</span>
              <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                {checklistProgress.answered} / {checklistProgress.total}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 font-medium">
              {checklistProgress.pct}% savolga javob berildi
            </div>
          </div>
          <div className="w-24 lg:w-32 bg-slate-200 h-2 rounded-full overflow-hidden shadow-inner">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${checklistProgress.pct}%` }}
            ></div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-2xs">
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
            disabled={isSubmitting}
            className="px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1.5"
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
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-teal-600" />
              <span>7 та Асосий Бўлим Менюси</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono font-medium">
              {domains.length} та бўлим
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {domains.map((d) => {
              const isActive = activeDomainId === d.id;
              const dStats = domainStatsMap[d.id];
              const isCompleted = dStats && dStats.answeredCount === dStats.totalCriteria && dStats.totalCriteria > 0;

              return (
                <div
                  key={d.id}
                  onClick={() => scrollToDomain(d.id)}
                  className={`sidebar-nav-item p-3.5 cursor-pointer flex items-center justify-between gap-2 ${
                    isActive ? 'active-nav-item shadow-2xs' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-xs line-clamp-2 leading-snug font-medium">
                      {d.name}
                    </span>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-normal">
                      <span>{d.standards.length} та стандарт</span>
                      {dStats && (
                        <span className="font-mono text-[10px] text-slate-400">
                          • {dStats.answeredCount}/{dStats.totalCriteria}
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className={`sidebar-badge w-6 h-6 rounded-full text-xs flex items-center justify-center shrink-0 transition-all ${
                      isActive
                        ? 'bg-teal-600 text-white font-bold shadow-xs scale-105'
                        : isCompleted
                        ? 'bg-emerald-100 text-emerald-800 font-bold'
                        : 'bg-slate-100 text-slate-600 font-semibold'
                    }`}
                  >
                    {isCompleted ? '✓' : d.id}
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
          {domains.map((domain) => {
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
                              ? 'px-2 py-0.5 rounded text-[11px] bg-teal-700 text-white'
                              : 'px-2 py-0.5 rounded text-[11px] bg-teal-700 text-white shadow-2xs'
                          }`}
                        >
                          {domain.id}-БОБ
                        </span>
                        <h2
                          className={`font-bold text-slate-900 transition-all duration-200 truncate ${
                            isStuck ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
                          }`}
                        >
                          {domain.name}
                          {isCompleted && isStuck && (
                            <span className="text-[11px] font-normal text-emerald-700 ml-1.5">
                              (Tugadi)
                            </span>
                          )}
                        </h2>
                        <span className="text-xs text-slate-500 hidden sm:inline shrink-0 font-medium">
                          ({domain.standards.length} та стандарт • {dStats?.totalCriteria || 0} та мезон)
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
                  {domain.standards.map((st) => (
                    <div
                      key={st.id}
                      className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-2xs space-y-3.5 hover:border-slate-400/80 transition-colors"
                    >
                      {/* Standard Header */}
                      <div className="border-b border-slate-200/80 pb-2.5">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="font-extrabold text-teal-800 bg-teal-50/80 px-2 py-0.5 rounded border border-teal-200/70">
                            Стандарт {st.id}
                          </span>
                          <span className="text-[11px] text-slate-500 italic">
                            {st.applicability}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 mt-1.5 leading-snug">
                          {st.title}
                        </h3>
                      </div>

                      {/* Criteria Questions */}
                      <div className="space-y-3">
                        {st.criteria.map((c) => (
                          <div
                            key={c.id}
                            className="p-3.5 bg-slate-50/90 rounded-xl border border-slate-200 text-xs space-y-2.5 transition-all hover:bg-slate-50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-slate-800 leading-relaxed font-normal">
                                <strong className="text-slate-900 font-bold">#{c.number}.</strong> {c.description}
                                {c.is_critical && (
                                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-rose-700 font-extrabold bg-rose-50 px-2 py-0.5 rounded border border-rose-300 uppercase tracking-wider">
                                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                                    <span>Критик хавфсизлик талаби</span>
                                  </span>
                                )}
                              </span>
                            </div>

                            {/* 4 RESPONSE BUTTONS WITH EXACT TACTILE DESIGN */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleSaveAnswer(c.id, 'YES')}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                  c.answer === 'YES'
                                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs ring-2 ring-emerald-600/30'
                                    : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-600 hover:bg-emerald-50/30'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Бор</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSaveAnswer(c.id, 'PARTIAL')}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                  c.answer === 'PARTIAL'
                                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs ring-2 ring-amber-500/30'
                                    : 'bg-white text-slate-700 border-slate-300 hover:border-amber-500 hover:bg-amber-50/30'
                                }`}
                              >
                                <Award className="w-3.5 h-3.5" />
                                <span>Қисман</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSaveAnswer(c.id, 'NO')}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                  c.answer === 'NO'
                                    ? 'bg-rose-700 text-white border-rose-700 shadow-xs ring-2 ring-rose-600/30'
                                    : 'bg-white text-slate-700 border-slate-300 hover:border-rose-600 hover:bg-rose-50/30'
                                }`}
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Йўқ</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSaveAnswer(c.id, 'NA')}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                  c.answer === 'NA'
                                    ? 'bg-slate-700 text-white border-slate-700 shadow-xs ring-2 ring-slate-600/30'
                                    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100 hover:text-slate-700'
                                }`}
                                title="Тааллуқли эмас"
                              >
                                <Minus className="w-3.5 h-3.5" />
                                <span>— Эмас</span>
                              </button>
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
        </section>
      </div>
    </div>
  );
}
