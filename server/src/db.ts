import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Match } from '@biph/shared';

export interface MatchRow {
  id: string;
  status: string;
  court: string;
  name: string;
  seq: number;
  data: string;
  operator_token: string;
  graphics_token: string;
  created_at: number;
  updated_at: number;
}

export interface LogRow {
  id: number;
  match_id: string;
  at: number;
  message: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS matches (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL,
  court          TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  seq            INTEGER NOT NULL DEFAULT 0,
  data           TEXT NOT NULL,
  operator_token TEXT NOT NULL,
  graphics_token TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

CREATE TABLE IF NOT EXISTS match_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  at       INTEGER NOT NULL,
  message  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_match ON match_logs(match_id, id DESC);

CREATE TABLE IF NOT EXISTS match_undo (
  match_id TEXT NOT NULL,
  idx      INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (match_id, idx)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * SQLite 持久层。
 * 用 Node 内置的 node:sqlite —— 零原生依赖,Docker 镜像不需要编译工具链。
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /* ----------------------------- 比赛 ----------------------------- */

  listRows(): MatchRow[] {
    return this.db
      .prepare('SELECT * FROM matches ORDER BY created_at ASC')
      .all() as unknown as MatchRow[];
  }

  listMatches(): Match[] {
    return this.listRows().map((r) => JSON.parse(r.data) as Match);
  }

  getRow(id: string): MatchRow | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as
      | unknown as MatchRow
      | undefined;
    return row ?? null;
  }

  getMatch(id: string): Match | null {
    const row = this.getRow(id);
    return row ? (JSON.parse(row.data) as Match) : null;
  }

  insertMatch(match: Match, operatorToken: string, graphicsToken: string): void {
    this.db
      .prepare(
        `INSERT INTO matches
         (id, status, court, name, seq, data, operator_token, graphics_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        match.id,
        match.status,
        match.court,
        match.name,
        match.seq,
        JSON.stringify(match),
        operatorToken,
        graphicsToken,
        match.createdAt,
        match.updatedAt,
      );
  }

  /** 更新比赛主体(不含令牌) */
  updateMatch(match: Match): void {
    this.db
      .prepare(
        `UPDATE matches
         SET status = ?, court = ?, name = ?, seq = ?, data = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        match.status,
        match.court,
        match.name,
        match.seq,
        JSON.stringify(match),
        match.updatedAt,
        match.id,
      );
  }

  deleteMatch(id: string): void {
    this.db.prepare('DELETE FROM matches WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM match_logs WHERE match_id = ?').run(id);
    this.db.prepare('DELETE FROM match_undo WHERE match_id = ?').run(id);
  }

  /* ----------------------------- 日志 ----------------------------- */

  appendLog(matchId: string, at: number, message: string): void {
    this.db
      .prepare('INSERT INTO match_logs (match_id, at, message) VALUES (?, ?, ?)')
      .run(matchId, at, message);
  }

  listLogs(matchId: string, limit = 100): LogRow[] {
    return this.db
      .prepare('SELECT * FROM match_logs WHERE match_id = ? ORDER BY id DESC LIMIT ?')
      .all(matchId, limit) as unknown as LogRow[];
  }

  /* ----------------------------- 撤销栈 ----------------------------- */

  pushUndo(matchId: string, idx: number, snapshot: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO match_undo (match_id, idx, snapshot) VALUES (?, ?, ?)')
      .run(matchId, idx, snapshot);
  }

  /** 读取并删除栈顶,返回还原后的 Match */
  popUndo(matchId: string): Match | null {
    const row = this.db
      .prepare('SELECT idx, snapshot FROM match_undo WHERE match_id = ? ORDER BY idx DESC LIMIT 1')
      .get(matchId) as unknown as { idx: number; snapshot: string } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM match_undo WHERE match_id = ? AND idx = ?').run(matchId, row.idx);
    return JSON.parse(row.snapshot) as Match;
  }

  countUndo(matchId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM match_undo WHERE match_id = ?')
      .get(matchId) as unknown as { n: number };
    return row?.n ?? 0;
  }

  /** 压栈前裁剪,保持栈深度 */
  trimUndo(matchId: string, keep: number): void {
    this.db
      .prepare(
        'DELETE FROM match_undo WHERE match_id = ? AND idx < (SELECT MAX(idx) - ? FROM match_undo WHERE match_id = ?)',
      )
      .run(matchId, keep, matchId);
  }

  /* ----------------------------- 设置 ----------------------------- */

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | unknown as { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value);
  }
}
