"""
Sessiya balini javoblardan qayta hisoblash — lib/db.ts (calculateSessionScore) va lib/readiness.ts bilan bir xil qoidalar.
Admin javobni o'zgartirganda Natija darhol yangilanishi uchun ishlatiladi; Next.js ham keyingi o'qishda
xuddi shu hisobni o'zi bajaradi, shuning uchun manba (single source of truth) — javoblar.

Metodika (standartlar 07.08.2025, 1-jadval): Bor — koeffitsient (Gold 1,3 / oddiy 1,0), Qisman — 0,5 (ikkalasida),
Yo'q/javobsiz — 0; «Tadbiq etilmaydi» maksimal balldan chiqariladi (Reglament, 28-band).
Foiz = olingan ball / maksimal ball × 100, bir xonagacha kesiladi; toifa yaxlitlanmagan foiz bo'yicha
(16-son qaror, 37-band): ≥95 oliy, ≥85 birinchi, ≥75 ikkinchi, aks holda — tayyor emas.
Kritik stop-faktorlar toifaga ta'sir qilmaydi — faqat belgi sifatida saqlanadi.
"""

import math

from django.db import connections

# lib/db.ts → CRITICAL_STOP_FACTORS bilan bir xil bo'lishi shart
CRITICAL_STOP_FACTORS = {(16, 2), (38, 1), (55, 4), (58, 1)}

GOLD_WEIGHT = 1.3
REGULAR_WEIGHT = 1.0
PARTIAL_POINTS = 0.5

# Bazadagi score_weight ustuni (javob ulushi) — Next.js saveAnswer bilan bir xil
ANSWER_WEIGHTS = {'YES': 1.0, 'PARTIAL': 0.5, 'NO': 0.0, 'NA': None}

CATEGORY_THRESHOLDS = [('HIGHEST', 95), ('FIRST', 85), ('SECOND', 75)]


def points_for(answer, weight):
    if answer == 'YES':
        return weight
    if answer == 'PARTIAL':
        return PARTIAL_POINTS
    return 0.0


def categorize(raw_percent):
    for code, min_percent in CATEGORY_THRESHOLDS:
        if raw_percent >= min_percent:
            return code
    return 'NOT_READY'


def truncate_percent(raw_percent):
    # lib/readiness.ts → truncatePercent: bir xonagacha kesish (85,389 → 85,3)
    return math.floor(raw_percent * 10 + 1e-9) / 10


def recalculate_session(session_id):
    with connections['clamo'].cursor() as cursor:
        cursor.execute(
            '''
            SELECT c.standard_id, c.criterion_number, c.is_gold, sa.answer_value
            FROM criteria c
            LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = %s
            ''',
            [session_id],
        )
        rows = cursor.fetchall()

        yes = partial = no = na = 0
        earned = maximum = 0.0
        critical_violation = False
        for standard_id, criterion_number, is_gold, answer in rows:
            if answer == 'NA':
                na += 1
                continue
            weight = GOLD_WEIGHT if is_gold else REGULAR_WEIGHT
            maximum += weight
            earned += points_for(answer, weight)
            if answer == 'YES':
                yes += 1
            elif answer == 'PARTIAL':
                partial += 1
            else:  # NO yoki javob berilmagan
                no += 1
                if (standard_id, criterion_number) in CRITICAL_STOP_FACTORS:
                    critical_violation = True

        applicable = len(rows) - na
        raw_percent = earned / maximum * 100 if maximum > 0 else 0.0
        score = truncate_percent(raw_percent)
        category = categorize(raw_percent)

        cursor.execute(
            '''
            UPDATE audit_sessions SET
                total_applicable = %s, criteria_yes = %s, criteria_partial = %s, criteria_no = %s,
                criteria_na = %s, total_score = %s, readiness_category = %s,
                has_critical_stop_factors = %s, updated_at = datetime('now')
            WHERE id = %s
            ''',
            [applicable, yes, partial, no, na, score, category, int(critical_violation), session_id],
        )
