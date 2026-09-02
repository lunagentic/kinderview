import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.KINDERFLOW_DATA_DIR || join(here, '..', 'data');
const dbPath = process.env.KINDERFLOW_DB || join(dataDir, 'kinderflow.db');

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

export const dbFile = dbPath;

// ── 헬퍼 ────────────────────────────────────────────────
export const all = (sql, params = {}) => db.prepare(sql).all(params);
export const one = (sql, params = {}) => db.prepare(sql).get(params) ?? null;
export const run = (sql, params = {}) => db.prepare(sql).run(params);

export const tx = (fn) => {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const uid = () => crypto.randomUUID();

// ── 시간 ────────────────────────────────────────────────
// 컨테이너/서버 TZ에 상관없이 팀 기준 시간대로 "오늘"을 계산한다.
const OFFSET_MIN = Number(process.env.KINDERFLOW_TZ_OFFSET ?? 540); // 기본 KST(+9)

export const nowISO = () => new Date().toISOString();

export const localNow = () => new Date(Date.now() + OFFSET_MIN * 60_000);

/** 팀 기준 시간대의 오늘 (YYYY-MM-DD) */
export const today = () => localNow().toISOString().slice(0, 10);

export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 해당 날짜가 속한 주의 월요일 */
export const weekStart = (isoDate = today()) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return addDays(isoDate, -dow);
};
