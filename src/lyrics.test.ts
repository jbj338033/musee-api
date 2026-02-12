import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { initDb } from "./db";
import { isSyncedLrc, lyricsRoutes, parseLrc, searchLrclib } from "./lyrics";

describe("LRC parsing", () => {
	test("parseLrc parses standard LRC lines", () => {
		const lrc = "[00:12.34] Hello world\n[00:15.00] Second line";
		const result = parseLrc(lrc);
		expect(result).toHaveLength(2);
		expect(result[0].time).toBeCloseTo(12.34, 1);
		expect(result[0].text).toBe("Hello world");
		expect(result[1].time).toBeCloseTo(15.0, 1);
		expect(result[1].text).toBe("Second line");
	});

	test("parseLrc handles [MM:SS.xx] without space after bracket", () => {
		const lrc = "[01:30.50]No space here";
		const result = parseLrc(lrc);
		expect(result).toHaveLength(1);
		expect(result[0].time).toBeCloseTo(90.5, 1);
		expect(result[0].text).toBe("No space here");
	});

	test("parseLrc skips non-LRC lines", () => {
		const lrc = "[00:05.00] Valid\nJust plain text\n[00:10.00] Also valid";
		const result = parseLrc(lrc);
		expect(result).toHaveLength(2);
	});

	test("parseLrc returns empty for plain text", () => {
		const result = parseLrc("Just some lyrics\nNo timestamps");
		expect(result).toHaveLength(0);
	});

	test("isSyncedLrc detects synced lyrics", () => {
		expect(isSyncedLrc("[00:12.34] Hello")).toBe(true);
		expect(isSyncedLrc("[01:00.00] Test\n[01:05.00] More")).toBe(true);
	});

	test("isSyncedLrc detects plain lyrics", () => {
		expect(isSyncedLrc("Hello world")).toBe(false);
		expect(isSyncedLrc("Line one\nLine two")).toBe(false);
	});
});

describe("searchLrclib", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("returns synced lyrics when available", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify([
						{
							trackName: "Test",
							artistName: "Artist",
							syncedLyrics: "[00:01.00] Synced line",
							plainLyrics: "Plain line",
						},
					]),
				),
			),
		) as typeof fetch;

		const result = await searchLrclib("Test", "Artist");
		expect(result).not.toBeNull();
		expect(result?.content).toBe("[00:01.00] Synced line");
		expect(result?.isSynced).toBe(true);
	});

	test("falls back to plain lyrics when no synced", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify([
						{
							trackName: "Test",
							artistName: "Artist",
							syncedLyrics: null,
							plainLyrics: "Plain lyrics here",
						},
					]),
				),
			),
		) as typeof fetch;

		const result = await searchLrclib("Test", "Artist");
		expect(result).not.toBeNull();
		expect(result?.content).toBe("Plain lyrics here");
		expect(result?.isSynced).toBe(false);
	});

	test("returns null when no results", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(JSON.stringify([]))),
		) as typeof fetch;

		const result = await searchLrclib("Unknown", "Nobody");
		expect(result).toBeNull();
	});

	test("returns null on fetch error", async () => {
		globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as typeof fetch;

		const result = await searchLrclib("Test", "Artist");
		expect(result).toBeNull();
	});
});

describe("lyrics routes", () => {
	let db: Database;
	let app: Hono;

	beforeEach(() => {
		db = initDb(":memory:");
		db.run("INSERT INTO tracks (title, artist, filename, format) VALUES (?, ?, ?, ?)", [
			"Test Song",
			"Test Artist",
			"test.opus",
			"opus",
		]);
		app = new Hono();
		lyricsRoutes(app, db);
	});

	afterEach(() => {
		db.close();
	});

	test("GET /tracks/:id/lyrics returns 404 when no lyrics", async () => {
		const res = await app.request("/tracks/1/lyrics");
		expect(res.status).toBe(404);
	});

	test("PUT /tracks/:id/lyrics creates lyrics", async () => {
		const res = await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "Hello lyrics" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.content).toBe("Hello lyrics");
		expect(body.is_synced).toBe(0);
	});

	test("PUT /tracks/:id/lyrics auto-detects synced LRC", async () => {
		const res = await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "[00:01.00] Synced line\n[00:05.00] Another" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.is_synced).toBe(1);
	});

	test("PUT /tracks/:id/lyrics updates existing lyrics", async () => {
		await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "Original" }),
		});
		const res = await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "Updated" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.content).toBe("Updated");
	});

	test("GET /tracks/:id/lyrics returns existing lyrics", async () => {
		await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "Test lyrics" }),
		});
		const res = await app.request("/tracks/1/lyrics");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.content).toBe("Test lyrics");
	});

	test("DELETE /tracks/:id/lyrics removes lyrics", async () => {
		await app.request("/tracks/1/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "To delete" }),
		});
		const res = await app.request("/tracks/1/lyrics", { method: "DELETE" });
		expect(res.status).toBe(204);

		const check = await app.request("/tracks/1/lyrics");
		expect(check.status).toBe(404);
	});

	test("DELETE /tracks/:id/lyrics returns 404 when no lyrics", async () => {
		const res = await app.request("/tracks/1/lyrics", { method: "DELETE" });
		expect(res.status).toBe(404);
	});

	test("PUT /tracks/999/lyrics returns 404 for missing track", async () => {
		const res = await app.request("/tracks/999/lyrics", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "No track" }),
		});
		expect(res.status).toBe(404);
	});

	test("POST /tracks/:id/lyrics/upload handles LRC file", async () => {
		const lrcContent = "[00:01.00] First line\n[00:05.00] Second line";
		const formData = new FormData();
		formData.append("file", new Blob([lrcContent], { type: "text/plain" }), "test.lrc");

		const res = await app.request("/tracks/1/lyrics/upload", {
			method: "POST",
			body: formData,
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.content).toBe(lrcContent);
		expect(body.is_synced).toBe(1);
	});
});
