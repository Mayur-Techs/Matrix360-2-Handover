import sqlite3
from datetime import datetime
from typing import List, Dict, Set

DB_PATH = "leads.db"

NEW_COLUMNS = {
    "niche": "TEXT DEFAULT ''",
    "location": "TEXT DEFAULT ''",
    "company_size": "TEXT DEFAULT ''",
    "phone": "TEXT DEFAULT ''",
    "phone_status": "TEXT DEFAULT ''",
    "email": "TEXT DEFAULT ''",
    "email_status": "TEXT DEFAULT ''",
    "website": "TEXT DEFAULT ''",
    "dm_name": "TEXT DEFAULT ''",
    "dm_role": "TEXT DEFAULT ''",
    "dm_linkedin": "TEXT DEFAULT ''",
    "dm_email": "TEXT DEFAULT ''",
    "instagram": "TEXT DEFAULT ''",
    "linkedin": "TEXT DEFAULT ''",
    "facebook": "TEXT DEFAULT ''",
    "twitter": "TEXT DEFAULT ''",
    "rating": "TEXT DEFAULT ''",
    "reviews": "TEXT DEFAULT ''",
    "address": "TEXT DEFAULT ''",
    "maps_url": "TEXT DEFAULT ''",
    "verdict": "TEXT DEFAULT 'REVIEW'",
    "confidence": "REAL DEFAULT 0.0",
    "facility_evidence": "TEXT DEFAULT ''",
    "source_url": "TEXT DEFAULT ''",
    "created_at": "TEXT DEFAULT ''"
}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            niche TEXT DEFAULT '',
            location TEXT DEFAULT '',
            company_size TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            phone_status TEXT DEFAULT '',
            email TEXT DEFAULT '',
            email_status TEXT DEFAULT '',
            website TEXT DEFAULT '',
            dm_name TEXT DEFAULT '',
            dm_role TEXT DEFAULT '',
            dm_linkedin TEXT DEFAULT '',
            dm_email TEXT DEFAULT '',
            instagram TEXT DEFAULT '',
            linkedin TEXT DEFAULT '',
            facebook TEXT DEFAULT '',
            twitter TEXT DEFAULT '',
            rating TEXT DEFAULT '',
            reviews TEXT DEFAULT '',
            address TEXT DEFAULT '',
            maps_url TEXT DEFAULT '',
            verdict TEXT DEFAULT 'REVIEW',
            confidence REAL DEFAULT 0.0,
            facility_evidence TEXT DEFAULT '',
            source_url TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cursor.execute("PRAGMA table_info(leads)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    for col_name, col_def in NEW_COLUMNS.items():
        if col_name not in existing_cols:
            try:
                cursor.execute(f"ALTER TABLE leads ADD COLUMN {col_name} {col_def}")
            except Exception:
                pass

    # Suppression table for sent, bounced, unsubscribed, and existing campaign contacts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS suppression_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            value TEXT UNIQUE NOT NULL,
            entry_type TEXT DEFAULT 'general',
            reason TEXT DEFAULT 'campaign_exclusion',
            created_at TEXT DEFAULT ''
        )
    """)

    conn.commit()
    conn.close()


def add_suppression_items(raw_items: List[str], reason: str = "campaign_exclusion") -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    added = 0
    for item in raw_items:
        clean = item.strip().lower()
        if not clean or len(clean) < 3:
            continue
        e_type = "email" if "@" in clean else ("phone" if any(c.isdigit() for c in clean) else "company_or_domain")
        if e_type == "phone":
            clean = "".join(ch for ch in clean if ch.isdigit())[-10:]
        try:
            cursor.execute(
                "INSERT OR IGNORE INTO suppression_list (value, entry_type, reason, created_at) VALUES (?, ?, ?, ?)",
                (clean, e_type, reason, now)
            )
            if cursor.rowcount > 0:
                added += 1
        except Exception:
            continue
    conn.commit()
    conn.close()
    return added


def get_suppression_set() -> Set[str]:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM suppression_list")
    suppressed = {row[0].strip().lower() for row in cursor.fetchall() if row[0]}

    # Also include already saved leads from database so we don't duplicate existing contacts
    cursor.execute("SELECT business_name, phone, email, dm_email, maps_url FROM leads")
    for b_name, phone, email, dm_email, m_url in cursor.fetchall():
        if b_name:
            suppressed.add(b_name.strip().lower())
        if phone:
            digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
            if len(digits) == 10:
                suppressed.add(digits)
        if email:
            for e in email.split(","):
                if e.strip():
                    suppressed.add(e.strip().lower())
        if dm_email:
            suppressed.add(dm_email.strip().lower())
        if m_url:
            suppressed.add(m_url.strip().lower())

    conn.close()
    return suppressed


def get_suppression_count() -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM suppression_list")
    count = cursor.fetchone()[0]
    conn.close()
    return count


def clear_suppression_list():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM suppression_list")
    conn.commit()
    conn.close()


def is_lead_suppressed(lead: Dict, suppressed_set: Set[str]) -> bool:
    name = (lead.get("business_name") or "").strip().lower()
    if name and name in suppressed_set:
        return True

    maps_url = (lead.get("maps_url") or "").strip().lower()
    if maps_url and maps_url in suppressed_set:
        return True

    phone = "".join(ch for ch in (lead.get("phone") or "") if ch.isdigit())[-10:]
    if len(phone) == 10 and phone in suppressed_set:
        return True

    for mail_field in ["email", "dm_email"]:
        val = (lead.get(mail_field) or "").strip().lower()
        for single_mail in val.split(","):
            s = single_mail.strip()
            if s and s in suppressed_set:
                return True
            if "@" in s and s.split("@")[-1] in suppressed_set:
                return True

    return False


def upsert_lead(lead: Dict) -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    business_name = lead.get("business_name", "").strip()
    phone = lead.get("phone", "").strip()
    maps_url = (lead.get("maps_url") or f"custom://{business_name}-{phone}").strip()

    cursor.execute(
        """
        SELECT id FROM leads
        WHERE (maps_url != '' AND maps_url = ?)
           OR (business_name = ? AND phone != '' AND phone = ?)
        LIMIT 1
        """,
        (maps_url, business_name, phone)
    )
    existing = cursor.fetchone()

    if existing:
        row_id = existing[0]
        cursor.execute(
            """
            UPDATE leads SET
                niche = CASE WHEN ? != '' THEN ? ELSE niche END,
                location = CASE WHEN ? != '' THEN ? ELSE location END,
                company_size = CASE WHEN ? != '' THEN ? ELSE company_size END,
                phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                phone_status = CASE WHEN ? != '' THEN ? ELSE phone_status END,
                email = CASE WHEN ? != '' THEN ? ELSE email END,
                email_status = CASE WHEN ? != '' THEN ? ELSE email_status END,
                website = CASE WHEN ? != '' THEN ? ELSE website END,
                dm_name = CASE WHEN ? != '' THEN ? ELSE dm_name END,
                dm_role = CASE WHEN ? != '' THEN ? ELSE dm_role END,
                dm_linkedin = CASE WHEN ? != '' THEN ? ELSE dm_linkedin END,
                dm_email = CASE WHEN ? != '' THEN ? ELSE dm_email END,
                instagram = CASE WHEN ? != '' THEN ? ELSE instagram END,
                linkedin = CASE WHEN ? != '' THEN ? ELSE linkedin END,
                facebook = CASE WHEN ? != '' THEN ? ELSE facebook END,
                twitter = CASE WHEN ? != '' THEN ? ELSE twitter END,
                rating = CASE WHEN ? != '' THEN ? ELSE rating END,
                reviews = CASE WHEN ? != '' THEN ? ELSE reviews END,
                address = CASE WHEN ? != '' THEN ? ELSE address END,
                maps_url = CASE WHEN ? != '' THEN ? ELSE maps_url END,
                verdict = CASE WHEN ? != '' THEN ? ELSE verdict END,
                confidence = CASE WHEN ? != 0.0 THEN ? ELSE confidence END,
                facility_evidence = CASE WHEN ? != '' THEN ? ELSE facility_evidence END,
                source_url = CASE WHEN ? != '' THEN ? ELSE source_url END
            WHERE id = ?
            """,
            (
                lead.get("niche", ""), lead.get("niche", ""),
                lead.get("location", ""), lead.get("location", ""),
                lead.get("company_size", ""), lead.get("company_size", ""),
                phone, phone,
                lead.get("phone_status", ""), lead.get("phone_status", ""),
                lead.get("email", ""), lead.get("email", ""),
                lead.get("email_status", ""), lead.get("email_status", ""),
                lead.get("website", ""), lead.get("website", ""),
                lead.get("dm_name", ""), lead.get("dm_name", ""),
                lead.get("dm_role", ""), lead.get("dm_role", ""),
                lead.get("dm_linkedin", ""), lead.get("dm_linkedin", ""),
                lead.get("dm_email", ""), lead.get("dm_email", ""),
                lead.get("instagram", ""), lead.get("instagram", ""),
                lead.get("linkedin", ""), lead.get("linkedin", ""),
                lead.get("facebook", ""), lead.get("facebook", ""),
                lead.get("twitter", ""), lead.get("twitter", ""),
                lead.get("rating", ""), lead.get("rating", ""),
                lead.get("reviews", ""), lead.get("reviews", ""),
                lead.get("address", ""), lead.get("address", ""),
                maps_url, maps_url,
                lead.get("verdict", "REVIEW"), lead.get("verdict", "REVIEW"),
                float(lead.get("confidence") or 0.0), float(lead.get("confidence") or 0.0),
                lead.get("facility_evidence", ""), lead.get("facility_evidence", ""),
                lead.get("source_url", ""), lead.get("source_url", ""),
                row_id
            )
        )
    else:
        cursor.execute(
            """
            INSERT INTO leads (
                business_name, niche, location, company_size,
                phone, phone_status, email, email_status, website,
                dm_name, dm_role, dm_linkedin, dm_email,
                instagram, linkedin, facebook, twitter,
                rating, reviews, address, maps_url,
                verdict, confidence, facility_evidence, source_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                business_name,
                lead.get("niche", ""),
                lead.get("location", ""),
                lead.get("company_size", ""),
                phone,
                lead.get("phone_status", ""),
                lead.get("email", ""),
                lead.get("email_status", ""),
                lead.get("website", ""),
                lead.get("dm_name", ""),
                lead.get("dm_role", ""),
                lead.get("dm_linkedin", ""),
                lead.get("dm_email", ""),
                lead.get("instagram", ""),
                lead.get("linkedin", ""),
                lead.get("facebook", ""),
                lead.get("twitter", ""),
                lead.get("rating", ""),
                lead.get("reviews", ""),
                lead.get("address", ""),
                maps_url,
                lead.get("verdict", "REVIEW"),
                float(lead.get("confidence") or 0.0),
                lead.get("facility_evidence", ""),
                lead.get("source_url", ""),
                now
            )
        )
        row_id = cursor.lastrowid

    conn.commit()
    conn.close()
    return row_id


def get_leads(
    has_email: bool = False,
    has_phone: bool = False,
    has_socials: bool = False,
    has_dm: bool = False,
    verdict: str = ""
) -> List[Dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = "SELECT * FROM leads WHERE 1=1"
    if has_email:
        query += " AND (email != '' OR dm_email != '')"
    if has_phone:
        query += " AND phone != ''"
    if has_dm:
        query += " AND (dm_name != '' OR dm_linkedin != '')"
    if has_socials:
        query += " AND (instagram != '' OR linkedin != '' OR facebook != '' OR twitter != '' OR dm_linkedin != '')"
    if verdict:
        query += f" AND verdict = '{verdict}'"

    query += " ORDER BY id DESC"
    cursor.execute(query)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def clear_leads():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM leads")
    conn.commit()
    conn.close()
