"""
TaskFlow — Flask + SQLite Backend
=================================

Sign-in is by e-mail address. Every team member (admins included) is tracked
in the performance analytics endpoint. Admins are Tarun, Animesh and Kuldeep.

Default credentials (change on first login via /api/change-password):

    <first-name>@2026     e.g.  Debraj@2026, Kuldeep@2026, Tarun@2026 …

Authorisation is enforced server-side on every mutation:
  * employees can only read/update tasks assigned to them,
  * admins can read/update everything,
  * password reset for another user is admin-only.
No route trusts a client-supplied user id — the acting identity is always
taken from the signed session cookie.
"""

from __future__ import annotations
from dotenv import load_dotenv

load_dotenv()

import os
import hashlib
import html
import json
import psycopg2
import threading
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from functools import wraps
import time

from flask import Flask, g, jsonify, request, send_from_directory, session
from psycopg2.extras import RealDictCursor
# ─── App setup ──────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("TASKFLOW_SECRET", "taskflow-secret-2026-xK9#mP2")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set.")

# ─── Team roster (single source of truth) ───────────────────────────────────
# Order matters only for the seed IDs (u1…uN). Admins first, then employees.
# Passwords follow the pattern "<FirstName>@2026" and can be changed later.

ADMIN_EMAILS = {
    "kuldeep.ceo@scalefoxmedia.com",
    "animesh.coo@scalefoxmedia.com",
    "goeltarun15@gmail.com",
}

ROSTER = [
    # (full name, email, initials, colour)
    ("Kuldeep Singh",  "kuldeep.ceo@scalefoxmedia.com", "KS", "#6366f1"),
    ("Animesh Singh",  "animesh.coo@scalefoxmedia.com", "AS", "#4f8ef7"),
    ("Tarun Goel",     "goeltarun15@gmail.com",         "TG", "#8b5cf6"),
    ("Debraj",         "debraj1849@gmail.com",          "DE", "#ec4899"),
    ("Mohd Hamdan",    "mhamdan.contact@gmail.com",     "MH", "#f59e0b"),
    ("Shipra Goel",    "shipragoel2005@gmail.com",      "SG", "#22c55e"),
    ("Suyash Pandey",  "psuyash241@gmail.com",          "SP", "#ef4444"),
    ("Daksh Arora",    "daksharora3102@gmail.com",      "DA", "#14b8a6"),
    ("Aryan Mittal",   "aryanmittal203@gmail.com",      "AM", "#f97316"),
    ("Kanishk Kumar",  "kanishkkumar7325@gmail.com",    "KK", "#a855f7"),
    ("Harsh Gupta",    "guptaharsh0922@gmail.com",      "HG", "#0ea5e9"),
    ("Avani Sharma",   "work.ugcavani@gmail.com",       "AV", "#f43f5e"),
]

# ─── n8n webhook integration ────────────────────────────────────────────────
# Every task assignment (to any team member) is pushed to n8n so downstream
# automations (WhatsApp/email/Slack notifications, logging, etc.) can react.
#
# Set TASKFLOW_N8N_ENV=test to use the n8n "test" webhook (only works while a
# workflow is actively listening in the n8n editor). Defaults to the
# production webhook, which is always on.

N8N_TEST_URL       = "https://intellifytechnology.app.n8n.cloud/webhook-test/dfa5567a-440c-4cc7-bdc1-3f2eb847f078"
N8N_PRODUCTION_URL = "https://intellifytechnology.app.n8n.cloud/webhook/dfa5567a-440c-4cc7-bdc1-3f2eb847f078"

N8N_WEBHOOK_URL = os.environ.get("N8N_WEBHOOK_URL") or (
    N8N_TEST_URL if os.environ.get("TASKFLOW_N8N_ENV", "").lower() == "test" else N8N_PRODUCTION_URL
)


def _post_webhook(url: str, payload: dict) -> None:
    """Blocking POST, meant to be run on a background thread so a slow/unreachable
    n8n instance never delays or breaks the API response to the browser."""
    try:
        body = json.dumps(
            payload,
            default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o)
        ).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        print(f"[n8n webhook] delivery failed: {exc}")


def notify_n8n_task_assigned(task: dict, assignee_row: dict, assigner_row: dict) -> None:
    """Fire the webhook whenever a task is assigned to any team member."""
    payload = {
        "event": "task_assigned",
        "taskId": task["id"],
        "title": task["title"],
        "description": task["description"],
        "priority": task["priority"],
        "status": task["status"],
        "dueDate": task["dueDate"],
        "category": task["category"],
        "assignedTo": {
            "id": assignee_row["id"],
            "name": assignee_row["name"],
            "email": assignee_row["email"],
            "role": assignee_row["role"],
        },
        "assignedBy": {
            "id": assigner_row["id"],
            "name": assigner_row["name"],
            "email": assigner_row["email"],
            "role": assigner_row["role"],
        },
        "createdAt": (
            task["createdAt"].isoformat() + "Z"
            if task["createdAt"] is not None
            else None
        ),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    threading.Thread(
        target=_post_webhook,
        args=(N8N_WEBHOOK_URL, payload),
        daemon=True,
    ).start()


def _default_password(full_name: str) -> str:
    """Deterministic first-login password: `<FirstName>@2026`."""
    first = full_name.strip().split()[0]
    return f"{first}@2026"


_COLOR_PALETTE = [
    "#6366f1", "#4f8ef7", "#8b5cf6", "#ec4899", "#f59e0b", "#22c55e",
    "#ef4444", "#14b8a6", "#f97316", "#a855f7", "#0ea5e9", "#f43f5e",
]


def _make_initials(name: str) -> str:
    parts = name.strip().split()
    return ("".join(p[0] for p in parts[:2]).upper()) or "??"

# ─── DB helpers ─────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = psycopg2.connect(
            DATABASE_URL,
            cursor_factory=RealDictCursor
        )
        g.db.autocommit = False
    return g.db

@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        try:
            db.close()
        except Exception:
            pass
        
def query(sql: str, args: tuple = (), one: bool = False):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(sql, args)
    rows = cur.fetchall()
    cur.close()
    return (rows[0] if rows else None) if one else rows

def mutate(sql: str, args: tuple = ()) -> int:
    db = get_db()
    cur = db.cursor()
    cur.execute(sql, args)
    db.commit()

    lastrowid = None
    try:
        if cur.description:
            row = cur.fetchone()
            if row:
                lastrowid = list(row.values())[0]
    except Exception:
        pass

    cur.close()
    return lastrowid

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()

# ─── DB init & seed ─────────────────────────────────────────────────────────

def init_db() -> None:
    db = psycopg2.connect(
        DATABASE_URL,
        cursor_factory=RealDictCursor
    )
    cur = db.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            initials TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin','employee')),
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            color TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            assigned_by TEXT NOT NULL,
            assigned_to TEXT NOT NULL,
            priority TEXT NOT NULL DEFAULT 'medium',
            status TEXT NOT NULL DEFAULT 'pending',
            due_date TEXT,
            category TEXT DEFAULT 'General',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_to) REFERENCES users(id),
            FOREIGN KEY (assigned_by) REFERENCES users(id)
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS task_updates (
            id SERIAL PRIMARY KEY,
            task_id TEXT NOT NULL,
            updated_by TEXT NOT NULL,
            message TEXT NOT NULL,
            old_status TEXT,
            new_status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (updated_by) REFERENCES users(id)
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS activity_log (
            id SERIAL PRIMARY KEY,
            icon TEXT,
            color TEXT,
            icon_color TEXT,
            text TEXT NOT NULL,
            via_wa BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    db.commit()

    cur.execute("SELECT COUNT(*) AS c FROM users")
    existing = cur.fetchone()["c"]

    if existing == 0:
        for idx, (name, email, initials, color) in enumerate(ROSTER, start=1):
            email_l = email.strip().lower()
            role = "admin" if email_l in {e.lower() for e in ADMIN_EMAILS} else "employee"

            cur.execute("""
                INSERT INTO users
                (id, name, initials, role, email, password, color)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                f"u{idx}",
                name,
                initials,
                role,
                email_l,
                hash_pw(_default_password(name)),
                color,
            ))

        db.commit()
        print(f"✅ Seeded {len(ROSTER)} users.")

    cur.close()
    db.close()

# ─── Auth decorators ────────────────────────────────────────────────────────

def _current_active_user():
    """Session user's row if their account is still active, else None.

    Also clears the session if the account was deactivated, so a removed
    user's existing session stops working immediately — not just their
    next login attempt.
    """
    uid = session.get("user_id")
    if not uid:
        return None

    user = query("SELECT * FROM users WHERE id=%s", (uid,), one=True)

    if not user or not user["is_active"]:
        session.clear()
        return None

    return user


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Not authenticated"}), 401

        if not _current_active_user():
            return jsonify({"error": "Your account has been deactivated"}), 401

        return f(*args, **kwargs)

    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Not authenticated"}), 401

        if not _current_active_user():
            return jsonify({"error": "Your account has been deactivated"}), 401

        if session.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403

        return f(*args, **kwargs)

    return decorated


def _public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "name": u["name"],
        "initials": u["initials"],
        "role": u["role"],
        "color": u["color"],
        "email": u["email"],
    }


# ─── Auth routes ────────────────────────────────────────────────────────────

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}

    # Accept either `email` or legacy `username` field for backward compat.
    email = (data.get("email") or data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = query("SELECT * FROM users WHERE email=%s", (email,), one=True)

    if not user or user["password"] != hash_pw(password):
        return jsonify({"error": "Invalid email or password"}), 401

    if not user["is_active"]:
        return jsonify({"error": "This account has been removed. Contact an admin."}), 401

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session["name"] = user["name"]

    return jsonify(_public_user(user))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me():
    user = query("SELECT * FROM users WHERE id=%s", (session["user_id"],), one=True)

    if not user:
        session.clear()
        return jsonify({"error": "Not authenticated"}), 401

    return jsonify(_public_user(user))

# ─── Users routes ───────────────────────────────────────────────────────────

@app.get("/api/users")
@login_required
def get_users():
    rows = query("""
    SELECT
        id, name, initials, role, color, email
    FROM users
    WHERE is_active = TRUE
    ORDER BY name
""")
    out = []
    for u in rows:
        stats = query("SELECT status FROM tasks WHERE assigned_to=%s", (u["id"],))
        total  = len(stats)
        done   = sum(1 for t in stats if t["status"] == "completed")
        active = sum(1 for t in stats if t["status"] == "in_progress")
        out.append({
            **_public_user(u),
            "taskCount":  total,
            "doneCount":  done,
            "activeCount": active,
            "pct": round(done / total * 100) if total else 0,
        })
    return jsonify(out)

# ─── Admin: team management (add / remove members) ─────────────────────────

@app.get("/api/admin/team")
@admin_required
def admin_team():
    """Full roster including removed members, for the Manage Team panel."""
    rows = query(
        "SELECT id,name,initials,role,color,email,is_active FROM users ORDER BY "
        "is_active DESC, CASE role WHEN 'admin' THEN 0 ELSE 1 END, name"
    )
    return jsonify([{**_public_user(r), "isActive": bool(r["is_active"])} for r in rows])

@app.post("/api/admin/users")
@admin_required
def admin_add_user():
    data     = request.get_json(silent=True) or {}
    name     = (data.get("name") or "").strip()
    email    = (data.get("email") or "").strip().lower()
    role     = data.get("role") or "employee"
    password = (data.get("password") or "").strip()

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not email or "@" not in email:
        return jsonify({"error": "A valid email is required"}), 400
    if role not in {"admin", "employee"}:
        return jsonify({"error": "Invalid role"}), 400

    if query("SELECT id FROM users WHERE email=%s", (email,), one=True):
        return jsonify({"error": "A user with this email already exists"}), 400

    pw = password if len(password) >= 6 else _default_password(name)

    # Generate a unique uN id, continuing the existing numbering scheme.
    count  = query("SELECT COUNT(*) AS c FROM users", one=True)["c"]
    new_id = f"u{count+1}"
    while query("SELECT id FROM users WHERE id=%s", (new_id,), one=True):
        count += 1
        new_id = f"u{count+1}"

    initials = _make_initials(name)
    color    = _COLOR_PALETTE[count % len(_COLOR_PALETTE)]

    mutate(
    "INSERT INTO users (id,name,initials,role,email,password,color,is_active) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,TRUE)",
        (new_id, name, initials, role, email, hash_pw(pw), color),
    )
    log_activity(
        "ti-user-plus", "rgba(34,197,94,0.15)", "#22c55e",
        f"<strong>{html.escape(session['name'])}</strong> added "
        f"<strong>{html.escape(name)}</strong> to the team",
    )

    user = query("SELECT * FROM users WHERE id=%s", (new_id,), one=True)
    return jsonify({**_public_user(user), "tempPassword": pw}), 201

@app.delete("/api/admin/users/<user_id>")
@admin_required
def admin_remove_user(user_id):
    if user_id == session["user_id"]:
        return jsonify({"error": "You cannot remove yourself"}), 400

    target = query("SELECT * FROM users WHERE id=%s", (user_id,), one=True)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if not target["is_active"]:
        return jsonify({"error": "User is already removed"}), 400

    if target["role"] == "admin":
        active_admins = query(
            "SELECT COUNT(*) AS c FROM users WHERE role='admin' AND is_active=1", one=True
        )["c"]
        if active_admins <= 1:
            return jsonify({"error": "Cannot remove the last remaining admin"}), 400

    # Soft delete: keeps existing tasks/history intact and correctly attributed,
    # but the account can no longer log in (checked in login_required/admin_required
    # and in /api/login) and drops out of assignee lists and analytics.
    mutate("UPDATE users SET is_active=FALSE WHERE id=%s", (user_id,))
    log_activity(
        "ti-user-minus", "rgba(239,68,68,0.15)", "#ef4444",
        f"<strong>{html.escape(session['name'])}</strong> removed "
        f"<strong>{html.escape(target['name'])}</strong> from the team",
    )
    return jsonify({"ok": True})

@app.post("/api/admin/users/<user_id>/restore")
@admin_required
def admin_restore_user(user_id):
    target = query("SELECT * FROM users WHERE id=%s", (user_id,), one=True)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if target["is_active"]:
        return jsonify({"error": "User is already active"}), 400

    mutate("UPDATE users SET is_active=TRUE WHERE id=%s", (user_id,))
    log_activity(
        "ti-user-check", "rgba(34,197,94,0.15)", "#22c55e",
        f"<strong>{html.escape(session['name'])}</strong> restored "
        f"<strong>{html.escape(target['name'])}</strong> to the team",
    )
    return jsonify({"ok": True})

def _serialize_task(t: dict, updates: list) -> dict:
    return {
        "id": t["id"], "title": t["title"], "description": t["description"],
        "assignedBy": t["assigner_name"], "assignedTo": t["assignee_name"],
        "assignedToId": t["assigned_to"],
        "assigneeInitials": t["assignee_initials"], "assigneeColor": t["assignee_color"],
        "priority": t["priority"], "status": t["status"],
        "dueDate": t["due_date"], "category": t["category"],
        "createdAt": t["created_at"],
        "updates": [{
            "by": u["updater_name"], "msg": u["message"],
            "oldStatus": u["old_status"], "newStatus": u["new_status"],
            "time": u["created_at"],
        } for u in updates],
    }

_TASK_SELECT = """
    SELECT t.*,
           u1.name AS assignee_name, u1.initials AS assignee_initials, u1.color AS assignee_color,
           u2.name AS assigner_name
    FROM tasks t
    JOIN users u1 ON t.assigned_to = u1.id
    JOIN users u2 ON t.assigned_by = u2.id
"""

@app.get("/api/tasks")
@login_required
def get_tasks():
    uid  = session["user_id"]
    role = session["role"]

    if role == "admin":
        rows = query(_TASK_SELECT + " ORDER BY t.created_at DESC, t.id DESC")
    else:
        rows = query(_TASK_SELECT + " WHERE t.assigned_to = %s ORDER BY t.created_at DESC, t.id DESC", (uid,))

    tasks = []
    for t in rows:
        updates = query("""
            SELECT tu.*, u.name AS updater_name
            FROM task_updates tu
            JOIN users u ON tu.updated_by = u.id
            WHERE tu.task_id = %s
            ORDER BY tu.created_at DESC, tu.id DESC
        """, (t["id"],))
        tasks.append(_serialize_task(t, updates))
    return jsonify(tasks)

@app.post("/api/tasks")
@admin_required
def create_task():
    start = time.perf_counter()

    data     = request.get_json(silent=True) or {}
    title    = (data.get("title") or "").strip()
    desc     = (data.get("description") or "").strip()
    assignee = data.get("assignedTo")
    priority = data.get("priority") or "medium"
    due      = data.get("dueDate")
    category = data.get("category") or "General"

    if priority not in {"low", "medium", "high"}:
        return jsonify({"error": "Invalid priority"}), 400
    if not title:
        return jsonify({"error": "Title required"}), 400
    if not assignee:
        return jsonify({"error": "Assignee required"}), 400

    user = query("SELECT * FROM users WHERE id=%s", (assignee,), one=True)
    if not user:
        return jsonify({"error": "Unknown assignee"}), 400
    if not user["is_active"]:
        return jsonify({"error": "That team member has been removed"}), 400

    # print(f"[TIME] Validation: {time.perf_counter() - start:.3f}s")

    # Generate a unique Task-XXX id.
    count = query("SELECT COUNT(*) AS c FROM tasks", one=True)["c"]
    task_id = f"Task-{count+1:03d}"
    while query("SELECT id FROM tasks WHERE id=%s", (task_id,), one=True):
        count += 1
        task_id = f"Task-{count+1:03d}"

    # print(f"[TIME] Task ID: {time.perf_counter() - start:.3f}s")

    mutate(
        "INSERT INTO tasks (id,title,description,assigned_by,assigned_to,priority,status,due_date,category) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (task_id, title, desc or "No description provided.",
         session["user_id"], assignee, priority, "pending", due, category),
    )

    # print(f"[TIME] Insert: {time.perf_counter() - start:.3f}s")

    log_activity(
        "ti-plus", "rgba(79,142,247,0.15)", "#4f8ef7",
        f"<strong>{html.escape(session['name'])}</strong> assigned "
        f"<strong>{task_id}</strong> to {html.escape(user['name'])}",
        via_wa=True,
    )

    # print(f"[TIME] Log Activity: {time.perf_counter() - start:.3f}s")

    task = query(_TASK_SELECT + " WHERE t.id=%s", (task_id,), one=True)

    updates = query("""
        SELECT tu.*, u.name AS updater_name
        FROM task_updates tu
        JOIN users u ON tu.updated_by = u.id
        WHERE tu.task_id = %s
        ORDER BY tu.created_at DESC, tu.id DESC
    """, (task_id,))

    # print(f"[TIME] Fetch Task: {time.perf_counter() - start:.3f}s")

    serialized = _serialize_task(task, updates)

    assigner_row = query(
        "SELECT * FROM users WHERE id=%s",
        (session["user_id"],),
        one=True
    )

    # print(f"[TIME] Before Webhook: {time.perf_counter() - start:.3f}s")

    notify_n8n_task_assigned(serialized, user, assigner_row)

    # print(f"[TIME] Total Request: {time.perf_counter() - start:.3f}s")

    return jsonify(serialized), 201

@app.delete("/api/tasks/<task_id>")
@admin_required
def delete_task(task_id):
    t = query("SELECT * FROM tasks WHERE id=%s", (task_id,), one=True)
    if not t:
        return jsonify({"error": "Task not found"}), 404
    mutate("DELETE FROM task_updates WHERE task_id=%s", (task_id,))
    mutate("DELETE FROM tasks WHERE id=%s", (task_id,))
    log_activity(
        "ti-trash", "rgba(239,68,68,0.15)", "#ef4444",
        f"<strong>{html.escape(session['name'])}</strong> deleted {task_id}",
    )
    return jsonify({"ok": True})

@app.post("/api/tasks/<task_id>/update")
@login_required
def update_task(task_id):
    data    = request.get_json(silent=True) or {}
    status  = data.get("status")
    message = (data.get("message") or "").strip()

    if not message:
        return jsonify({"error": "Update message required"}), 400
    if status and status not in {"pending", "in_progress", "completed"}:
        return jsonify({"error": "Invalid status"}), 400

    t = query("SELECT * FROM tasks WHERE id=%s", (task_id,), one=True)
    if not t:
        return jsonify({"error": "Task not found"}), 404

    # Only the assignee (or an admin) may update a task.
    if session["role"] != "admin" and t["assigned_to"] != session["user_id"]:
        return jsonify({"error": "Forbidden"}), 403

    old_status = t["status"]
    new_status = status or old_status
    mutate("UPDATE tasks SET status=%s WHERE id=%s", (new_status, task_id))
    mutate(
        "INSERT INTO task_updates (task_id,updated_by,message,old_status,new_status) VALUES (%s,%s,%s,%s,%s)",
        (task_id, session["user_id"], message, old_status, new_status),
    )
    log_activity(
        "ti-message", "rgba(34,197,94,0.15)", "#22c55e",
        f"<strong>{html.escape(session['name'])}</strong> updated "
        f"<strong>{task_id}</strong>: {html.escape(message[:60])}",
        via_wa=True,
    )
    return jsonify({"ok": True, "newStatus": new_status})

# ─── Activity ───────────────────────────────────────────────────────────────

@app.get("/api/activity")
@login_required
def get_activity():
    rows = query("SELECT * FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 50")
    return jsonify([{
        "id": r["id"], "icon": r["icon"], "color": r["color"],
        "iconColor": r["icon_color"], "text": r["text"],
        "viaWa": bool(r["via_wa"]), "time": r["created_at"],
    } for r in rows])

def log_activity(icon, color, icon_color, text, via_wa=False):
    mutate(
        "INSERT INTO activity_log (icon,color,icon_color,text,via_wa) VALUES (%s,%s,%s,%s,%s)",
        (icon, color, icon_color, text, via_wa),
    )

# ─── Stats ──────────────────────────────────────────────────────────────────

@app.get("/api/stats")
@login_required
def get_stats():
    uid  = session["user_id"]
    role = session["role"]

    if role == "admin":
        rows = query("SELECT status, due_date FROM tasks")
    else:
        rows = query("SELECT status, due_date FROM tasks WHERE assigned_to=%s", (uid,))

    today   = date.today().isoformat()
    total   = len(rows)
    pending = sum(1 for r in rows if r["status"] == "pending")
    active  = sum(1 for r in rows if r["status"] == "in_progress")
    done    = sum(1 for r in rows if r["status"] == "completed")
    overdue = sum(1 for r in rows
                  if r["status"] != "completed" and r["due_date"] and r["due_date"] < today)
    return jsonify({"total": total, "pending": pending, "active": active,
                    "done": done, "overdue": overdue})

# ─── Performance / Analytics ────────────────────────────────────────────────

def _period_since(period: str) -> str:
    today = date.today()
    if period == "week":
        return (today - timedelta(days=7)).isoformat()
    if period == "year":
        return today.replace(month=1, day=1).isoformat()
    if period == "all":
        return "2000-01-01"
    return today.replace(day=1).isoformat()   # month (default)

@app.get("/api/performance")
@admin_required
def get_performance():
    """Per-member performance for every team member (admins included)."""
    period = request.args.get("period", "month")
    since  = _period_since(period)
    today  = date.today().isoformat()

    members = query("SELECT id,name,initials,color,role FROM users WHERE is_active=1")
    result  = []

    for m in members:
        mid = m["id"]

        assigned = query(
            "SELECT * FROM tasks WHERE assigned_to=%s AND date(created_at)>=%s",
            (mid, since),
        )
        total     = len(assigned)
        completed = sum(1 for t in assigned if t["status"] == "completed")
        in_prog   = sum(1 for t in assigned if t["status"] == "in_progress")
        pending   = sum(1 for t in assigned if t["status"] == "pending")
        overdue   = sum(1 for t in assigned
                        if t["status"] != "completed" and t["due_date"] and t["due_date"] < today)

        # On-time completions: compare the due date against the date the task
        # actually moved to "completed" (from task_updates), not the date it
        # was created — a task is on-time if it's finished by its due date,
        # not simply if the due date happens to fall after task creation.
        on_time = 0
        for t in assigned:
            if t["status"] != "completed" or not t["due_date"]:
                continue
            completion = query(
                "SELECT created_at FROM task_updates "
                "WHERE task_id=%s AND new_status='completed' "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (t["id"],), one=True,
            )
            completed_date = (completion["created_at"] if completion else t["created_at"] or "")[:10]
            if t["due_date"] >= completed_date:
                on_time += 1

        updates      = query(
            "SELECT * FROM task_updates WHERE updated_by=%s AND date(created_at)>=%s",
            (mid, since),
        )
        update_count = len(updates)

        # Average first-response time (hours between task creation and first update).
        response_times = []
        for t in assigned:
            first = query(
                "SELECT created_at FROM task_updates "
                "WHERE task_id=%s AND updated_by=%s ORDER BY created_at ASC, id ASC LIMIT 1",
                (t["id"], mid), one=True,
            )
            if first and t["created_at"]:
                try:
                    ta = datetime.fromisoformat(t["created_at"])
                    tu = datetime.fromisoformat(first["created_at"])
                    hrs = (tu - ta).total_seconds() / 3600
                    if hrs >= 0:
                        response_times.append(hrs)
                except ValueError:
                    pass
        avg_response = round(sum(response_times) / len(response_times), 1) if response_times else None

        comp_rate      = round(completed / total * 100) if total else 0
        activity_score = min(update_count * 10, 30)                              # up to 30
        ontime_score   = round((on_time / completed * 20) if completed else 0)   # up to 20
        overdue_score  = (10 if overdue == 0 else max(0, 10 - overdue * 5)) if total > 0 else 0
        score          = min(100, round(comp_rate * 0.40 + activity_score + ontime_score + overdue_score))

        # Daily completion buckets within the current period.
        daily = {}
        for t in query("SELECT * FROM tasks WHERE assigned_to=%s", (mid,)):
            if t["status"] == "completed":
                d = (t["created_at"] or "")[:10]
                if d >= since:
                    daily[d] = daily.get(d, 0) + 1

        high_done  = sum(1 for t in assigned if t["priority"] == "high" and t["status"] == "completed")
        high_total = sum(1 for t in assigned if t["priority"] == "high")

        result.append({
            "id":             mid,
            "name":           m["name"],
            "initials":       m["initials"],
            "color":          m["color"],
            "role":           m["role"],
            "total":          total,
            "completed":      completed,
            "inProgress":     in_prog,
            "pending":        pending,
            "overdue":        overdue,
            "onTime":         on_time,
            "updateCount":    update_count,
            "avgResponseHrs": avg_response,
            "compRate":       comp_rate,
            "score":          score,
            "highDone":       high_done,
            "highTotal":      high_total,
            "daily":          daily,
        })

    result.sort(key=lambda x: x["score"], reverse=True)
    return jsonify(result)

# ─── Password management ────────────────────────────────────────────────────

@app.post("/api/change-password")
@login_required
def change_password():
    data       = request.get_json(silent=True) or {}
    current_pw = data.get("currentPassword") or ""
    new_pw     = data.get("newPassword") or ""

    if len(new_pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    user = query("SELECT * FROM users WHERE id=%s", (session["user_id"],), one=True)
    if user["password"] != hash_pw(current_pw):
        return jsonify({"error": "Current password is incorrect"}), 401

    mutate("UPDATE users SET password=%s WHERE id=%s", (hash_pw(new_pw), session["user_id"]))
    log_activity("ti-lock", "rgba(99,102,241,0.15)", "#818cf8",
                 f"<strong>{html.escape(session['name'])}</strong> changed their password")
    return jsonify({"ok": True})

@app.post("/api/admin/reset-password/<user_id>")
@admin_required
def admin_reset_password(user_id):
    data   = request.get_json(silent=True) or {}
    new_pw = data.get("newPassword") or ""

    if len(new_pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    target = query("SELECT * FROM users WHERE id=%s", (user_id,), one=True)
    if not target:
        return jsonify({"error": "User not found"}), 404

    mutate("UPDATE users SET password=%s WHERE id=%s", (hash_pw(new_pw), user_id))
    log_activity("ti-shield-lock", "rgba(99,102,241,0.15)", "#818cf8",
                 f"<strong>{html.escape(session['name'])}</strong> reset password for "
                 f"<strong>{html.escape(target['name'])}</strong>")
    return jsonify({"ok": True})

# ─── Frontend ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")

@app.route("/css/<path:filename>")
def css(filename):
    return send_from_directory("static/css", filename)

@app.route("/js/<path:filename>")
def js(filename):
    return send_from_directory("static/js", filename)

# ─── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
