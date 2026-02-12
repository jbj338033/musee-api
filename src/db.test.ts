import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { initDb } from "./db";

describe("db", () => {
	let db: Database;

	afterEach(() => {
		db?.close();
	});

	test("initDb creates tracks table", () => {
		db = initDb(":memory:");
		const tables = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'",
			)
			.all();
		expect(tables).toHaveLength(1);
	});

	test("initDb creates lyrics table", () => {
		db = initDb(":memory:");
		const tables = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='lyrics'",
			)
			.all();
		expect(tables).toHaveLength(1);
	});

	test("tracks table has correct columns", () => {
		db = initDb(":memory:");
		const columns = db.query<{ name: string }, []>("PRAGMA table_info(tracks)").all();
		const names = columns.map((c) => c.name);
		expect(names).toContain("id");
		expect(names).toContain("title");
		expect(names).toContain("artist");
		expect(names).toContain("album");
		expect(names).toContain("duration");
		expect(names).toContain("youtube_url");
		expect(names).toContain("youtube_id");
		expect(names).toContain("filename");
		expect(names).toContain("file_size");
		expect(names).toContain("format");
		expect(names).toContain("created_at");
		expect(names).toContain("updated_at");
	});

	test("lyrics table has foreign key to tracks", () => {
		db = initDb(":memory:");
		const fks = db.query<{ table: string }, []>("PRAGMA foreign_key_list(lyrics)").all();
		expect(fks.some((fk) => fk.table === "tracks")).toBe(true);
	});

	test("insert and query a track", () => {
		db = initDb(":memory:");
		db.run("INSERT INTO tracks (title, artist, filename, format) VALUES (?, ?, ?, ?)", [
			"Test Song",
			"Test Artist",
			"test.opus",
			"opus",
		]);
		const track = db
			.query<{ title: string; artist: string }, []>("SELECT title, artist FROM tracks")
			.get();
		expect(track?.title).toBe("Test Song");
		expect(track?.artist).toBe("Test Artist");
	});

	test("youtube_id has unique constraint", () => {
		db = initDb(":memory:");
		db.run("INSERT INTO tracks (title, filename, youtube_id, format) VALUES (?, ?, ?, ?)", [
			"Song 1",
			"a.opus",
			"abc123",
			"opus",
		]);
		expect(() => {
			db.run("INSERT INTO tracks (title, filename, youtube_id, format) VALUES (?, ?, ?, ?)", [
				"Song 2",
				"b.opus",
				"abc123",
				"opus",
			]);
		}).toThrow();
	});

	test("cascade delete removes lyrics when track is deleted", () => {
		db = initDb(":memory:");
		db.run("INSERT INTO tracks (title, filename, format) VALUES (?, ?, ?)", [
			"Song",
			"s.opus",
			"opus",
		]);
		db.run("INSERT INTO lyrics (track_id, content) VALUES (1, 'hello')");
		db.run("DELETE FROM tracks WHERE id = 1");
		const lyrics = db.query<{ id: number }, []>("SELECT id FROM lyrics WHERE track_id = 1").all();
		expect(lyrics).toHaveLength(0);
	});

	test("initDb is idempotent", () => {
		db = initDb(":memory:");
		expect(() => initDb(db)).not.toThrow();
	});
});
