# CLAMO — Django admin paneli

Next.js ilovasining bazasi (`../clamo_accreditation.db`) ustida ishlaydigan administrator paneli.

- Asosiy jadvallar `managed=False` — Django ularning sxemasini o'zgartirmaydi va migratsiya qilmaydi.
- Admin foydalanuvchilari, sessiyalar va loglar alohida `admin.db` da saqlanadi.

## Lokal ishga tushirish

```bash
cd admin_panel
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python manage.py migrate            # faqat admin.db uchun
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver 8001
```

Brauzerda: http://localhost:8001/admin/

## Muhit o'zgaruvchilari

| O'zgaruvchi | Vazifasi | Standart |
|---|---|---|
| `DJANGO_SECRET_KEY` | Maxfiy kalit (productionda majburiy) | faqat dev uchun kalit |
| `DJANGO_DEBUG` | `0` — production | `1` |
| `DJANGO_ALLOWED_HOSTS` | Vergul bilan ajratilgan domenlar | `localhost,127.0.0.1` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Masalan `https://admin.lochinbek-ai.uz` | — |
| `CLAMO_DB_PATH` | Next.js bazasi yo'li | `../clamo_accreditation.db` |
| `DJANGO_ADMIN_DB_PATH` | Admin bazasi yo'li | `admin.db` |
| `CLAMO_SITE_URL` | Next.js sayt manzili (admin'dan `/oferta` ni ochish uchun) | `http://localhost:3000` |

## Imkoniyatlar

- **Audit sessiyalari** — ro'yxat, filtrlar (holat, tayyorgarlik, stop-faktor, viloyat), 273 ta javob bo'limlar bo'yicha.
  Amallar: *Yakuniy bo'lim qulfini ochish*, *Qoralamaga qaytarish*.
- **Tashkilotlar** — ma'lumotlarni tahrirlash, amaldagi xizmatlar (ТЭ), sessiyalar ro'yxati.
- **Sahifalar** — ommaviy oferta matni (`/oferta` sahifasi shu yerdan o'qiladi, saqlangach darhol yangilanadi).
- **Standartlar / Mezonlar** — matnlarni tahrirlash (tuzilma, kritik stop-faktorlar va ТЭ qoidalari `lib/db.ts` da).

Ball va tayyorgarlik toifasi Next.js tomonidan javoblardan hisoblanadi, shuning uchun admin'da faqat o'qiladi.
