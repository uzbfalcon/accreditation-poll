'use client';

import { Printer } from 'lucide-react';

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-xs font-semibold text-slate-600 hover:text-teal-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition cursor-pointer"
    >
      <Printer className="w-3.5 h-3.5" />
      <span>Chop etish</span>
    </button>
  );
}
