from django.apps import AppConfig
from django.db.backends.signals import connection_created


# Next.js (lib/db.ts) qo'shadigan ustunlar — admin Next.js'dan oldin ishga tushsa ham mavjud bo'lsin.
# Matnlar (standart/mezon) Next.js tomonidan data/standards_uz.json'dan yoziladi.
CLAMO_EXTRA_COLUMNS = [
    ('audit_sessions', 'final_stage_at', 'TEXT'),
    ('standards', 'is_gold', 'INTEGER DEFAULT 0'),
    ('criteria', 'is_gold', 'INTEGER DEFAULT 0'),
    ('criteria', 'sop_required', 'INTEGER DEFAULT 0'),
]


def ensure_clamo_schema(sender, connection, **kwargs):
    if connection.alias != 'clamo':
        return
    with connection.cursor() as cursor:
        cursor.execute(
            'CREATE TABLE IF NOT EXISTS site_pages ('
            'slug TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT)'
        )
        for table, column, ddl in CLAMO_EXTRA_COLUMNS:
            cursor.execute(f'PRAGMA table_info({table})')
            if not any(row[1] == column for row in cursor.fetchall()):
                cursor.execute(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}')


class AccreditationConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accreditation'
    verbose_name = 'Akkreditatsiya'

    def ready(self):
        connection_created.connect(ensure_clamo_schema)
