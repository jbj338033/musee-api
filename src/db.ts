import { Database } from "bun:sqlite";
import { config } from "./config";

export function initDb(target: string | Database = config.dbPath): Database {
	const db = target instanceof Database ? target : new Database(target);

	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");

	db.exec(`
		CREATE TABLE IF NOT EXISTS tracks (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			title       TEXT NOT NULL,
			artist      TEXT NOT NULL DEFAULT 'Unknown',
			album       TEXT,
			duration    INTEGER,
			youtube_url TEXT,
			youtube_id  TEXT UNIQUE,
			filename    TEXT NOT NULL,
			file_size   INTEGER,
			format      TEXT NOT NULL DEFAULT 'opus',
			thumbnail   TEXT,
			created_at  TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS lyrics (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			track_id    INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
			content     TEXT NOT NULL,
			is_synced   INTEGER NOT NULL DEFAULT 0,
			created_at  TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	return db;
}
