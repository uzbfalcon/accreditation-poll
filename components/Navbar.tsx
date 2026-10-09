'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, LayoutDashboard, FileSpreadsheet, LogOut } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const isBackoffice = pathname.startsWith('/backoffice');

  const handleLogout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/backoffice/login');
    router.refresh();
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3.5 group">
          {/* Real CLAMO Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="CLAMO"
            className="h-10 sm:h-11 w-auto object-contain group-hover:scale-[1.02] transition-transform"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                isBackoffice
                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                  : 'bg-teal-50 text-teal-700 border-teal-200'
              }`}>
                {isBackoffice ? 'Backoffice Monitoring' : 'Klinika Portali'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              75 ta standart va 275 ta mezon asosidagi milliy audit chek-listi
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2.5">
          {isBackoffice ? (
            <>
              <Link
                href="/"
                className="text-xs font-bold text-slate-700 hover:text-teal-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
              >
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Klinika So&apos;rovnomasi</span>
              </Link>
              <a
                href="/api/v1/backoffice/export-excel"
                download
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel (CSV)</span>
              </a>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-slate-600 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Chiqish</span>
              </button>
            </>
          ) : (
            <Link
              href="/backoffice"
              className="text-xs font-bold text-slate-700 hover:text-teal-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
              <span>Backoffice Monitoring &rarr;</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
