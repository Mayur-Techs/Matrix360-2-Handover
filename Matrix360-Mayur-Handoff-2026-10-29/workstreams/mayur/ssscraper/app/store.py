from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class JobStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self._connection() as con:
            con.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at REAL NOT NULL,
                updated_at REAL NOT NULL, payload TEXT NOT NULL, report_path TEXT, error TEXT
            )""")
            con.execute("""CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, created_at REAL NOT NULL,
                name TEXT NOT NULL, data TEXT NOT NULL
            )""")

    def _connection(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, check_same_thread=False)

    def create(self, job_id: str, payload: dict[str, Any]) -> None:
        now = time.time()
        with self.lock, self._connection() as con:
            con.execute("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, NULL, NULL)", (job_id, "QUEUED", now, now, json.dumps(payload)))

    def update(self, job_id: str, status: str, report_path: str | None = None, error: str | None = None) -> None:
        with self.lock, self._connection() as con:
            con.execute("UPDATE jobs SET status=?, updated_at=?, report_path=COALESCE(?, report_path), error=COALESCE(?, error) WHERE id=?", (status, time.time(), report_path, error, job_id))

    def event(self, job_id: str, name: str, data: dict[str, Any]) -> None:
        now = time.time()
        with self.lock, self._connection() as con:
            con.execute("INSERT INTO events(job_id, created_at, name, data) VALUES (?, ?, ?, ?)", (job_id, now, name, json.dumps(data)))

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._connection() as con:
            row = con.execute("SELECT id, status, created_at, updated_at, payload, report_path, error FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            events = con.execute("SELECT created_at, name, data FROM events WHERE job_id=? ORDER BY id DESC LIMIT 60", (job_id,)).fetchall()
        return {"id": row[0], "status": row[1], "created_at": row[2], "updated_at": row[3], "payload": json.loads(row[4]), "report_path": row[5], "error": row[6], "events": [{"created_at": item[0], "name": item[1], "data": json.loads(item[2])} for item in reversed(events)]}

    def recent(self) -> list[dict[str, Any]]:
        with self._connection() as con:
            ids = [row[0] for row in con.execute("SELECT id FROM jobs ORDER BY created_at DESC LIMIT 20")]
        return [job for job_id in ids if (job := self.get(job_id))]
