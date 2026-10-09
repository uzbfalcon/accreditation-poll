// Bazadagi UTC vaqtni («YYYY-MM-DD HH:MM:SS») Toshkent vaqtida «dd.mm.yyyy» va «HH:MM» ko'rinishida beradi
export function formatTashkentDateTime(value: string): { date: string; time: string } {
  const d = new Date(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return { date: value, time: '' };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { date: `${get('day')}.${get('month')}.${get('year')}`, time: `${get('hour')}:${get('minute')}` };
}
