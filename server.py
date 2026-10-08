"""
clamo.uz - Tibbiyot Akkreditatsiyasi Backend Serveri
Python Standard Library (0-Dependency) asosida ishlovchi yuqori samarali REST API & Static Server.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import os
import re
import urllib.parse
import uuid
from datetime import datetime
import mimetypes

from database import get_db_connection, init_db
from models import lookup_inn_data, calculate_session_score, STANDARD_SERVICE_RULES

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")


class ClamoRequestHandler(BaseHTTPRequestHandler):

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def _send_json(self, data, status=200):
        self._set_headers(status, "application/json; charset=utf-8")
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            body = self.rfile.read(content_length).decode("utf-8")
            return json.loads(body)
        return {}

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        # ---------------------------------------------------------------------
        # STATIC FILES ROUTING
        # ---------------------------------------------------------------------
        if path == "/" or path == "/index.html":
            return self._serve_file(os.path.join(STATIC_DIR, "index.html"), "text/html")
        elif path == "/backoffice" or path == "/backoffice.html":
            return self._serve_file(os.path.join(STATIC_DIR, "backoffice.html"), "text/html")
        elif path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            file_path = os.path.join(STATIC_DIR, rel_path)
            if os.path.exists(file_path) and os.path.isfile(file_path):
                mime, _ = mimetypes.guess_type(file_path)
                return self._serve_file(file_path, mime or "application/octet-stream")

        # ---------------------------------------------------------------------
        # API 1: INN LOOKUP
        # ---------------------------------------------------------------------
        if path.startswith("/api/v1/organizations/lookup-inn/"):
            inn = path.split("/")[-1].strip()
            data = lookup_inn_data(inn)
            return self._send_json(data)

        # ---------------------------------------------------------------------
        # API 2: GET SESSION CHECKLIST (7 DOMAINS, 75 STANDARDS, 275 CRITERIA)
        # ---------------------------------------------------------------------
        if path.startswith("/api/v1/audit-sessions/") and path.endswith("/checklist"):
            parts = path.split("/")
            session_id = parts[4]
            return self._handle_get_checklist(session_id)

        # ---------------------------------------------------------------------
        # API 3: GET SESSION SCORE / PROGRESS
        # ---------------------------------------------------------------------
        if path.startswith("/api/v1/audit-sessions/") and path.endswith("/score"):
            parts = path.split("/")
            session_id = parts[4]
            score_data = calculate_session_score(session_id)
            return self._send_json(score_data)

        # ---------------------------------------------------------------------
        # BACKOFFICE API: SUMMARY KPI
        # ---------------------------------------------------------------------
        if path == "/api/v1/backoffice/dashboard/summary":
            return self._handle_backoffice_summary()

        # ---------------------------------------------------------------------
        # BACKOFFICE API: REGIONS BREAKDOWN
        # ---------------------------------------------------------------------
        if path == "/api/v1/backoffice/dashboard/regions-breakdown":
            sort_by = query_params.get("sort_by", ["score_desc"])[0]
            return self._handle_backoffice_regions(sort_by)

        # ---------------------------------------------------------------------
        # BACKOFFICE API: 7 DOMAINS BREAKDOWN
        # ---------------------------------------------------------------------
        if path == "/api/v1/backoffice/dashboard/domains-breakdown":
            return self._handle_backoffice_domains()

        # ---------------------------------------------------------------------
        # BACKOFFICE API: CLINICS REGISTRY (WITH FILTERS)
        # ---------------------------------------------------------------------
        if path == "/api/v1/backoffice/clinics":
            return self._handle_backoffice_clinics(query_params)

        # ---------------------------------------------------------------------
        # BACKOFFICE API: CLINIC AUDIT PASSPORT (DETAILS FOR MODAL & PDF)
        # ---------------------------------------------------------------------
        if path.startswith("/api/v1/backoffice/clinics/") and path.endswith("/audit-passport"):
            session_id = path.split("/")[5]
            return self._handle_clinic_passport(session_id)

        # ---------------------------------------------------------------------
        # BACKOFFICE API: EXCEL/CSV EXPORT
        # ---------------------------------------------------------------------
        if path == "/api/v1/backoffice/export-excel":
            return self._handle_export_csv()

        # Fallback 404
        self._send_json({"error": "Endpoint topilmadi", "path": path}, status=404)

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # INITIALIZE SESSION
        if path == "/api/v1/audit-sessions/initialize":
            body = self._read_json_body()
            return self._handle_session_initialize(body)

        # SUBMIT SESSION
        if path.startswith("/api/v1/audit-sessions/") and path.endswith("/submit"):
            parts = path.split("/")
            session_id = parts[4]
            return self._handle_session_submit(session_id)

        self._send_json({"error": "Endpoint topilmadi"}, status=404)

    def do_PATCH(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # SAVE ANSWER (AUTOSAVE)
        if path.startswith("/api/v1/audit-sessions/") and path.endswith("/save-answer"):
            parts = path.split("/")
            session_id = parts[4]
            body = self._read_json_body()
            return self._handle_save_answer(session_id, body)

        self._send_json({"error": "Endpoint topilmadi"}, status=404)

    def _serve_file(self, file_path, content_type):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self._set_headers(200, f"{content_type}; charset=utf-8")
            self.wfile.write(content)
        except Exception as e:
            self._send_json({"error": f"Faylni o'qishda xatolik: {str(e)}"}, status=500)

    # =========================================================================
    # BUSINESS HANDLERS
    # =========================================================================

    def _handle_session_initialize(self, data):
        """Boshlang'ich shakl (INN, Kadastr, FIO, xizmatlar) asosida sessiya yaratish"""
        conn = get_db_connection()
        cursor = conn.cursor()

        inn = data.get("inn", "305123456").strip()
        org_name = data.get("name", "").strip() or lookup_inn_data(inn)["name"]
        cadastre = data.get("cadastre_number", "")
        region = data.get("region", "Toshkent shahri")
        district = data.get("district", "Yunusobod")
        fio = data.get("submitter_fio", "Mas'ul Shaxs")
        phone = data.get("submitter_phone", "+998 71 200-00-00")
        level = data.get("level", "VILOYAT")
        profile = data.get("profile", "ARALASH")

        now = datetime.now()
        date_month_str = now.strftime("%d%m")
        session_id = f"{inn}-{date_month_str}"
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        # Upsert Organization
        cursor.execute("SELECT id FROM organizations WHERE inn = ?", (inn,))
        row = cursor.fetchone()
        if row:
            org_id = row[0]
            cursor.execute("""
            UPDATE organizations SET
                name = ?, cadastre_number = ?, region = ?, district = ?, level = ?, profile = ?
            WHERE id = ?
            """, (org_name, cadastre, region, district, level, profile, org_id))
        else:
            org_id = f"org-{inn}"
            cursor.execute("""
            INSERT INTO organizations (id, inn, name, cadastre_number, region, district, address, level, profile, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (org_id, inn, org_name, cadastre, region, district, f"{region}, {district}", level, profile, now_str))

        # Services
        srv = data.get("services", {})
        cursor.execute("""
        INSERT OR REPLACE INTO organization_services 
        (org_id, has_emergency_blue_code, has_surgery, has_anesthesia, has_laboratory, has_radiology_ultrasound, has_mri, has_endoscopy, has_sterilization_dept, has_academic_base)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            org_id,
            1 if srv.get("has_emergency_blue_code", True) else 0,
            1 if srv.get("has_surgery", True) else 0,
            1 if srv.get("has_anesthesia", True) else 0,
            1 if srv.get("has_laboratory", True) else 0,
            1 if srv.get("has_radiology_ultrasound", True) else 0,
            1 if srv.get("has_mri", False) else 0,
            1 if srv.get("has_endoscopy", True) else 0,
            1 if srv.get("has_sterilization_dept", True) else 0,
            1 if srv.get("has_academic_base", False) else 0,
        ))

        # Audit Session (Check if exists for this INN+date to resume)
        cursor.execute("SELECT id FROM audit_sessions WHERE id = ?", (session_id,))
        if not cursor.fetchone():
            cursor.execute("""
            INSERT INTO audit_sessions (id, org_id, submitter_fio, submitter_phone, status, total_applicable, total_score, readiness_category, updated_at)
            VALUES (?, ?, ?, ?, 'DRAFT', 275, 0.0, 'NOT_READY', ?)
            """, (session_id, org_id, fio, phone, now_str))
        else:
            cursor.execute("""
            UPDATE audit_sessions SET
                submitter_fio = ?, submitter_phone = ?, updated_at = ?
            WHERE id = ?
            """, (fio, phone, now_str, session_id))

        # Pre-fill N/A criteria based on services
        cursor.execute("SELECT * FROM organization_services WHERE org_id = ?", (org_id,))
        services_row = dict(cursor.fetchone())

        for st_id, srv_col in STANDARD_SERVICE_RULES.items():
            if services_row.get(srv_col, 0) == 0:
                # This service is disabled -> mark criteria as NA
                cursor.execute("SELECT id FROM criteria WHERE standard_id = ?", (st_id,))
                crit_ids = [c[0] for c in cursor.fetchall()]
                for cid in crit_ids:
                    cursor.execute("""
                    INSERT OR REPLACE INTO session_answers (session_id, criterion_id, answer_value, score_weight, updated_at)
                    VALUES (?, ?, 'NA', NULL, ?)
                    """, (session_id, cid, now_str))

        conn.commit()
        conn.close()

        score_data = calculate_session_score(session_id)

        self._send_json({
            "status": "INITIALIZED",
            "session_id": session_id,
            "org_id": org_id,
            "org_name": org_name,
            "score": score_data
        })

    def _handle_get_checklist(self, session_id):
        """75 ta standart va 275 ta mezonni, mavjud javoblar bilan birga yuklash"""
        conn = get_db_connection()
        cursor = conn.cursor()

        # Fetch session & org details
        cursor.execute("""
        SELECT s.*, o.name as org_name, o.inn as org_inn, o.region, o.district
        FROM audit_sessions s
        JOIN organizations o ON s.org_id = o.id
        WHERE s.id = ?
        """, (session_id,))
        session_row = cursor.fetchone()

        if not session_row:
            conn.close()
            return self._send_json({"error": "Sessiya topilmadi"}, status=404)

        # Fetch standards & criteria
        cursor.execute("""
        SELECT 
            st.id as standard_id,
            st.domain_id,
            st.domain_name,
            st.title as standard_title,
            st.applicability_condition,
            c.id as criterion_id,
            c.criterion_number,
            c.description as criterion_desc,
            c.is_critical,
            sa.answer_value,
            sa.note
        FROM standards st
        JOIN criteria c ON c.standard_id = st.id
        LEFT JOIN session_answers sa ON sa.criterion_id = c.id AND sa.session_id = ?
        ORDER BY st.domain_id, st.id, c.criterion_number
        """, (session_id,))

        rows = cursor.fetchall()
        conn.close()

        # Structure as hierarchical 7 domains -> standards -> criteria
        domains_dict = {}
        for r in rows:
            d_id = r["domain_id"]
            if d_id not in domains_dict:
                domains_dict[d_id] = {
                    "id": d_id,
                    "name": r["domain_name"],
                    "standards": {}
                }

            st_id = r["standard_id"]
            if st_id not in domains_dict[d_id]["standards"]:
                domains_dict[d_id]["standards"][st_id] = {
                    "id": st_id,
                    "title": r["standard_title"],
                    "applicability": r["applicability_condition"],
                    "criteria": []
                }

            domains_dict[d_id]["standards"][st_id]["criteria"].append({
                "id": r["criterion_id"],
                "number": r["criterion_number"],
                "description": re.sub(r'^\(?Стандарт\s+\d+\s+талаби\s+бўйича\s+\d+-мезон\)?[:\s]*', '', r["criterion_desc"] or "", flags=re.IGNORECASE).strip(),
                "is_critical": bool(r["is_critical"]),
                "answer": r["answer_value"] or "UNANSWERED",
                "note": r["note"] or ""
            })

        # Convert standards dicts to lists
        result_domains = []
        for d_id in sorted(domains_dict.keys()):
            domain_item = domains_dict[d_id]
            st_list = []
            for st_id in sorted(domain_item["standards"].keys()):
                st_list.append(domain_item["standards"][st_id])
            domain_item["standards"] = st_list
            result_domains.append(domain_item)

        score_data = calculate_session_score(session_id)

        self._send_json({
            "session": dict(session_row),
            "score": score_data,
            "domains": result_domains
        })

    def _handle_save_answer(self, session_id, body):
        """Real-time javobni saqlash"""
        criterion_id = body.get("criterion_id")
        answer_value = body.get("answer_value")  # YES, PARTIAL, NO, NA
        note = body.get("note", "")

        if not criterion_id or not answer_value:
            return self._send_json({"error": "criterion_id va answer_value majburiy"}, status=400)

        weight = 1.0 if answer_value == "YES" else (0.5 if answer_value == "PARTIAL" else 0.0)
        if answer_value == "NA":
            weight = None

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO session_answers (session_id, criterion_id, answer_value, score_weight, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, criterion_id) DO UPDATE SET
            answer_value = excluded.answer_value,
            score_weight = excluded.score_weight,
            note = excluded.note,
            updated_at = excluded.updated_at
        """, (session_id, criterion_id, answer_value, weight, note, now_str))
        conn.commit()
        conn.close()

        updated_score = calculate_session_score(session_id)
        self._send_json({
            "status": "SAVED",
            "criterion_id": criterion_id,
            "answer_value": answer_value,
            "score": updated_score
        })

    def _handle_session_submit(self, session_id):
        """So'rovnomani yakunlash va qulflash"""
        updated_score = calculate_session_score(session_id)

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE audit_sessions 
        SET status = 'SUBMITTED', submitted_at = datetime('now')
        WHERE id = ?
        """, (session_id,))
        conn.commit()
        conn.close()

        self._send_json({
            "status": "SUBMITTED",
            "message": "Akkreditatsiya arizasi muvaffaqiyatli qabul qilindi!",
            "final_score": updated_score
        })

    # =========================================================================
    # BACKOFFICE HANDLERS
    # =========================================================================

    def _handle_backoffice_summary(self):
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*), AVG(total_score) FROM audit_sessions WHERE status = 'SUBMITTED'")
        count_res = cursor.fetchone()
        total_submitted = count_res[0] or 0
        avg_score = round(count_res[1] or 0.0, 1)

        cursor.execute("SELECT COUNT(*) FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'READY'")
        ready_count = cursor.fetchone()[0] or 0

        cursor.execute("SELECT COUNT(*) FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'NOT_READY'")
        risk_count = cursor.fetchone()[0] or 0

        conn.close()

        self._send_json({
            "total_clinics": total_submitted,
            "avg_score": avg_score,
            "ready_clinics": ready_count,
            "risk_clinics": risk_count,
            "passing_threshold": 75.0
        })

    def _handle_backoffice_regions(self, sort_by):
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
        SELECT 
            o.region,
            COUNT(s.id) as count,
            AVG(s.total_score) as avg_score,
            SUM(CASE WHEN s.readiness_category = 'READY' THEN 1 ELSE 0 END) as ready_count
        FROM audit_sessions s
        JOIN organizations o ON s.org_id = o.id
        WHERE s.status = 'SUBMITTED'
        GROUP BY o.region
        """)
        rows = cursor.fetchall()
        conn.close()

        results = []
        for r in rows:
            results.append({
                "name": r["region"],
                "count": r["count"],
                "avgScore": round(r["avg_score"] or 0.0, 1),
                "ready": r["ready_count"]
            })

        if sort_by == "score_desc":
            results.sort(key=lambda x: x["avgScore"], reverse=True)
        elif sort_by == "count_desc":
            results.sort(key=lambda x: x["count"], reverse=True)
        else:
            results.sort(key=lambda x: x["name"])

        self._send_json(results)

    def _handle_backoffice_domains(self):
        """Milliy 7 ta yo'nalish bo'yicha o'rtacha natijalar"""
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT DISTINCT domain_id, domain_name FROM standards ORDER BY domain_id")
        domains = cursor.fetchall()

        # Calculate sample national score per domain
        base_scores = {
            1: 76.2, 2: 71.8, 3: 52.4, 4: 64.5, 5: 78.9, 6: 67.1, 7: 74.0
        }

        results = []
        for d in domains:
            d_id = d["domain_id"]
            results.append({
                "id": d_id,
                "name": d["domain_name"],
                "score": base_scores.get(d_id, 70.0),
                "is_weakest": d_id == 3
            })

        conn.close()
        self._send_json(results)

    def _handle_backoffice_clinics(self, params):
        region = params.get("region", ["all"])[0]
        district = params.get("district", ["all"])[0]
        level = params.get("level", ["all"])[0]
        status = params.get("status", ["all"])[0]
        search = params.get("search", [""])[0].lower().strip()

        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
        SELECT 
            s.id as session_id,
            s.status,
            s.total_score,
            s.readiness_category,
            s.criteria_yes,
            s.total_applicable,
            s.submitted_at,
            s.submitter_fio,
            s.submitter_phone,
            o.id as org_id,
            o.name,
            o.inn,
            o.region,
            o.district,
            o.level,
            o.profile,
            o.bed_capacity,
            o.daily_visits
        FROM audit_sessions s
        JOIN organizations o ON s.org_id = o.id
        WHERE 1=1
        """
        args = []

        if region != "all":
            query += " AND o.region = ?"
            args.append(region)
        if district != "all":
            query += " AND o.district = ?"
            args.append(district)
        if level != "all":
            query += " AND o.level = ?"
            args.append(level)
        if status != "all":
            if status == "ready":
                query += " AND s.readiness_category = 'READY'"
            elif status == "partial":
                query += " AND s.readiness_category = 'PARTIALLY_READY'"
            elif status == "risk":
                query += " AND s.readiness_category = 'NOT_READY'"

        query += " ORDER BY s.total_score DESC"
        cursor.execute(query, tuple(args))
        rows = cursor.fetchall()
        conn.close()

        filtered = []
        for r in rows:
            name = r["name"].lower()
            inn = r["inn"]
            fio = (r["submitter_fio"] or "").lower()

            if search:
                if search not in name and search not in inn and search not in fio:
                    continue

            filtered.append({
                "session_id": r["session_id"],
                "org_id": r["org_id"],
                "name": r["name"],
                "inn": r["inn"],
                "region": r["region"],
                "district": r["district"],
                "level": r["level"],
                "profile": r["profile"],
                "capacity": f"{r['bed_capacity']} o'rin • {r['daily_visits']} qabul",
                "responsible": r["submitter_fio"],
                "phone": r["submitter_phone"],
                "criteriaDone": r["criteria_yes"],
                "totalCriteria": r["total_applicable"],
                "score": r["total_score"],
                "status": "ready" if r["readiness_category"] == "READY" else ("partial" if r["readiness_category"] == "PARTIALLY_READY" else "risk"),
                "date": r["submitted_at"] or "2026-10-06"
            })

        self._send_json(filtered)

    def _handle_clinic_passport(self, session_id):
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
        SELECT s.*, o.name, o.inn, o.cadastre_number, o.region, o.district, o.address, o.level, o.profile, o.bed_capacity, o.daily_visits
        FROM audit_sessions s
        JOIN organizations o ON s.org_id = o.id
        WHERE s.id = ?
        """, (session_id,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return self._send_json({"error": "Klinika topilmadi"}, status=404)

        score_data = calculate_session_score(session_id)

        self._send_json({
            "clinic": dict(row),
            "score": score_data
        })

    def _handle_export_csv(self):
        """Excel/CSV yuklab olish"""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT o.name, o.inn, o.region, o.district, o.level, s.total_score, s.readiness_category, s.submitted_at
        FROM audit_sessions s
        JOIN organizations o ON s.org_id = o.id
        ORDER BY s.total_score DESC
        """)
        rows = cursor.fetchall()
        conn.close()

        csv_content = "Tashkilot Nomi,INN,Viloyat,Tuman,Daraja,Tayyorgarlik Bali (%),Holati,Topshirilgan Sana\n"
        for r in rows:
            csv_content += f'"{r["name"]}",{r["inn"]},{r["region"]},{r["district"]},{r["level"]},{r["total_score"]}%,{r["readiness_category"]},{r["submitted_at"]}\n'

        self._set_headers(200, "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="clamo_accreditation_clinics.csv"')
        self.wfile.write(csv_content.encode("utf-8-sig"))


def run():
    init_db()
    server_address = ("", PORT)
    httpd = ThreadingHTTPServer(server_address, ClamoRequestHandler)
    print("=" * 70)
    print(f"🚀 clamo.uz Server ishga tushdi: http://localhost:{PORT}")
    print(f"🏥 Klinika Portali:    http://localhost:{PORT}/")
    print(f"📊 Backoffice Paneli:   http://localhost:{PORT}/backoffice")
    print("=" * 70)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer to'xtatildi.")


if __name__ == "__main__":
    run()
