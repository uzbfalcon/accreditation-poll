# 🏥 clamo.uz — Tibbiyot Tashkilotlarini Akkreditatsiyaga Tayyorgarlik Darajasini Baholash Tizimi
*(75 ta Standart • 275 ta Mezon Asosida)*

Ushbu loyiha O'zbekiston Respublikasi Sog'liqni saqlash vazirligi milliy akkreditatsiya standartlari asosida tibbiyot tashkilotlarining dastlabki o'z-o'zini baholashini avtomatlashtirish, qoralamalarni real-vaqtda saqlash va akkreditatsiya komissiyasi uchun Backoffice monitoring tahlilini yuritish uchun yaratilgan to'liq Next.js (App Router, TypeScript, Tailwind CSS) va Python tizimidir.

---

## 📁 Loyiha Strukturasi (Next.js & Full-stack)

```
clamo_accreditation_system/
├── app/
│   ├── layout.tsx                                    # Global Layout va metadata
│   ├── globals.css                                   # Tailwind va maxsus stillar, PDF chop etish
│   ├── page.tsx                                      # 🏥 1. Klinika Onboarding & 275 mezonli Chek-list Portali
│   ├── backoffice/
│   │   └── page.tsx                                  # 📊 2. Backoffice Monitoring, Viloyat/Tuman filtrlari & PDF
│   └── api/v1/                                       # ⚡️ Next.js REST API Route Handlers
│       ├── organizations/lookup-inn/[inn]/route.ts   # INN orqali korxona ma'lumotlarini qidirish
│       ├── audit-sessions/
│       │   ├── initialize/route.ts                   # Sessiyani boshlash va ТЭ ni avtomatik belgilash
│       │   └── [sessionId]/
│       │       ├── checklist/route.ts                # 7 ta bo'lim, 75 standart, 275 mezonni yuklash
│       │       ├── save-answer/route.ts              # Real-vaqtda javobni saqlash (Autosave)
│       │       ├── submit/route.ts                   # Arizani komissiyaga topshirish
│       │       └── score/route.ts                    # Ball va tayyorgarlik darajasini olish
│       └── backoffice/
│           ├── dashboard/
│           │   ├── summary/route.ts                  # 4 ta strategik KPI
│           │   ├── regions-breakdown/route.ts        # Viloyatlar bo'yicha ko'rsatkichlar
│           │   └── domains-breakdown/route.ts        # 7 ta yo'nalish bo'yicha milliy natijalar
│           ├── clinics/
│           │   ├── route.ts                          # Kaskad filtrlangan klinikalar reyestri
│           │   └── [sessionId]/audit-passport/route.ts # Pasport va GAP tahlili
│           └── export-excel/route.ts                 # Excel / CSV eksport
├── components/
│   └── Navbar.tsx                                    # Umumiy navigatsiya paneli
├── lib/
│   └── db.ts                                         # SQLite (better-sqlite3) ulanishi, hisoblash va biznes mantiq
├── clamo_accreditation.db                            # SQLite ma'lumotlar bazasi
├── package.json                                      # Next.js va npm bog'liqliklari
├── tsconfig.json                                     # TypeScript sozlamalari
├── next.config.mjs                                   # Next.js konfiguratsiyasi
├── tailwind.config.ts                                # Tailwind CSS konfiguratsiyasi
├── run_next.sh                                       # ⚡️ Next.js ni ishga tushiruvchi skript
├── run.sh                                            # Python serverini ishga tushiruvchi skript (alternativ)
├── server.py                                         # Python HTTP server
├── database.py                                       # Python SQLite ma'lumotlar bazasi
└── models.py                                         # Python biznes mantiq va formulalar
```

---

## ⚡️ Next.js da Ishga Tushirish (Tavsiya etiladi)

Loyiha to'liq **Next.js 14+ (App Router)** da yaratilgan.

### 1-Usul: Skript orqali:
```bash
./run_next.sh
```

### 2-Usul: npm orqali:
```bash
# Rivojlanish (development) rejimida:
npm run dev

# Yoki production rejimida:
npm run build
npm start
```

Server ishga tushgach, brauzerda quyidagi manzillarni oching:

1. **🏥 Klinika So'rovnoma Portali:**  
   👉 [http://localhost:3000/](http://localhost:3000/)
   * INN kiritganda korxona nomini avtomatik aniqlash (masalan: `304882190`);
   * Kadastr raqami, mas'ul shaxs F.I.O, telefon;
   * Amaldagi xizmatlar bo'yicha dinamik «ТЭ» filtrlari;
   * 75 ta standart va 275 ta mezon bo'yicha `Бор`, `Қисман`, `Йўқ`, `Тааллуқли эмас` tugmalari;
   * Har bir javob berilganda **real-time avtomatik saqlanish (Autosave)** va ball hisoblanishi;
   * On-scroll animated sticky domain headers (Codrops uslubi) va zero-layout-shift sidebar menyusi.

2. **📊 Backoffice Monitoring Paneli (Komissiya / Auditor):**  
   👉 [http://localhost:3000/backoffice](http://localhost:3000/backoffice)
   * 4 ta asosiy strategik KPI kartasi (Topshirganlar, O'rtacha ball, Tayyorlar, Xavfli klinikalar);
   * Viloyatlar bo'yicha saralash va o'rtacha ballar grafiklari;
   * 7 ta yo'nalish bo'yicha milliy ko'rsatkichlar (eng zaif bo'g'in: infeksion nazorat);
   * **Kaskad filtrlar:** Viloyat tanlanganda tumanlar ro'yxati avtomatik yangilanadi;
   * Har bir klinikaning **Akkreditatsiya Pasporti & GAP tahlili** modali;
   * **Rasmiy PDF xulosa** shaklida ko'rish va chop etish (`window.print()`);
   * Excel / CSV eksport.

---

## 🧮 Ballarni Hisoblash Formulasi

$$\text{Tayyorgarlik Bali (\%)} = \frac{\sum (\text{Бор} \times 1.0) + \sum (\text{Қисман} \times 0.5)}{\text{Amaldagi mezonlar (275} - \text{ТЭ)}} \times 100$$

* **&ge; 80%** — «Akkreditatsiyaga tayyor» (Yashil)
* **55% – 79%** — «Tayyorlanish jarayonida (Qisman tayyor)» (Sariq)
* **< 55%** — «Tayyor emas» (Qizil)

### 🚨 Zero-Tolerance Kritik Stop-Faktorlar:
Klinika umumiy bali 90% bo'lsa ham, agar quyidagi 4 ta talabda «Йўқ» bo'lsa, tizim qizil xavf bayrog'ini yoqadi:
1. **St. 58:** «Кўк код» 3 daqiqalik shoshilinch reanimatsiya algoritmi yo'qligi;
2. **St. 55:** Jarrohlik nazorat varag'i (Sign-in, Time-out, Sign-out) yuritilmasligi;
3. **St. 16:** Zaxira elektr generatori va suv ta'minoti mavjud emasligi;
4. **St. 38:** Yuqori xavfdagi dorilar va konsentrlangan elektrolitlar maxsus nazoratsiz saqlanishi.
