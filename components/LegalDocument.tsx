import React from 'react';

// Admin'da tahrirlanadigan matn formati: «# » / «## » / «### » sarlavhalar, «- » ro'yxat elementi,
// bo'sh qator — yangi xatboshi, **qalin**. HTML qo'llab-quvvatlanmaydi — matn React orqali ekranlanadi.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export default function LegalDocument({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return null;

        const first = lines[0];
        if (first.startsWith('# ')) {
          return (
            <h1 key={bi} className="text-2xl sm:text-3xl font-bold text-slate-900 text-center tracking-tight">
              {renderInline(first.slice(2))}
            </h1>
          );
        }
        if (first.startsWith('## ')) {
          return (
            <h2 key={bi} className="text-lg font-bold text-slate-900 pt-5">
              {renderInline(first.slice(3))}
            </h2>
          );
        }
        if (first.startsWith('### ')) {
          return (
            <h3 key={bi} className="text-base font-semibold text-slate-900 pt-2">
              {renderInline(first.slice(4))}
            </h3>
          );
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={bi} className="list-disc pl-6 space-y-1.5 marker:text-teal-600">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{renderInline(lines.join(' '))}</p>;
      })}
    </div>
  );
}
