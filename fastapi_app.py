"""
clamo.uz - Production FastAPI Application (Enterprise Reference Implementation)
Ishga tushirish: uvicorn fastapi_app:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import os

from database import get_db_connection, init_db
from models import lookup_inn_data, calculate_session_score, STANDARD_SERVICE_RULES

app = FastAPI(
    title="clamo.uz Medical Accreditation API",
    description="75 ta standart va 275 ta mezon asosidagi tibbiyot akkreditatsiyasi tizimi API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Models
class InitializeSessionRequest(BaseModel):
    inn: str = Field(..., min_length=9, max_length=9)
    name: Optional[str] = None
    cadastre_number: Optional[str] = None
    region: str = "Toshkent shahri"
    district: str = "Yunusobod"
    level: str = "VILOYAT"
    profile: str = "ARALASH"
    submitter_fio: str
    submitter_phone: str
    services: Dict[str, bool] = Field(default_factory=dict)

class SaveAnswerRequest(BaseModel):
    criterion_id: int
    answer_value: str = Field(..., regex="^(YES|PARTIAL|NO|NA)$")
    note: Optional[str] = ""

@app.on_event("startup")
def startup_event():
    init_db()

# Static routes
@app.get("/", include_in_schema=False)
def get_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/backoffice", include_in_schema=False)
def get_backoffice():
    return FileResponse(os.path.join(STATIC_DIR, "backoffice.html"))

# API Endpoints
@app.get("/api/v1/organizations/lookup-inn/{inn}")
def lookup_inn(inn: str):
    return lookup_inn_data(inn)

@app.post("/api/v1/audit-sessions/initialize")
def initialize_session(req: InitializeSessionRequest):
    # Same business logic as server.py
    import uuid
    from datetime import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    org_id = f"org-{uuid.uuid4().hex[:8]}"
    session_id = f"sess-{uuid.uuid4().hex[:8]}"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    org_name = req.name or lookup_inn_data(req.inn)["name"]

    cursor.execute("""
    INSERT OR REPLACE INTO organizations (id, inn, name, cadastre_number, region, district, address, level, profile, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (org_id, req.inn, org_name, req.cadastre_number, req.region, req.district, f"{req.region}, {req.district}", req.level, req.profile, now_str))

    cursor.execute("""
    INSERT INTO audit_sessions (id, org_id, submitter_fio, submitter_phone, status, total_applicable, total_score, readiness_category, updated_at)
    VALUES (?, ?, ?, ?, 'DRAFT', 275, 0.0, 'NOT_READY', ?)
    """, (session_id, org_id, req.submitter_fio, req.submitter_phone, now_str))

    conn.commit()
    conn.close()
    score_data = calculate_session_score(session_id)
    return {"status": "INITIALIZED", "session_id": session_id, "org_id": org_id, "org_name": org_name, "score": score_data}

@app.get("/api/v1/audit-sessions/{session_id}/checklist")
def get_checklist(session_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_sessions WHERE id = ?", (session_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Sessiya topilmadi")
    conn.close()
    return calculate_session_score(session_id)

@app.patch("/api/v1/audit-sessions/{session_id}/save-answer")
def save_answer(session_id: str, req: SaveAnswerRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    weight = 1.0 if req.answer_value == "YES" else (0.5 if req.answer_value == "PARTIAL" else 0.0)
    cursor.execute("""
    INSERT INTO session_answers (session_id, criterion_id, answer_value, score_weight, note, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, criterion_id) DO UPDATE SET
        answer_value = excluded.answer_value,
        score_weight = excluded.score_weight,
        note = excluded.note,
        updated_at = excluded.updated_at
    """, (session_id, req.criterion_id, req.answer_value, weight, req.note))
    conn.commit()
    conn.close()
    score = calculate_session_score(session_id)
    return {"status": "SAVED", "score": score}

@app.get("/api/v1/backoffice/dashboard/summary")
def get_summary():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*), AVG(total_score) FROM audit_sessions WHERE status = 'SUBMITTED'")
    row = cursor.fetchone()
    total = row[0] or 0
    avg_score = round(row[1] or 0.0, 1)
    cursor.execute("SELECT COUNT(*) FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'READY'")
    ready = cursor.fetchone()[0] or 0
    cursor.execute("SELECT COUNT(*) FROM audit_sessions WHERE status = 'SUBMITTED' AND readiness_category = 'NOT_READY'")
    risk = cursor.fetchone()[0] or 0
    conn.close()
    return {"total_clinics": total, "avg_score": avg_score, "ready_clinics": ready, "risk_clinics": risk}
