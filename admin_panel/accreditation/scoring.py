"""
Sessiya balini javoblardan qayta hisoblash — lib/db.ts dagi calculateSessionScore() bilan bir xil qoidalar.
Admin javobni o'zgartirganda Natija darhol yangilanishi uchun ishlatiladi; Next.js ham keyingi o'qishda
xuddi shu hisobni o'zi bajaradi, shuning uchun manba (single source of truth) — javoblar.
"""

from django.db import connections

# lib/db.ts → CRITICAL_STOP_FACTORS bilan bir xil bo'lishi shart
CRITICAL_STOP_FACTORS = {(16, 2), (38, 1), (55, 4), (58, 1)}

ANSWER_WEIGHTS = {'YES': 1.0, 'PARTIAL': 0.5, 'NO': 0.0, 'NA': None}


def recalculate_session(session_id):
    with connections['clamo'].cursor() as cursor:
        cursor.execute(
            '''
            SELECT c.standard_id, c.criterion_number, sa.answer_value
            FROM criteria c
            LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = %s
            ''',
            [session_id],
        )
        rows = cursor.fetchall()

        yes = partial = no = na = 0
        critical_violation = False
        for standard_id, criterion_number, answer in rows:
            if answer == 'YES':
                yes += 1
            elif answer == 'PARTIAL':
                partial += 1
            elif answer == 'NA':
                na += 1
            else:  # NO yoki javob berilmagan
                no += 1
                if (standard_id, criterion_number) in CRITICAL_STOP_FACTORS:
                    critical_violation = True

        applicable = len(rows) - na
        # JS: Math.round(x * 1000) / 10 — yarmini yuqoriga yaxlitlash (Python round() bankir usulida)
        score = int((yes + partial * 0.5) / applicable * 1000 + 0.5) / 10 if applicable > 0 else 0.0

        if score >= 80.0 and not critical_violation:
            category = 'READY'
        elif score >= 55.0:
            category = 'PARTIALLY_READY'
        else:
            category = 'NOT_READY'

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
