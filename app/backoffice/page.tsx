'use client';

import React, { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { formatTashkentDateTime } from '@/lib/format';
import {
  Building2,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Printer,
  X,
  FileSpreadsheet,
  Search,
  Filter,
  Clock,
} from 'lucide-react';

interface SummaryData {
  total_clinics: number;
  avg_score: number;
  ready_clinics: number;
  risk_clinics: number;
  passing_threshold: number;
}

interface RegionItem {
  name: string;
  count: number;
  avgScore: number;
  ready: number;
}

interface DomainItem {
  id: number;
  name: string;
  score: number;
  is_weakest: boolean;
}

interface ClinicItem {
  session_id: string;
  org_id: string;
  name: string;
  inn: string;
  region: string;
  district: string;
  level: string;
  profile: string;
  capacity: string;
  responsible: string;
  phone: string;
  criteriaDone: number;
  totalCriteria: number;
  score: number;
  status: 'ready' | 'partial' | 'risk';
  date: string | null;
  submitted: boolean;
}

interface PassportData {
  clinic: {
    id: string;
    inn: string;
    name: string;
    cadastre_number: string;
    region: string;
    district: string;
    address: string;
    level: string;
    profile: string;
    bed_capacity: number;
    daily_visits: number;
    submitter_fio: string;
    submitter_phone: string;
    status: string;
    submitted_at: string;
  };
  score: {
    total_criteria: number;
    applicable_criteria: number;
    yes_count: number;
    partial_count: number;
    no_count: number;
    na_count: number;
    total_score: number;
    readiness_category: string;
    has_critical_stop_factors: boolean;
    critical_violations: Array<{
      standard_id: number;
      criterion_number: number;
      message: string;
    }>;
    domains: Array<{
      id: number;
      name: string;
      score: number;
    }>;
  };
}

const DISTRICT_MAPPING: Record<string, string[]> = {
  'Toshkent shahri': ['Barchasi', 'Yunusobod', 'Olmazor', 'Mirobod', 'Chilonzor', "Mirzo Ulug'bek", 'Shayxontohur', 'Yakkasaroy'],
  'Toshkent viloyati': ['Barchasi', 'Chirchiq sh.', 'Angren sh.', 'Qibray', 'Zangiota', 'Olmaliq sh.'],
  'Samarqand viloyati': ['Barchasi', 'Samarqand sh.', "Kattaqo'rg'on sh.", "Pastdarg'om", 'Urgut', 'Jomboy'],
  "Farg'ona viloyati": ['Barchasi', "Farg'ona sh.", "Qo'qon sh.", "Marg'ilon sh.", 'Quva'],
  'Andijon viloyati': ['Barchasi', 'Andijon sh.', 'Asaka', 'Shahrixon', "Xo'jaobod"],
  'Buxoro viloyati': ['Barchasi', 'Buxoro sh.', "G'ijduvon", 'Kogon sh.'],
};

// Uzun tashkilot nomi «...» bilan qisqaradi; hover/focus'da to'liq nom va INN box ichida chiqadi.
// Tooltip position: fixed — jadval konteynerining overflow'i uni kesmaydi; pastda joy bo'lmasa yuqorida ochiladi.
function TruncatedOrgName({ name, inn }: { name: string; inn: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const openUp = window.innerHeight - r.bottom < 110;
    setPos(openUp ? { left: r.left, bottom: window.innerHeight - r.top + 6 } : { left: r.left, top: r.bottom + 6 });
  };
  const hide = () => setPos(null);

  // Fixed tooltip skroll paytida qatordan ajralib qolmasligi uchun yashiriladi
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-label={`${name}, INN ${inn}`}
      className="max-w-[260px] xl:max-w-[340px] outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded"
    >
      <strong className="text-slate-900 block font-semibold truncate">{name}</strong>
      <span className="block text-[11px] font-mono text-slate-400 truncate">INN: {inn}</span>
      {pos && (
        <div
          role="tooltip"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
          className="pointer-events-none fixed z-50 w-max max-w-[420px] rounded-lg bg-slate-900 text-white px-3 py-2 shadow-lg text-xs leading-snug whitespace-normal"
        >
          <span className="block font-semibold">{name}</span>
          <span className="block font-mono text-[11px] text-slate-300 mt-0.5">INN: {inn}</span>
        </div>
      )}
    </div>
  );
}

// Sessiya tugagan bo'lsa (401) — login sahifasiga qaytariladi
async function backofficeFetch(url: string): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.href = `/backoffice/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Avtorizatsiya talab qilinadi');
  }
  return res;
}

export default function BackofficeDashboardPage() {
  // Data states
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [clinics, setClinics] = useState<ClinicItem[]>([]);
  const [regionSort, setRegionSort] = useState('score_desc');

  // Filter states
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [selectedDistrict, setSelectedDistrict] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Initial load
  useEffect(() => {
    fetchSummary();
    fetchDomains();
  }, []);

  useEffect(() => {
    fetchRegions(regionSort);
  }, [regionSort]);

  useEffect(() => {
    fetchClinics();
  }, [selectedRegion, selectedDistrict, selectedLevel, selectedStatus, searchQuery]);

  const fetchSummary = async () => {
    try {
      const res = await backofficeFetch('/api/v1/backoffice/dashboard/summary');
      const data = await res.json();
      setSummary(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRegions = async (sort: string) => {
    try {
      const res = await backofficeFetch(`/api/v1/backoffice/dashboard/regions-breakdown?sort_by=${sort}`);
      const data = await res.json();
      setRegions(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDomains = async () => {
    try {
      const res = await backofficeFetch('/api/v1/backoffice/dashboard/domains-breakdown');
      const data = await res.json();
      setDomains(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClinics = async () => {
    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        district: selectedDistrict,
        level: selectedLevel,
        status: selectedStatus,
        search: searchQuery,
      });
      const res = await backofficeFetch(`/api/v1/backoffice/clinics?${params}`);
      const data = await res.json();
      setClinics(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRegionChange = (newRegion: string) => {
    setSelectedRegion(newRegion);
    setSelectedDistrict('all');
  };

  const handleOpenPassport = async (sessionId: string) => {
    try {
      const res = await backofficeFetch(`/api/v1/backoffice/clinics/${sessionId}/audit-passport`);
      const data = await res.json();
      setPassportData(data);
      setIsModalOpen(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const availableDistricts =
    selectedRegion !== 'all' && DISTRICT_MAPPING[selectedRegion]
      ? DISTRICT_MAPPING[selectedRegion]
      : [];

  return (
    <div className="min-h-full flex flex-col bg-slate-50">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* 4 TOP HIGH VALUE KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              Topshirgan Klinikalar
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {summary ? summary.total_clinics : '...'}
              </span>
              <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                Faol monitoring
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Respublika bo&apos;yicha jami arizalar</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              O&apos;rtacha Milliy Ball
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-blue-600 font-mono tracking-tight">
                {summary ? `${summary.avg_score}%` : '...%'}
              </span>
              <span className="text-xs text-slate-400">O&apos;tish: 75.0%</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">275 ta mezon bo&apos;yicha tayyorgarlik</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              To&apos;liq Tayyor (&ge;80%)
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-600 tracking-tight">
                {summary ? summary.ready_clinics : '...'}
              </span>
              <span className="text-xs text-emerald-700 font-semibold">
                {summary && summary.total_clinics > 0
                  ? `(${Math.round((summary.ready_clinics / summary.total_clinics) * 100)}%)`
                  : ''}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Davlat akkreditatsiyasiga tavsiya etilgan</p>
          </div>

          <div className="bg-white border border-rose-200 bg-rose-50/20 rounded-2xl p-5 shadow-2xs">
            <span className="text-xs font-bold text-rose-600 uppercase tracking-wider block">
              Xavfli Hudud (&lt;55%)
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-rose-600 tracking-tight">
                {summary ? summary.risk_clinics : '...'}
              </span>
              <span className="text-xs text-rose-700 font-semibold">Tuzatish choralari zarur</span>
            </div>
            <p className="mt-2 text-xs text-rose-800/80">Konsalting va yordamga muhtoj</p>
          </div>
        </div>

        {/* MIDDLE: REGIONS AND 7 DOMAINS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* REGIONS BARS (7 COLS) */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Viloyatlar Bo&apos;yicha Natijalar va Ballar
                </h2>
                <p className="text-xs text-slate-500">
                  Topshirgan klinikalar soni va o&apos;rtacha tayyorgarlik darajasi
                </p>
              </div>
              <select
                value={regionSort}
                onChange={(e) => setRegionSort(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 font-medium"
              >
                <option value="score_desc">Ball yuqoridan pastga</option>
                <option value="count_desc">Klinikalar soni bo&apos;yicha</option>
                <option value="name_asc">Viloyat nomi bo&apos;yicha</option>
              </select>
            </div>

            <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[350px] pr-2">
              {regions.map((reg) => {
                const barColor =
                  reg.avgScore >= 75
                    ? 'bg-emerald-500'
                    : reg.avgScore >= 55
                    ? 'bg-amber-500'
                    : 'bg-rose-500';
                return (
                  <div key={reg.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">
                        {reg.name} ({reg.count} ta klinika)
                      </span>
                      <span className="font-bold font-mono text-slate-900">{reg.avgScore}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={`${barColor} h-full rounded-full`}
                        style={{ width: `${reg.avgScore}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 7 DOMAINS BREAKDOWN (5 COLS) */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs">
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-900">
                7 ta Asosiy Bo&apos;lim Bo&apos;yicha Milliy Natijalar
              </h2>
              <p className="text-xs text-slate-500">275 ta mezonning sohalar kesimidagi bajarilishi</p>
            </div>

            <div className="space-y-3">
              {domains.map((d) => {
                const barColor = d.is_weakest
                  ? 'bg-rose-500'
                  : d.score >= 75
                  ? 'bg-emerald-500'
                  : 'bg-teal-500';
                return (
                  <div
                    key={d.id}
                    className={`p-2.5 bg-slate-50 border ${
                      d.is_weakest ? 'border-rose-200 bg-rose-50/30' : 'border-slate-100'
                    } rounded-xl text-xs`}
                  >
                    <div className="flex justify-between font-semibold text-slate-800 mb-1">
                      <span className="truncate">
                        {d.id}. {d.name} {d.is_weakest ? '⚠️' : ''}
                      </span>
                      <span
                        className={`font-mono ${
                          d.is_weakest ? 'text-rose-600 font-bold' : ''
                        }`}
                      >
                        {d.score}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`${barColor} h-full rounded-full`}
                        style={{ width: `${d.score}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CLINICS REGISTRY TABLE WITH CASCADE FILTERS */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Akkreditatsiyaga Topshirgan Klinikalar Reyestri
              </h2>
              <p className="text-xs text-slate-500">
                Viloyat, tuman, muassasa darajasi va natijalar bo&apos;yicha filtrlash
              </p>
            </div>
          </div>

          {/* CASCADE FILTERS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Viloyat / Hudud</label>
              <select
                value={selectedRegion}
                onChange={(e) => handleRegionChange(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium"
              >
                <option value="all">Barcha viloyatlar</option>
                <option value="Toshkent shahri">Toshkent shahri</option>
                <option value="Toshkent viloyati">Toshkent viloyati</option>
                <option value="Samarqand viloyati">Samarqand viloyati</option>
                <option value="Farg'ona viloyati">Farg&apos;ona viloyati</option>
                <option value="Andijon viloyati">Andijon viloyati</option>
                <option value="Buxoro viloyati">Buxoro viloyati</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Tuman / Shahar</label>
              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium"
              >
                <option value="all">Barcha tumanlar</option>
                {availableDistricts.map(
                  (d) =>
                    d !== 'Barchasi' && (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Daraja</label>
              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium"
              >
                <option value="all">Barchasi</option>
                <option value="RESPUBLIKA">Respublika</option>
                <option value="VILOYAT">Viloyat</option>
                <option value="TUMAN">Tuman</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Holati</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium"
              >
                <option value="all">Barchasi</option>
                <option value="ready">Tayyor (&ge;80%)</option>
                <option value="partial">Qisman tayyor (55–79%)</option>
                <option value="risk">Tayyor emas (&lt;55%)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Qidiruv (Klinika / INN)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nomi, INN, FIO..."
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl mt-4">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Tashkilot nomi va INN</th>
                  <th className="py-3 px-3">Hudud & Tuman</th>
                  <th className="py-3 px-3">Yuborilgan sana</th>
                  <th className="py-3 px-3 text-center">Mezonlar</th>
                  <th className="py-3 px-3 text-center">Tayyorgarlik Bali</th>
                  <th className="py-3 px-3 text-center">Holat</th>
                  <th className="py-3 px-4 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clinics.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      Klinika topilmadi
                    </td>
                  </tr>
                ) : (
                  clinics.map((c) => {
                    const badge =
                      c.status === 'ready' ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold px-2 py-0.5 rounded-full text-[11px]">
                          <CheckCircle2 className="w-3 h-3" />
                          Tayyor
                        </span>
                      ) : c.status === 'partial' ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200 font-semibold px-2 py-0.5 rounded-full text-[11px]">
                          <Clock className="w-3 h-3" />
                          Qisman tayyor
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap bg-rose-50 text-rose-700 border border-rose-200 font-semibold px-2 py-0.5 rounded-full text-[11px]">
                          <AlertTriangle className="w-3 h-3" />
                          Tayyor emas
                        </span>
                      );
                    const submittedAt = c.date ? formatTashkentDateTime(c.date) : null;

                    return (
                      <tr key={c.session_id} className="hover:bg-slate-50 transition border-b border-slate-100">
                        <td className="py-3 px-4">
                          <TruncatedOrgName name={c.name} inn={c.inn} />
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span>{c.region}</span>
                          <span className="block text-[11px] text-slate-400">{c.district}</span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {submittedAt ? (
                            <>
                              <span className="block text-slate-800 font-medium">{submittedAt.date}</span>
                              <span className="block text-[11px] text-slate-400">{submittedAt.time}</span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">Topshirilmagan</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center font-mono">
                          {c.criteriaDone} <span className="text-slate-400">/ {c.totalCriteria}</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <strong
                            className={`font-mono text-xs ${
                              c.score >= 80
                                ? 'text-emerald-600'
                                : c.score >= 55
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            }`}
                          >
                            {c.score}%
                          </strong>
                        </td>
                        <td className="py-3 px-3 text-center">{badge}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleOpenPassport(c.session_id)}
                            className="px-2.5 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-xs transition cursor-pointer whitespace-nowrap"
                          >
                            Pasport & PDF
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL: CLINIC AUDIT PASSPORT & PDF GENERATOR */}
      {isModalOpen && passportData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  Akkreditatsiya Pasporti
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {passportData.clinic.name}
                </h3>
                <p className="text-xs text-slate-400">
                  {passportData.clinic.region}, {passportData.clinic.district} • INN:{' '}
                  {passportData.clinic.inn} • Tayyorgarlik:{' '}
                  {passportData.score.total_score}%
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stop Factors Alert if Any */}
            {passportData.score.critical_violations && passportData.score.critical_violations.length > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl space-y-1">
                <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  🚨 Zero-Tolerance Kritik Stop-Faktorlar aniqlangan:
                </span>
                {passportData.score.critical_violations.map((v, i) => (
                  <p key={i} className="text-[11px] text-rose-700 pl-5">
                    • {v.message}
                  </p>
                ))}
              </div>
            )}

            {/* 7 Domains Breakdown inside modal */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700">
                7 ta Bo&apos;lim Bo&apos;yicha Aniqlangan Natijalar (GAP Tahlili):
              </h4>
              <div className="space-y-2">
                {passportData.score.domains.map((d) => (
                  <div key={d.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                    <div className="flex justify-between font-semibold mb-1">
                      <span>
                        {d.id}. {d.name}
                      </span>
                      <span className="font-mono font-bold">{d.score}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`${
                          d.score >= 75
                            ? 'bg-emerald-500'
                            : d.score >= 50
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        } h-full`}
                        style={{ width: `${d.score}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Yopish
              </button>
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Rasmiy PDF Xulosa (Chop etish)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE PDF CONTAINER FOR BROWSER PRINT */}
      {passportData && (
        <div id="printable-pdf" className="hidden p-10 bg-white text-slate-900 space-y-6">
          <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight">
                O&apos;zbekiston Respublikasi Sog&apos;liqni Saqlash Vazirligi
              </h1>
              <h2 className="text-base font-semibold text-slate-700 mt-1">
                Tibbiyot Tashkilotining Akkreditatsiyaga Tayyorgarlik Pasporti
              </h2>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Sana: {new Date().toLocaleDateString('uz-UZ')}</p>
              <p className="font-mono">№ {passportData.clinic.id}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs border border-slate-300 p-4 rounded-lg">
            <div>
              <p><strong>Tashkilot nomi:</strong> {passportData.clinic.name}</p>
              <p><strong>INN:</strong> {passportData.clinic.inn}</p>
              <p><strong>Kadastr raqami:</strong> {passportData.clinic.cadastre_number}</p>
              <p><strong>Hudud:</strong> {passportData.clinic.region}, {passportData.clinic.district}</p>
            </div>
            <div>
              <p><strong>Daraja:</strong> {passportData.clinic.level}</p>
              <p><strong>Profil:</strong> {passportData.clinic.profile}</p>
              <p><strong>Quvvat:</strong> {passportData.clinic.bed_capacity} o&apos;rin / {passportData.clinic.daily_visits} qatnov</p>
              <p><strong>Mas&apos;ul shaxs:</strong> {passportData.clinic.submitter_fio} ({passportData.clinic.submitter_phone})</p>
            </div>
          </div>

          <div className="border border-slate-300 p-4 rounded-lg space-y-2">
            <h3 className="text-sm font-bold">Audit Xulosasi va Umumiy Tayyorgarlik Bali:</h3>
            <div className="flex items-center gap-6">
              <div className="text-3xl font-extrabold font-mono text-teal-800">
                {passportData.score.total_score}%
              </div>
              <div>
                <p className="text-xs font-bold uppercase">
                  Holati:{' '}
                  {passportData.score.readiness_category === 'READY'
                    ? 'AKKREDITATSIYAGA TAYYOR (TAVSIYA ETILADI)'
                    : passportData.score.readiness_category === 'PARTIALLY_READY'
                    ? "TAYYORGARLIK BOSQICHIDA (QISMAN TAYYOR)"
                    : "TAYYOR EMAS (TUZATISH CHORALARI ZARUR)"}
                </p>
                <p className="text-xs text-slate-600">
                  Amaldagi mezonlar: {passportData.score.applicable_criteria} ta | Bajarilgan: {passportData.score.yes_count} ta | Qisman: {passportData.score.partial_count} ta
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold">7 ta Yo&apos;nalish Bo&apos;yicha Tahlil (GAP Analysis):</h3>
            <table className="w-full text-xs border border-slate-300 border-collapse">
              <thead>
                <tr className="bg-slate-100 font-bold text-left border-b border-slate-300">
                  <th className="p-2 border-r border-slate-300">№</th>
                  <th className="p-2 border-r border-slate-300">Yo&apos;nalish nomi</th>
                  <th className="p-2 text-right">Tayyorgarlik bali</th>
                </tr>
              </thead>
              <tbody>
                {passportData.score.domains.map((d) => (
                  <tr key={d.id} className="border-b border-slate-200">
                    <td className="p-2 border-r border-slate-300 font-bold">{d.id}</td>
                    <td className="p-2 border-r border-slate-300">{d.name}</td>
                    <td className="p-2 text-right font-mono font-bold">{d.score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-8 border-t border-slate-300 flex justify-between text-xs">
            <div>
              <p>Komissiya vakili: _______________________</p>
            </div>
            <div>
              <p>Klinika rahbari: _______________________</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
