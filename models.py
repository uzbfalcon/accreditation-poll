"""
clamo.uz - Biznes Mantiq, Baholash Formulalari va Dinamik Qo'llanish Dvigateli
"""

from database import get_db_connection

# Applicability dependencies: standard_id -> service_column
STANDARD_SERVICE_RULES = {
    31: "has_sterilization_dept",
    32: "has_endoscopy",
    33: "has_surgery",
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

# Critical stop factors: (standard_id, criterion_number)
CRITICAL_STOP_FACTORS = [
    (16, 2),  # Zaxira elektr generatori
    (38, 1),  # Yuqori xavfli dorilar va konsentrlangan elektrolitlar
    (55, 4),  # Jarrohlik nazorat varag'i (Sign-in, Time-out, Sign-out)
    (58, 1)   # «Ko'k kod» 3 daqiqalik shoshilinch reanimatsiya
]


def lookup_inn_data(inn: str) -> dict:
    """Soliq bazasidan INN orqali korxona ma'lumotlarini olish (Simulyatsiya & Kesh)"""
    mock_db = {
        "304882190": {
            "name": "«SHIFO MED SERVIS KOP TARMOQLI KLINIKASI» MCHJ",
            "region": "Toshkent shahri",
            "district": "Yunusobod",
            "address": "Amir Temur ko'chasi, 12-uy",
            "status": "ACTIVE"
        },
        "305119284": {
            "name": "«AKFA MEDLINE RESPUBLIKA TIBBIYOT MARKAZI» MCHJ",
            "region": "Toshkent shahri",
            "district": "Olmazor",
            "address": "Kichik halqa yo'li 5-A",
            "status": "ACTIVE"
        },
        "305123456": {
            "name": "«CLAMO DIGITAL HEALTH SOLUTIONS» MCHJ",
            "region": "Toshkent shahri",
            "district": "Mirobod",
            "address": "Nukus ko'chasi 24-uy",
            "status": "ACTIVE"
        },
        "201994821": {
            "name": "«SAMARQAND VILOYAT BOLALAR KO'P TARMOQLI TIBBIYOT MARKAZI»",
            "region": "Samarqand viloyati",
            "district": "Samarqand sh.",
            "address": "Dahbed ko'chasi 45-uy",
            "status": "ACTIVE"
        },
        "203114992": {
            "name": "«QO'QON SHAHAR 2-SONLI SHOSHILINCH YORDAM SHIFOXONASI»",
            "region": "Farg'ona viloyati",
            "district": "Qo'qon sh.",
            "address": "Turkiston ko'chasi 14",
            "status": "ACTIVE"
        },
        "204992110": {
            "name": "«ASAKA TUMAN TIBBIYOT BIRLASHMASI TUG'RUQ MAJMUASI»",
            "region": "Andijon viloyati",
            "district": "Asaka",
            "address": "Qorasuv ko'chasi 2",
            "status": "ACTIVE"
        },
        "308221004": {
            "name": "«BUXORO KARVON SINO NEVROLOGIYA VA REABILITATSIYA» MCHJ",
            "region": "Buxoro viloyati",
            "district": "Buxoro sh.",
            "address": "Ibn Sino ko'chasi 18",
            "status": "ACTIVE"
        },
        "306771893": {
            "name": "«CHIRCHIQ MED STAR DIAGNOSTIKA MARKAZI» MCHJ",
            "region": "Toshkent viloyati",
            "district": "Chirchiq sh.",
            "address": "Navoiy shoh ko'chasi 7",
            "status": "ACTIVE"
        }
    }

    if inn in mock_db:
        data = mock_db[inn]
        return {"inn": inn, "found": True, **data}
    else:
        # Default algorithmic generation for any valid 9-digit INN
        return {
            "inn": inn,
            "found": True,
            "name": f"«TIBBIYOT DIAGNOSTIKA VA DAVOLASH #{inn[-4:]}» MCHJ",
            "region": "Toshkent shahri",
            "district": "Yunusobod",
            "address": "Markaziy shoh ko'cha 1-uy",
            "status": "ACTIVE"
        }


def calculate_session_score(session_id: str) -> dict:
    """
    Klinika sessiyasi bo'yicha 7 ta bo'lim va umumiy tayyorgarlik balini hisoblash.
    Formula: ((YES * 1.0) + (PARTIAL * 0.5)) / (Total - NA) * 100
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Fetch all criteria and answers for this session
    cursor.execute("""
    SELECT 
        c.id as criterion_id,
        c.standard_id,
        c.criterion_number,
        c.is_critical,
        s.domain_id,
        s.domain_name,
        sa.answer_value,
        sa.score_weight
    FROM criteria c
    JOIN standards s ON c.standard_id = s.id
    LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
    ORDER BY c.id ASC
    """, (session_id,))

    rows = cursor.fetchall()

    total_criteria = len(rows)
    yes_count = 0
    partial_count = 0
    no_count = 0
    na_count = 0

    domain_stats = {
        i: {
            "id": i,
            "name": "",
            "total": 0,
            "yes": 0,
            "partial": 0,
            "no": 0,
            "na": 0,
            "score": 0.0
        } for i in range(1, 8)
    }

    critical_violations = []

    for r in rows:
        d_id = r["domain_id"]
        domain_stats[d_id]["name"] = r["domain_name"]
        domain_stats[d_id]["total"] += 1

        ans = r["answer_value"]
        if ans == "YES":
            yes_count += 1
            domain_stats[d_id]["yes"] += 1
        elif ans == "PARTIAL":
            partial_count += 1
            domain_stats[d_id]["partial"] += 1
        elif ans == "NA":
            na_count += 1
            domain_stats[d_id]["na"] += 1
        else:
            # NO or UNANSWERED
            no_count += 1
            domain_stats[d_id]["no"] += 1

            # Check critical stop factors
            st_num = r["standard_id"]
            c_num = r["criterion_number"]
            if (st_num, c_num) in CRITICAL_STOP_FACTORS:
                critical_violations.append({
                    "standard_id": st_num,
                    "criterion_number": c_num,
                    "message": f"Standart #{st_num}, Mezon #{c_num}: Kritik xavfsizlik talabi bajarilmagan!"
                })

    # Calculate domain percentages
    for d_id, d_data in domain_stats.items():
        applicable = d_data["total"] - d_data["na"]
        if applicable > 0:
            points = (d_data["yes"] * 1.0) + (d_data["partial"] * 0.5)
            d_data["score"] = round((points / applicable) * 100, 1)
        else:
            d_data["score"] = 100.0

    applicable_total = total_criteria - na_count
    if applicable_total > 0:
        total_points = (yes_count * 1.0) + (partial_count * 0.5)
        total_percentage = round((total_points / applicable_total) * 100, 1)
    else:
        total_percentage = 0.0

    # Categorize
    if total_percentage >= 80.0 and len(critical_violations) == 0:
        category = "READY"
    elif total_percentage >= 55.0:
        category = "PARTIALLY_READY"
    else:
        category = "NOT_READY"

    # Update in database
    cursor.execute("""
    UPDATE audit_sessions
    SET 
        total_applicable = ?,
        criteria_yes = ?,
        criteria_partial = ?,
        criteria_no = ?,
        criteria_na = ?,
        total_score = ?,
        readiness_category = ?,
        has_critical_stop_factors = ?,
        updated_at = datetime('now')
    WHERE id = ?
    """, (
        applicable_total,
        yes_count,
        partial_count,
        no_count,
        na_count,
        total_percentage,
        category,
        1 if len(critical_violations) > 0 else 0,
        session_id
    ))
    conn.commit()
    conn.close()

    return {
        "session_id": session_id,
        "total_criteria": total_criteria,
        "applicable_criteria": applicable_total,
        "yes_count": yes_count,
        "partial_count": partial_count,
        "no_count": no_count,
        "na_count": na_count,
        "total_score": total_percentage,
        "readiness_category": category,
        "has_critical_stop_factors": len(critical_violations) > 0,
        "critical_violations": critical_violations,
        "domains": list(domain_stats.values())
    }
