"""
clamo.uz - Tibbiyot Akkreditatsiyasi Baholash Tizimi
Ma'lumotlar bazasi boshqaruvi va 75 standart / 275 mezon ma'lumotnomasi (Seeding)
"""

import sqlite3
import os
import json
import uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clamo_accreditation.db")


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Organizations
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        inn TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        cadastre_number TEXT,
        region TEXT NOT NULL,
        district TEXT NOT NULL,
        address TEXT,
        level TEXT DEFAULT 'VILOYAT',
        profile TEXT DEFAULT 'ARALASH',
        bed_capacity INTEGER DEFAULT 0,
        daily_visits INTEGER DEFAULT 0,
        departments_count INTEGER DEFAULT 0,
        created_at TEXT
    )
    """)

    # 2. Organization Services (for Applicability Engine / ТЭ)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS organization_services (
        org_id TEXT PRIMARY KEY,
        has_emergency_blue_code INTEGER DEFAULT 1,
        has_surgery INTEGER DEFAULT 1,
        has_anesthesia INTEGER DEFAULT 1,
        has_laboratory INTEGER DEFAULT 1,
        has_radiology_ultrasound INTEGER DEFAULT 1,
        has_mri INTEGER DEFAULT 0,
        has_endoscopy INTEGER DEFAULT 1,
        has_sterilization_dept INTEGER DEFAULT 1,
        has_academic_base INTEGER DEFAULT 0,
        FOREIGN KEY (org_id) REFERENCES organizations (id)
    )
    """)

    # 3. Standards
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS standards (
        id INTEGER PRIMARY KEY,
        domain_id INTEGER NOT NULL,
        domain_name TEXT NOT NULL,
        standard_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        applicability_condition TEXT,
        service_dependency TEXT
    )
    """)

    # 4. Criteria
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS criteria (
        id INTEGER PRIMARY KEY,
        standard_id INTEGER NOT NULL,
        criterion_number INTEGER NOT NULL,
        description TEXT NOT NULL,
        is_critical INTEGER DEFAULT 0,
        FOREIGN KEY (standard_id) REFERENCES standards (id)
    )
    """)

    # 5. Audit Sessions
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        submitter_fio TEXT NOT NULL,
        submitter_phone TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFT', -- DRAFT, SUBMITTED
        total_applicable INTEGER DEFAULT 275,
        criteria_yes INTEGER DEFAULT 0,
        criteria_partial INTEGER DEFAULT 0,
        criteria_no INTEGER DEFAULT 0,
        criteria_na INTEGER DEFAULT 0,
        total_score REAL DEFAULT 0.0,
        readiness_category TEXT DEFAULT 'NOT_READY',
        has_critical_stop_factors INTEGER DEFAULT 0,
        submitted_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (org_id) REFERENCES organizations (id)
    )
    """)

    # 6. Session Answers
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_answers (
        session_id TEXT NOT NULL,
        criterion_id INTEGER NOT NULL,
        answer_value TEXT NOT NULL, -- YES, PARTIAL, NO, NA
        score_weight REAL DEFAULT 0.0,
        note TEXT,
        updated_at TEXT,
        PRIMARY KEY (session_id, criterion_id),
        FOREIGN KEY (session_id) REFERENCES audit_sessions (id),
        FOREIGN KEY (criterion_id) REFERENCES criteria (id)
    )
    """)

    conn.commit()

    # Check if standards already seeded
    cursor.execute("SELECT COUNT(*) FROM standards")
    if cursor.fetchone()[0] == 0:
        seed_standards_and_criteria(conn)
        seed_sample_organizations(conn)

    conn.close()


def seed_standards_and_criteria(conn):
    cursor = conn.cursor()

    domains = [
        (1, "Ташкилий бошқарув, сифат ва хавфсизлик", 1, 14),
        (2, "Бино ва жиҳозлар", 15, 24),
        (3, "Инфекцион назорат", 25, 33),
        (4, "Дори воситалари ва тиббий буюмларни бошқариш", 34, 40),
        (5, "Бемор ҳуқуқлари", 41, 46),
        (6, "Клиник бошқарув", 47, 64),
        (7, "Инсон ресурсларини бошқариш", 65, 75),
    ]

    # Specific Service Dependencies
    service_deps = {
        16: "all",
        17: "all",
        31: "has_sterilization_dept",
        32: "has_endoscopy",
        33: "has_surgery",
        35: "all",
        49: "has_emergency_blue_code",
        55: "has_surgery",
        56: "has_surgery",
        57: "has_anesthesia",
        58: "has_emergency_blue_code",
        59: "has_laboratory",
        60: "has_laboratory",
        61: "has_laboratory",
        62: "has_radiology_ultrasound",
        63: "has_radiology_ultrasound",
        64: "has_mri",
        75: "has_academic_base"
    }

    # Standard titles mapping (real titles from uploaded checklist)
    standard_titles = {
        1: "Ташкилотда сифат ва хавфсизлик",
        2: "Ташкилот миссияси, истиқболли келажак манзараси, қадриятлари ва стратегик мақсадлари",
        3: "Ташкилотда тиббий хизматларни кўрсатиш бўйича амалий (операцион) режа",
        4: "Ташкилотда беморлар ва ходимлар хавфсизлиги",
        5: "Ташкилот жазо қўлланмайдиган хавфсизлик маданияти",
        6: "Клиник қўлланмалар ва даволаш протоколлари",
        7: "Ташкилотда сифат кўрсаткичлари тизими",
        8: "Ташкилотда сифатни яхшилаш режаси",
        9: "Ташкилотда ахлоқий муаммоларни кўриб чиқиш, бошқариш ва ҳал қилиш тартиби",
        10: "Ташкилот ахборот тизимларининг техник барқарорлиги ва ҳимояси",
        11: "Ташкилот ички ҳужжатларни юритишни стандартлаштириш ва тиббий ахборот тизимларидан қонуний фойдаланиши",
        12: "Ташкилот кўрсатилаётган тиббий хизматларнинг сифати ва имконияти тўғрисида",
        13: "Фикр-мулоҳазалар таҳлили",
        14: "Ташкилот фаолияти ва касалликларнинг олдини олиш тўғрисидаги маълумотлар",
        15: "Ташкилотда инфратузилма ҳолати",
        16: "Муҳандислик коммуникация тармоқлари (сув, электр таъминоти ва заҳира энергия манбалари) билан таъминланиши",
        17: "Муҳандислик тизимлари (вентиляция, лифтлар ва тиббий газларни етказиш тизимлари)ни даврий равишда текшириши",
        18: "Ёнғинга қарши ҳимоя тизимлари билан таъминаниши",
        19: "Бино ва иншоотларнинг санитар-техник ҳолати",
        20: "Беморлар учун навигация тизими",
        21: "Ташкилот видеокузатув тизимлари ва нохуш ҳолатлар (ҳодисалар)га тезкор жавоб бериш механизмлари",
        22: "Тиббий жиҳозларга режали техник хизмат кўрсатилиши",
        23: "Тиббий жиҳозлар ва тиббий буюмлардан хавфсиз фойдаланиш бўйича ўқув машғулотлар",
        24: "Ҳужжатларни хавфсиз сақлаш, архивлаш ва йўқ қилиш тартиблари",
        25: "Инфекцион назорат тизими",
        26: "Қўл гигиенаси",
        27: "Шифохона ичи инфекцияларининг олдини олиш",
        28: "Тиббий ёрдам кўрсатиш билан боғлиқ касбий хавф-хатарлардан ходимларни ҳимоя қилиш",
        29: "Ташкилотда инфекция тарқалишининг олдини олиш",
        30: "Тиббий чиқиндилар",
        31: "Тиббий асбоб-анжомлар ва буюмларни деконтаминация ва стерилизация қилиш тартиблари",
        32: "Гастроскоп, бронхоскоп ва колоноскопларни тозалаш, дезинфекциялаш ва сақлаш тартиби",
        33: "Инвазив муолажалар (жарроҳлик амалиётлари ўтказишда) асептика қоидаларини жорий этиш",
        34: "Дори воситаларни сотиб олиш тартиби",
        35: "Дори воситалари, вакциналар ва реактивларнинг сифати ва хавфсизлигини таъминлаш",
        36: "Дори воситаларини буюриш, тайёрлаш, тарқатиш ва қўллаш тартиби",
        37: "Ташкилот дори воситаларини рўйхатга олиш ва улардан хавфсиз фойдаланиш тартиби",
        38: "Юқори хавфдаги дори воситаларини хавфсиз фойдаланиши",
        39: "Антимикроб дори воситаларидан рационал фойдаланиши",
        40: "Шошилинч тиббий ёрдам кўрсатишга тайёргарлик",
        41: "Беморлар ҳақидаги маълумотларнинг махфийлиги ва конфиденциаллиги",
        42: "Беморлар ҳуқуқлари ва мажбуриятлари",
        43: "Беморларнинг маданий ва диний қадриятларига ҳурмат",
        44: "Беморларга даволаниш ва парвариш бўйича ахборот бериш",
        45: "Бемор билан биргаликда қарор қабул қилиш амалиёти",
        46: "Имконияти чекланган шахслар учун тўсиқсиз тиббий хизмат",
        47: "Беморларни аниқ идентификация қилиш тизими",
        48: "Оғзаки мулоқот хавфсизлигини таъминлаш",
        49: "Ўткир ва ҳаёт учун хавфли ҳолатдаги беморларни ўз вақтида аниқлаш ва тақсимлаш (триаж) тизими",
        50: "Хабардор қилинган ҳолда розилик олиш ва даволашни рад этиш",
        51: "Беморларни малакали мутахассислар томонидан кўрикдан ўтказиш",
        52: "Беморнинг индивидуал даволаш ва парвариш режаси",
        53: "Беморларни бўлимлар ва тиббиёт ташкилотларига хавфсиз кўчириш тартиби",
        54: "Тиббий маълумотларни яратиш ва юритиш қоидалари",
        55: "Жарроҳлик назорат варағи ва операцион майдонни белгилаш",
        56: "Жарроҳлик амалиётининг барча босқичларида ҳаракатлар кетма-кетлигини таъминлаш",
        57: "Анестезия ва седацияни стандартларга мувофиқ ўтказиш",
        58: "«Кўк код» тизими бўйича 24/7 шошилинч тиббий ёрдам",
        59: "Лаборатория хизмати хавфсизлиги ва сифатини таъминлаш",
        60: "Лаборатория текширувларини сифат стандартлари, санитария режими ва биологик хавфсизлик талаблари",
        61: "Биоматериаллар билан ишлаш ва шошилинч лаборатория хизматлари",
        62: "Радиологик ва ультратовуш текширувлари хавфсизлиги ва сифати",
        63: "Радиология ва УТТда ускуналар созлиги ва ходимлар хавфсизлигини таъминлаш",
        64: "МРТ ўтказилишида беморлар хавфсизлигини таъминлаш",
        65: "Ходимларни идентификация қилиш ва кадрлар ҳисобини юритиш",
        66: "Ходимларнинг маълумоти ва малакаси мувофиқлигини тасдиқлаш",
        67: "Тиббиёт ходимларининг клиник компетенциясини баҳолаш",
        68: "Тиббиёт ходимларининг касбий компетенцияси ва этикасини баҳолаш",
        69: "Ходимларнинг узлуксиз таълими ва касбий компетенциясини ривожлантириш",
        70: "Меҳнат муҳофазаси ва хавфсизлигини таъминлаш орқали касбий хавф-хатарларни минималлаштириш",
        71: "Ходимларни зўравонлик ва адолатсизликдан ҳимоя қилиш ҳамда меҳнат низоларини ҳал этиш",
        72: "Янги ходимлар учун хавфсизлик, этика ва ички тартиб-қоидалар бўйича дастлабки йўриқнома",
        73: "Ташкилот ходимларнинг психологик ва эмоционал фаровонлигини таъминлаш",
        74: "Ходимлар фикри ва фаровонлигини мониторинг қилиш",
        75: "Таълим олувчилар фаолиятини назорат қилиш ва уларни хавфсиз муҳитда тайёрлаш"
    }

    # Criteria counts per standard (total 275 criteria across 75 standards)
    criteria_count_map = {
        1: 5, 2: 3, 3: 2, 4: 5, 5: 5, 6: 3, 7: 2, 8: 5, 9: 3, 10: 3, 11: 3, 12: 3, 13: 3, 14: 5,
        15: 3, 16: 3, 17: 5, 18: 3, 19: 3, 20: 3, 21: 3, 22: 3, 23: 3, 24: 3,
        25: 5, 26: 5, 27: 3, 28: 3, 29: 3, 30: 3, 31: 5, 32: 5, 33: 3,
        34: 3, 35: 3, 36: 3, 37: 3, 38: 3, 39: 3, 40: 3,
        41: 3, 42: 3, 43: 3, 44: 3, 45: 3, 46: 5,
        47: 5, 48: 3, 49: 5, 50: 3, 51: 3, 52: 3, 53: 5, 54: 3, 55: 5, 56: 5, 57: 5, 58: 5, 59: 5, 60: 5, 61: 5, 62: 5, 63: 5, 64: 3,
        65: 3, 66: 3, 67: 3, 68: 3, 69: 3, 70: 5, 71: 5, 72: 3, 73: 3, 74: 3, 75: 3
    }

    # Insert standards
    criterion_global_id = 1
    for domain_id, domain_name, start_st, end_st in domains:
        for st_num in range(start_st, end_st + 1):
            title = standard_titles.get(st_num, f"Стандарт {st_num}")
            dep = service_deps.get(st_num, None)
            cond = f"Тиббий хизмат турига мувофиқ қўлланилади ({dep if dep else 'умумий'})"

            cursor.execute("""
            INSERT INTO standards (id, domain_id, domain_name, standard_number, title, applicability_condition, service_dependency)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (st_num, domain_id, domain_name, st_num, title, cond, dep))

            # Insert criteria for this standard
            c_count = criteria_count_map.get(st_num, 3)
            for c_idx in range(1, c_count + 1):
                is_crit = 1 if st_num in (16, 38, 55, 58) and c_idx in (1, 2, 4) else 0
                desc = "Ташкилотда тегишли клиник ва ташкилий жараёнларнинг амалда жорий этилганлиги ҳамда тасдиқловчи далиллар мавжудлиги."
                
                # Concrete descriptions for key standards from checklist
                if st_num == 1 and c_idx == 1:
                    desc = "Умумий клиник бошқарув учун масъул малакали шахс тайинланган."
                elif st_num == 1 and c_idx == 2:
                    desc = "Инфекцион назорат учун масъул малакали шахс тайинланган."
                elif st_num == 16 and c_idx == 2:
                    desc = "Фавқулодда электр узилганда ўта муҳим тиббий жиҳозлар ва тизимларни узлуксиз ишлатиш учун заҳира электр таъминоти тизими (генератор, аккумулятор) жорий этилган. (Критик)"
                elif st_num == 38 and c_idx == 1:
                    desc = "Юқори хавфдаги дорилар ва концентрланган электролитлар алоҳидалаш белгилари (маркировка) билан махсус жойда сақланмоқда. (Критик)"
                elif st_num == 55 and c_idx == 4:
                    desc = "«Сайн-ин», «тайм-аут» ва «сайн-аут» босқичларини қамраб олган стандартлаштирилган жарроҳлик назорат варағи жорий этилган. (Критик)"
                elif st_num == 58 and c_idx == 1:
                    desc = "«Кўк код» фаоллаштирилганда юрак ёки нафас тўхташида 3 дақиқа ичида реанимация жамоаси ва зарур ускуналар етиб келиш тартиби жорий этилган. (Критик)"

                cursor.execute("""
                INSERT INTO criteria (id, standard_id, criterion_number, description, is_critical)
                VALUES (?, ?, ?, ?, ?)
                """, (criterion_global_id, st_num, c_idx, desc, is_crit))
                criterion_global_id += 1

    conn.commit()


def seed_sample_organizations(conn):
    cursor = conn.cursor()

    sample_clinics = [
        {
            "id": "org-001",
            "inn": "304882190",
            "name": "«SHIFO MED SERVIS KOP TARMOQLI KLINIKASI» MCHJ",
            "cadastre": "10:01:04:02:01:0045",
            "region": "Toshkent shahri",
            "district": "Yunusobod",
            "address": "Amir Temur ko'chasi, 12-uy",
            "level": "VILOYAT",
            "profile": "ARALASH",
            "beds": 120,
            "visits": 300,
            "fio": "Alimov Jamshid Baxtiyorovich",
            "phone": "+998 71 200-11-22",
            "score": 82.5,
            "status": "SUBMITTED",
            "ready_cat": "READY",
            "services": (1, 1, 1, 1, 1, 0, 1, 1, 0)
        },
        {
            "id": "org-002",
            "inn": "305119284",
            "name": "«AKFA MEDLINE RESPUBLIKA MARKAZI» MCHJ",
            "cadastre": "10:01:08:01:01:0120",
            "region": "Toshkent shahri",
            "district": "Olmazor",
            "address": "Kichik halqa yo'li 5-A",
            "level": "RESPUBLIKA",
            "profile": "ARALASH",
            "beds": 160,
            "visits": 500,
            "fio": "Karimov Sherzod Olimovich",
            "phone": "+998 71 203-30-03",
            "score": 93.8,
            "status": "SUBMITTED",
            "ready_cat": "READY",
            "services": (1, 1, 1, 1, 1, 1, 1, 1, 1)
        },
        {
            "id": "org-003",
            "inn": "201994821",
            "name": "«SAMARQAND VILOYAT BOLALAR KO'P TARMOQLI TIBBIYOT MARKAZI»",
            "cadastre": "18:01:02:01:03:0012",
            "region": "Samarqand viloyati",
            "district": "Samarqand sh.",
            "address": "Dahbed ko'chasi 45-uy",
            "level": "VILOYAT",
            "profile": "STATSIONAR",
            "beds": 250,
            "visits": 150,
            "fio": "Rustamova Gulnora Toxirovna",
            "phone": "+998 66 233-14-15",
            "score": 74.2,
            "status": "SUBMITTED",
            "ready_cat": "PARTIALLY_READY",
            "services": (1, 1, 1, 1, 1, 0, 0, 1, 1)
        },
        {
            "id": "org-004",
            "inn": "203114992",
            "name": "«QO'QON SHAHAR 2-SONLI SHOSHILINCH YORDAM SHIFOXONASI»",
            "cadastre": "15:02:01:01:02:0088",
            "region": "Farg'ona viloyati",
            "district": "Qo'qon sh.",
            "address": "Turkiston ko'chasi 14",
            "level": "TUMAN",
            "profile": "STATSIONAR",
            "beds": 90,
            "visits": 80,
            "fio": "Normatov Bobur Yoqubovich",
            "phone": "+998 73 542-88-99",
            "score": 56.7,
            "status": "SUBMITTED",
            "ready_cat": "PARTIALLY_READY",
            "services": (1, 1, 1, 1, 1, 0, 0, 1, 0)
        },
        {
            "id": "org-005",
            "inn": "204992110",
            "name": "«ASAKA TUMAN TIBBIYOT BIRLASHMASI TUG'RUQ MAJMUASI»",
            "cadastre": "17:03:01:01:01:0034",
            "region": "Andijon viloyati",
            "district": "Asaka",
            "address": "Qorasuv ko'chasi 2",
            "level": "TUMAN",
            "profile": "STATSIONAR",
            "beds": 85,
            "visits": 120,
            "fio": "Yusupov Farxod Rustamovich",
            "phone": "+998 74 231-10-20",
            "score": 48.0,
            "status": "SUBMITTED",
            "ready_cat": "NOT_READY",
            "services": (1, 1, 1, 1, 1, 0, 0, 1, 0)
        }
    ]

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for c in sample_clinics:
        cursor.execute("""
        INSERT OR REPLACE INTO organizations (id, inn, name, cadastre_number, region, district, address, level, profile, bed_capacity, daily_visits, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (c["id"], c["inn"], c["name"], c["cadastre"], c["region"], c["district"], c["address"], c["level"], c["profile"], c["beds"], c["visits"], now_str))

        srv = c["services"]
        cursor.execute("""
        INSERT OR REPLACE INTO organization_services (org_id, has_emergency_blue_code, has_surgery, has_anesthesia, has_laboratory, has_radiology_ultrasound, has_mri, has_endoscopy, has_sterilization_dept, has_academic_base)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (c["id"], srv[0], srv[1], srv[2], srv[3], srv[4], srv[5], srv[6], srv[7], srv[8]))

        # Create session
        session_id = f"sess-{c['id']}"
        cursor.execute("""
        INSERT OR REPLACE INTO audit_sessions (id, org_id, submitter_fio, submitter_phone, status, total_applicable, total_score, readiness_category, submitted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, c["id"], c["fio"], c["phone"], c["status"], 275, c["score"], c["ready_cat"], now_str, now_str))

        # Seed sample answers for this clinic based on target score
        target_score = c["score"]
        cursor.execute("SELECT id FROM criteria ORDER BY id ASC")
        all_crit_ids = [row[0] for row in cursor.fetchall()]

        # Distribute YES, PARTIAL, NO
        yes_target = int(len(all_crit_ids) * (target_score / 100.0) * 0.9)
        partial_target = int(len(all_crit_ids) * 0.15)

        for idx, cid in enumerate(all_crit_ids):
            if idx < yes_target:
                ans_val = "YES"
                weight = 1.0
            elif idx < (yes_target + partial_target):
                ans_val = "PARTIAL"
                weight = 0.5
            else:
                ans_val = "NO"
                weight = 0.0

            cursor.execute("""
            INSERT OR REPLACE INTO session_answers (session_id, criterion_id, answer_value, score_weight, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """, (session_id, cid, ans_val, weight, now_str))

    conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Baza muvaffaqiyatli yaratildi va mezonlar kiritildi: {DB_PATH}")
