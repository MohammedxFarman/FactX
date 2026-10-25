import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {migrateAcademics} from './academic-schema.js';

export function openDatabase(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'factx.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, name TEXT NOT NULL, department_id TEXT NOT NULL REFERENCES departments(id), program TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT '', semester INTEGER NOT NULL DEFAULT 1, section TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, department_id TEXT NOT NULL REFERENCES departments(id));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','HOD','FACULTY','STUDENT')), department_id TEXT REFERENCES departments(id), class_id TEXT REFERENCES classes(id), roll_number TEXT UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teaching_assignments(id TEXT PRIMARY KEY, faculty_id TEXT NOT NULL REFERENCES users(id), class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT NOT NULL REFERENCES subjects(id), UNIQUE(faculty_id,class_id,subject_id));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('assignment','lab','quiz','module')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT NOT NULL REFERENCES subjects(id), created_by TEXT NOT NULL REFERENCES users(id), deadline TEXT, max_marks REAL NOT NULL DEFAULT 100, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id), student_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL DEFAULT '', score REAL, feedback TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted', results TEXT, attempt INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(activity_id,student_id,attempt));
    CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT NOT NULL REFERENCES subjects(id), date TEXT NOT NULL, period INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('present','absent','excused')), recorded_by TEXT NOT NULL REFERENCES users(id), UNIQUE(student_id,class_id,subject_id,date,period));
    CREATE TABLE IF NOT EXISTS marks(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), subject_id TEXT NOT NULL REFERENCES subjects(id), class_id TEXT NOT NULL REFERENCES classes(id), title TEXT NOT NULL, kind TEXT NOT NULL, semester INTEGER NOT NULL, score REAL NOT NULL, max_marks REAL NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leave_applications(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, student_id TEXT REFERENCES users(id), department_id TEXT REFERENCES departments(id), name TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS learning_progress(student_id TEXT NOT NULL REFERENCES users(id), activity_id TEXT NOT NULL REFERENCES activities(id), opened_at TEXT NOT NULL, completed_at TEXT, PRIMARY KEY(student_id,activity_id));
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', read_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assessment_events(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), activity_id TEXT NOT NULL REFERENCES activities(id), event TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_versions(id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, algorithm TEXT NOT NULL, dataset_reference TEXT NOT NULL, metrics TEXT NOT NULL, features TEXT NOT NULL, trained_at TEXT NOT NULL, validated INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS risk_predictions(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), model_id TEXT NOT NULL REFERENCES model_versions(id), category TEXT NOT NULL, probability REAL NOT NULL, factors TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_id);
    CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id,date);
    CREATE INDEX IF NOT EXISTS idx_activities_class ON activities(class_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
  `);
  migrateAcademics(db);
  return db;
}
