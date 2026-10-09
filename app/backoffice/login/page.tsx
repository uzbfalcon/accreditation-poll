'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, User, ArrowRight, AlertTriangle } from 'lucide-react';
import { safeNextPath } from '@/lib/backoffice-auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Kirishda xatolik yuz berdi");
        return;
      }
      router.replace(safeNextPath(searchParams.get('next')));
      router.refresh();
    } catch {
      setError("Serverga ulanib bo'lmadi");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="username" className="block text-xs font-bold text-slate-800 mb-1">
          Login
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="username"
            type="text"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-bold text-slate-800 mb-1">
          Parol
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-3 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-800 hover:to-cyan-800 text-white font-bold text-sm rounded-xl shadow-lg transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span>{isSubmitting ? 'Tekshirilmoqda...' : 'Kirish'}</span>
        {!isSubmitting && <ArrowRight className="w-4 h-4" />}
      </button>
    </form>
  );
}

export default function BackofficeLoginPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <Link href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CLAMO" className="h-9 w-auto object-contain" />
          </Link>
          <span className="mt-3 text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-purple-50 text-purple-800 border-purple-200">
            Backoffice Monitoring
          </span>
        </div>

        <div className="bg-white border border-slate-300 rounded-2xl shadow-xl p-6 sm:p-8 relative">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 rounded-t-2xl"></div>
          <h1 className="text-lg font-bold text-slate-900">Tizimga kirish</h1>
          <p className="text-xs text-slate-500 mt-1 mb-5">Akkreditatsiya komissiyasi va auditorlar uchun</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          <Link href="/" className="hover:text-teal-700">
            &larr; Klinika portaliga qaytish
          </Link>
        </p>
      </div>
    </div>
  );
}
