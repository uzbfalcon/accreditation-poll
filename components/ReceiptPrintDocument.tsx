import { categoryLabel } from '@/lib/readiness';

export interface ReceiptPrintData {
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
  earnedPoints: number;
  maxPoints: number;
  scorePercent: number;
  category: string;
  hasCriticalViolations: boolean;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <tr className="border-b border-slate-300 last:border-b-0">
      <th className="w-[38%] py-[5px] pr-4 text-left align-top font-normal text-slate-600">{label}</th>
      <td className={`py-[5px] align-top font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</td>
    </tr>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-2 text-[11pt] font-bold uppercase tracking-wide text-slate-900">
        {number}. {title}
      </h2>
      <table className="w-full border-collapse border-y-2 border-slate-800 text-[10pt]">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

/**
 * Kvitansiyaning chop etish (PDF) ko'rinishi — ekranda yashirin, faqat window.print() da chiqadi.
 * Ekrandagi kartochka dizayni (fon ranglari, soyalar, ikki ustunli to'r) qog'ozda buziladi, shuning uchun
 * A4 uchun alohida rasmiy hujjat shakli ishlatiladi.
 */
export default function ReceiptPrintDocument({ data, printedAt }: { data: ReceiptPrintData; printedAt: string }) {
  const completedPercent =
    data.totalCriteria > 0 ? Math.round((data.completedCriteria / data.totalCriteria) * 100) : 0;

  return (
    <div className="hidden print:block bg-white text-slate-900 text-[10pt] leading-snug">
      {/* Sarlavha */}
      <header className="flex items-end justify-between border-b-2 border-slate-900 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="CLAMO" className="h-11 w-auto" />
        <div className="text-right text-[9pt] text-slate-600">
          <div>
            Ariza № <span className="font-mono font-bold text-slate-900">{data.sessionId}</span>
          </div>
          <div>{data.submittedAt}</div>
        </div>
      </header>

      <div className="mt-6 text-center">
        <h1 className="text-[15pt] font-bold uppercase leading-tight tracking-wide">
          Akkreditatsiya arizasi qabul qilinganligi
          <br />
          to&apos;g&apos;risida kvitansiya
        </h1>
        <p className="mt-1.5 text-[10pt] text-slate-600">
          Tibbiyot tashkilotining o&apos;z-o&apos;zini baholash chek-listi (75 ta standart, 275 ta mezon)
        </p>
      </div>

      <Section number={1} title="Tibbiyot tashkiloti">
        <Row label="Tashkilot to'liq nomi" value={data.orgName} />
        <Row label="STIR (INN)" value={data.inn} mono />
        <Row label="Joylashgan hudud" value={data.region} />
        <Row label="Kadastr raqami" value={data.cadastre} mono />
        <Row label="Mas'ul shaxs (F.I.O.)" value={data.fio} />
        <Row label="Bog'lanish telefoni" value={data.phone} mono />
      </Section>

      <Section number={2} title="Ariza">
        <Row label="Ariza raqami" value={data.sessionId} mono />
        <Row label="Topshirilgan sana va vaqt" value={data.submittedAt} />
        <Row label="Holati" value="Qabul qilindi — ekspert ko'rigida" />
        <Row
          label="Baholangan mezonlar"
          value={`${data.completedCriteria} / ${data.totalCriteria} (${completedPercent}%)`}
        />
      </Section>

      <Section number={3} title="Dastlabki baholash natijasi">
        <Row label="Olingan ball" value={`${data.earnedPoints} / ${data.maxPoints} ball`} />
        <Row label="Foiz ko'rsatkichi" value={`${data.scorePercent}%`} />
        <Row label="Dastlabki toifa" value={categoryLabel(data.category)} />
      </Section>

      <div className="mt-3 space-y-1.5 text-[8.5pt] text-slate-600 break-inside-avoid">
        <p>
          Hisoblash tartibi: bajarilgan mezon — Gold 1,3 ball, oddiy 1 ball; «Qisman» — 0,5 ball; «Tadbiq etilmaydi»
          mezonlar maksimal balldan chiqariladi. Toifalar 16-son qaror (37-band) bo&apos;yicha: oliy — 95%, birinchi —
          85%, ikkinchi — 75%.
        </p>
        {data.hasCriticalViolations && (
          <p className="font-semibold text-slate-900">
            Diqqat: kritik xavfsizlik talablaridan biri bajarilmagan — ekspert baholashida alohida e&apos;tibor
            qaratiladi.
          </p>
        )}
      </div>

      <section className="mt-5 break-inside-avoid border-l-4 border-slate-800 pl-4 text-[9.5pt]">
        <p className="font-bold">Keyingi bosqich</p>
        <p className="mt-1 text-slate-700">
          Topshirilgan chek-list tizimda qayd etildi va o&apos;zgartirib bo&apos;lmaydi. Vakolatli akkreditatsiya
          ekspertlari hujjatlarni o&apos;rganib chiqib, joyiga chiqish auditi sanasi va qo&apos;shimcha talablar
          bo&apos;yicha rasmiy xabarnoma yuboradi.
        </p>
      </section>

      <section className="mt-8 grid grid-cols-2 gap-10 break-inside-avoid text-[9.5pt]">
        <div>
          <div className="border-b border-slate-800 pb-1 font-semibold">{data.fio}</div>
          <div className="mt-1 text-[8pt] text-slate-500">Mas&apos;ul shaxs (F.I.O.)</div>
        </div>
        <div>
          <div className="border-b border-slate-800 pb-1">&nbsp;</div>
          <div className="mt-1 text-[8pt] text-slate-500">Imzo</div>
        </div>
      </section>

      <footer className="mt-6 border-t border-slate-300 pt-2 text-[8pt] text-slate-500 break-inside-avoid">
        <p>
          Natija o&apos;z-o&apos;zini baholash asosida hisoblangan dastlabki ko&apos;rsatkich. Rasmiy akkreditatsiya
          toifasini akkreditatsiyalovchi organ belgilaydi.
        </p>
        <p className="mt-1">Hujjat CLAMO akkreditatsiya tizimida elektron shakllantirildi: {printedAt}</p>
      </footer>
    </div>
  );
}
