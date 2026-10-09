// Chek-list oqimi sozlamasi (serverda backoffice.env orqali, qayta build qilmasdan almashtiriladi):
//   CHECKLIST_STRICT_FLOW=1 — bo'limlar ketma-ket ochiladi, yakuniy bo'limga o'tilgach oldingilari yopiladi,
//                             arizani faqat barcha mezonlar to'ldirilgach topshirish mumkin.
//   o'rnatilmagan / boshqa qiymat — barcha bo'limlar ochiq, ariza istalgan paytda topshiriladi.
// «Bitta INN — bitta topshirish» qoidasi har ikki holatda ham amal qiladi.
export function isStrictSectionFlow(): boolean {
  return process.env.CHECKLIST_STRICT_FLOW === '1';
}
