"""
Hudud va tumanlar ro'yxatini clamo-backend ma'lumotlaridan (SOATO kodlari bilan) data/uz_regions.json ga chiqaradi.
Next.js (lib/regions.ts) passport formasi, server validatsiyasi va backoffice filtrlari uchun shu JSON'ni ishlatadi.

Ishga tushirish:
    python3 scripts/import_regions.py ../clamo-backend/apps/common/data_sync

Tozalash: «`» → «'» (loyihadagi yozuv), «sh.» → «shahri», nomida turi yo'q yozuvlar to'ldiriladi,
dublikat va texnik yozuvlar («test», «Toshkent shahrining tumanlari») tashlab yuboriladi.
"""

import json
import sys
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent.parent / 'data' / 'uz_regions.json'

# Rasmiy tartib: Qoraqalpog'iston Respublikasi, viloyatlar (SOATO kodi bo'yicha), Toshkent shahri — oxirida
FIRST, LAST = '1735', '1726'
SKIP_DISTRICTS = {'test', 'Toshkent shahrining tumanlari'}
# Nomida «tumani»/«shahri» yo'q yozuvlar (manbadagi kirill nomiga qarab)
DISTRICT_FIXES = {
    'Yangi Namangan': 'Yangi Namangan tumani',
    "G'ozg'on": "G'ozg'on shahri",
}


def normalize(name):
    name = ' '.join(name.replace('`', "'").replace('‘', "'").replace('’', "'").split())
    if name.endswith(' sh.'):
        name = name[:-3] + 'shahri'
    return DISTRICT_FIXES.get(name, name)


def main(source_dir):
    source = Path(source_dir)
    regions = json.loads((source / 'regions.json').read_text(encoding='utf-8'))
    districts = json.loads((source / 'districts.json').read_text(encoding='utf-8'))

    def order(code):
        return (0 if code == FIRST else 2 if code == LAST else 1, code)

    result = []
    for region in sorted(regions, key=lambda r: order(r['code'])):
        names = set()
        for d in districts:
            if d['region_code'] != region['code']:
                continue
            name = normalize(d['name']['uz'])
            if name in SKIP_DISTRICTS:
                continue
            if not (name.endswith(' tumani') or name.endswith(' shahri')):
                raise SystemExit(f'Kutilmagan tuman nomi: {name!r} ({d["code"]})')
            names.add(name)
        result.append({
            'code': region['code'],
            'name': normalize(region['name']['uz']),
            'districts': sorted(names),
        })

    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{OUT_PATH}: {len(result)} hudud, {sum(len(r["districts"]) for r in result)} tuman/shahar')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
