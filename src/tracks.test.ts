import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { initDb } from "./db";
import { tracksRoutes } from "./tracks";

const TEST_AUDIO_DIR = join(import.meta.dir, "..", "data", "test-audio");

describe("tracks routes", () => {
	let db: Database;
	let app: OpenAPIHono;

	beforeEach(() => {
		db = initDb(":memory:");
		mkdirSync(TEST_AUDIO_DIR, { recursive: true });
		app = new OpenAPIHono();
		tracksRoutes(app, db, TEST_AUDIO_DIR);

		db.run(
			"INSERT INTO tracks (title, artist, album, duration, filename, file_size, format) VALUES (?, ?, ?, ?, ?, ?, ?)",
			["Song A", "Artist A", "Album A", 180, "song-a.opus", 1024, "opus"],
		);
		db.run("INSERT INTO tracks (title, artist, filename, format) VALUES (?, ?, ?, ?)", [
			"Song B",
			"Artist B",
			"song-b.opus",
			"opus",
		]);
	});

	afterEach(() => {
		db.close();
		rmSync(TEST_AUDIO_DIR, { recursive: true, force: true });
	});

	test("GET /tracks returns all tracks", async () => {
		const res = await app.request("/tracks");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.total).toBe(2);
	});

	test("GET /tracks supports search by title", async () => {
		const res = await app.request("/tracks?q=Song+A");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].title).toBe("Song A");
	});

	test("GET /tracks supports search by artist", async () => {
		const res = await app.request("/tracks?q=Artist+B");
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].artist).toBe("Artist B");
	});

	test("GET /tracks supports pagination", async () => {
		const res = await app.request("/tracks?limit=1&offset=0");
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.total).toBe(2);

		const res2 = await app.request("/tracks?limit=1&offset=1");
		const body2 = await res2.json();
		expect(body2.data).toHaveLength(1);
		expect(body2.data[0].id).not.toBe(body.data[0].id);
	});

	test("GET /tracks/:id returns a single track", async () => {
		const res = await app.request("/tracks/1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.title).toBe("Song A");
		expect(body.artist).toBe("Artist A");
	});

	test("GET /tracks/:id returns 404 for missing track", async () => {
		const res = await app.request("/tracks/999");
		expect(res.status).toBe(404);
	});

	test("PATCH /tracks/:id updates metadata", async () => {
		const res = await app.request("/tracks/1", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Updated Title", album: "New Album" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.title).toBe("Updated Title");
		expect(body.album).toBe("New Album");
		expect(body.artist).toBe("Artist A");
	});

	test("PATCH /tracks/:id returns 404 for missing track", async () => {
		const res = await app.request("/tracks/999", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Updated" }),
		});
		expect(res.status).toBe(404);
	});

	test("DELETE /tracks/:id deletes track and file", async () => {
		const filePath = join(TEST_AUDIO_DIR, "song-a.opus");
		writeFileSync(filePath, "fake audio data");

		const res = await app.request("/tracks/1", { method: "DELETE" });
		expect(res.status).toBe(204);

		const check = await app.request("/tracks/1");
		expect(check.status).toBe(404);

		const file = Bun.file(filePath);
		expect(file.size).toBe(0);
	});

	test("DELETE /tracks/:id returns 404 for missing track", async () => {
		const res = await app.request("/tracks/999", { method: "DELETE" });
		expect(res.status).toBe(404);
	});

	test("GET /tracks/:id/stream returns audio", async () => {
		const filePath = join(TEST_AUDIO_DIR, "song-a.opus");
		writeFileSync(filePath, "fake audio content for streaming");

		const res = await app.request("/tracks/1/stream");
		expect(res.status).toBe(200);
		expect(res.headers.get("Accept-Ranges")).toBe("bytes");
	});

	test("GET /tracks/:id/stream supports Range header", async () => {
		const content = "0123456789abcdef";
		const filePath = join(TEST_AUDIO_DIR, "song-a.opus");
		writeFileSync(filePath, content);

		const res = await app.request("/tracks/1/stream", {
			headers: { Range: "bytes=0-9" },
		});
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toMatch(/^bytes 0-9\/16$/);
		const body = await res.text();
		expect(body).toBe("0123456789");
	});

	test("GET /tracks/:id/file returns download response", async () => {
		const filePath = join(TEST_AUDIO_DIR, "song-a.opus");
		writeFileSync(filePath, "fake audio");

		const res = await app.request("/tracks/1/file");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Disposition")).toContain("attachment");
	});
});
