"""
Akkreditatsiya standartlari Excel faylidan (7 ta «РАЗДЕЛ» varag'i) o'zbekcha (lotin) matnlarni
data/standards_uz.json ga chiqaradi. Next.js (lib/db.ts) shu JSON'ni bazaga qo'llaydi.
Qo'llanish shartlari Excel'da yo'q — ular chek-list Word hujjatidan («Қўлланиш шарти: ...») olinib,
APPLICABILITY_LATIN lug'ati orqali lotinga o'giriladi.

Ishga tushirish:
    uv run --with openpyxl python scripts/import_standards_xlsx.py "<standartlar>.xlsx" "<chek-list>.docx"

Fayl tuzilishi (har bir bo'lim varag'i):
    A: # | B: ruscha matn | C: o'zbekcha matn | D: СОП | E: Gold | F: ПРИМЕНИМО | H: ball
    «Стандарт N. ...» qatori — standart, keyingi qatorlar — uning mezonlari,
    oxiridagi «Общие баллы:» / «Набранные баллы:» — jami qatorlar (o'tkazib yuboriladi).
"""

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import openpyxl

OUT_PATH = Path(__file__).resolve().parent.parent / 'data' / 'standards_uz.json'
SUMMARY_ROWS = ('Общие баллы:', 'Набранные баллы:')
DOMAIN_COUNT = 7

# Word hujjatidagi (kirill) qo'llanish shartlari → lotin. Yangi shart paydo bo'lsa, skript to'xtaydi.
APPLICABILITY_LATIN = {
    'Ташкилот фаолияти ва тиббий хизмат турига мувофиқ қўлланилади.':
        'Tashkilot faoliyati va tibbiy xizmat turiga muvofiq qoʻllaniladi.',
    'Ташкилот фаолияти ва хизмат профилига мувофиқ қўлланилади.':
        'Tashkilot faoliyati va xizmat profiliga muvofiq qoʻllaniladi.',
    'Тегишли муҳандислик тизими (вентиляция, лифт ёки тиббий газ) мавжуд бўлса; алоҳида мезон бўйича «ТЭ» танланиши мумкин.':
        'Tegishli muhandislik tizimi (ventilyatsiya, lift yoki tibbiy gaz) mavjud boʻlsa; '
        'alohida mezon boʻyicha «Tadbiq etilmaydi» tanlanishi mumkin.',
    'Қайта ишлатиладиган тиббий асбоб-анжомлар стерилизация қилинса.':
        'Qayta ishlatiladigan tibbiy asbob-anjomlar sterilizatsiya qilinsa.',
    'Эндоскопик хизмат (гастроскопия, бронхоскопия ёки колоноскопия) мавжуд бўлса.':
        'Endoskopik xizmat (gastroskopiya, bronxoskopiya yoki kolonoskopiya) mavjud boʻlsa.',
    'Инвазив муолажалар ёки жарроҳлик амалиётлари бажарилса.':
        'Invaziv muolajalar yoki jarrohlik amaliyotlari bajarilsa.',
    'Дори воситалари, вакциналар ёки лаборатория реактивлари сақланса.':
        'Dori vositalari, vaksinalar yoki laboratoriya reaktivlari saqlansa.',
    'Қабул бўлими, шошилинч ёрдам ёки беморларни саралаш жараёни мавжуд бўлса.':
        'Qabul boʻlimi, shoshilinch yordam yoki bemorlarni saralash jarayoni mavjud boʻlsa.',
    'Жарроҳлик амалиётлари бажарилса.':
        'Jarrohlik amaliyotlari bajarilsa.',
    'Анестезия ёки седация ўтказилса.':
        'Anesteziya yoki sedatsiya oʻtkazilsa.',
    '24/7 стационар ёки шошилинч тиббий ёрдам тизими мавжуд бўлса.':
        '24/7 statsionar yoki shoshilinch tibbiy yordam tizimi mavjud boʻlsa.',
    'Ташкилотда лаборатория хизмати мавжуд бўлса.':
        'Tashkilotda laboratoriya xizmati mavjud boʻlsa.',
    'Радиология ва/ёки УТТ хизмати мавжуд бўлса.':
        'Radiologiya va/yoki UTT xizmati mavjud boʻlsa.',
    'МРТ хизмати мавжуд бўлса.':
        'MRT xizmati mavjud boʻlsa.',
    'Талабалар, резидентлар, магистрлар, ординаторлар ёки бошқа таълим олувчилар клиник жараёнда иштирок этса.':
        'Talabalar, rezidentlar, magistrlar, ordinatorlar yoki boshqa taʼlim oluvchilar klinik jarayonda ishtirok etsa.',
}


# Manba faylda lotin matn ichida ko'rinishi bir xil kirill harflar uchraydi (masalan «Тashkilot»)
HOMOGLYPHS = str.maketrans('АВЕКМНОРСТХаеорсухі', 'ABEKMHOPCTXaeopcyxi')


def clean(text):
    return re.sub(r'[ \t]+', ' ', str(text or '')).strip()


def latin(text):
    text = clean(text).translate(HOMOGLYPHS)
    if re.search(r'[\u0400-\u04FF]', text):
        raise SystemExit(f'Lotin matnda kirill harf qoldi: {text[:100]!r}')
    return text


def read_applicability(docx_path):
    """Word hujjatidan {standart_id: lotincha qo'llanish sharti}."""
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with zipfile.ZipFile(docx_path) as z:
        root = ElementTree.fromstring(z.read('word/document.xml'))
    paragraphs = [clean(''.join(t.text or '' for t in p.iter(f'{ns}t'))) for p in root.iter(f'{ns}p')]

    result, current = {}, None
    for text in paragraphs:
        m = re.match(r'Стандарт\s+(\d+)\b', text)
        if m:
            current = int(m.group(1))
            continue
        m = re.match(r'Қўлланиш шарти:\s*(.+)', text)
        if m and current and current not in result:
            condition = m.group(1).strip()
            if condition not in APPLICABILITY_LATIN:
                raise SystemExit(f'Standart {current}: lug\'atda yo\'q qo\'llanish sharti: {condition!r}')
            result[current] = APPLICABILITY_LATIN[condition]
    return result


def main(xlsx_path, docx_path):
    applicability = read_applicability(docx_path)
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)

    # Bo'lim nomlari «Общие баллы» varag'idan: «Bo‘lim 1. Yetakchilik va boshqaruv»
    domains = []
    for row in wb['Общие баллы'].iter_rows(values_only=True):
        m = re.match(r'Bo.lim\s+(\d+)\.\s*(.+)', clean(row[0]).replace('\n', ' '), re.S)
        if m:
            domains.append({'id': int(m.group(1)), 'name': clean(m.group(2))})

    standards, criteria = [], []
    for domain_id, ws in enumerate(wb.worksheets[:DOMAIN_COUNT], start=1):
        current = None
        for row in list(ws.iter_rows(values_only=True))[1:]:
            ru, uz = clean(row[1]), latin(row[2])
            m = re.match(r'Стандарт\s+(\d+)', ru)
            if m:
                title = re.sub(r'^Standar[td]\s+\d+\.\s*', '', uz)
                # «... (Gold).» belgisi sarlavhadan alohida maydonga
                gold = bool(re.search(r'\(Gold\)\s*\.?\s*$', title))
                if gold:
                    title = re.sub(r'\s*\(Gold\)\s*\.?\s*$', '', title).rstrip()
                    title = title if title.endswith('.') else title + '.'
                current = {'id': int(m.group(1)), 'domain_id': domain_id, 'title': title, 'gold': gold}
                standards.append(current)
                continue
            if not ru and not uz or ru in SUMMARY_ROWS:
                continue
            if current is None or not uz:
                raise SystemExit(f'{ws.title}: standartsiz yoki o\'zbekcha matnsiz qator: {ru[:80]!r}')
            number = sum(1 for c in criteria if c['standard_id'] == current['id']) + 1
            criteria.append({
                'standard_id': current['id'],
                'number': number,
                'description': re.sub(r'^\d+\s*[\).]\s*', '', uz),
                'gold': row[4] == 'Gold',
                'sop_required': row[3] == 'Обязательно',
            })

    ids = sorted(s['id'] for s in standards)
    if ids != list(range(1, len(ids) + 1)) or len(domains) != DOMAIN_COUNT:
        raise SystemExit(f'Kutilmagan tuzilma: standartlar={ids}, bo\'limlar={len(domains)}')
    missing = [i for i in ids if i not in applicability]
    if missing:
        raise SystemExit(f'Word hujjatida qo\'llanish sharti topilmadi: standartlar {missing}')
    for s in standards:
        s['applicability'] = applicability[s['id']]

    OUT_PATH.parent.mkdir(exist_ok=True)
    # version bazadagi PRAGMA user_version'dan katta bo'lishi kerak (lib/db.ts: 6 — hudud nomlarini moslash);
    # keyingi yangilanishda 7 qiling
    OUT_PATH.write_text(json.dumps(
        {'version': 3, 'domains': domains, 'standards': standards, 'criteria': criteria},
        ensure_ascii=False, indent=1,
    ) + '\n', encoding='utf-8')
    print(f'{OUT_PATH}: {len(domains)} bo\'lim, {len(standards)} standart, {len(criteria)} mezon')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
