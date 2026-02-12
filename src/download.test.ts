import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { initDb } from "./db";
import {
	type TaskMap,
	createTask,
	downloadRoutes,
	extractYoutubeId,
	parseProgress,
} from "./download";

describe("extractYoutubeId", () => {
	test("extracts ID from standard URL", () => {
		expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("extracts ID from short URL", () => {
		expect(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("extracts ID from URL with extra params", () => {
		expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest")).toBe(
			"dQw4w9WgXcQ",
		);
	});

	test("returns null for invalid URL", () => {
		expect(extractYoutubeId("https://example.com")).toBeNull();
		expect(extractYoutubeId("not a url")).toBeNull();
	});
});

describe("parseProgress", () => {
	test("parses percentage from yt-dlp output", () => {
		expect(parseProgress("[download]  45.2% of 5.00MiB")).toBeCloseTo(45.2, 0);
	});

	test("parses 100%", () => {
		expect(parseProgress("[download] 100% of 5.00MiB")).toBe(100);
	});

	test("returns null for non-progress lines", () => {
		expect(parseProgress("[info] Downloading video")).toBeNull();
		expect(parseProgress("random text")).toBeNull();
	});
});

describe("createTask", () => {
	test("creates a task with pending status", () => {
		const tasks: TaskMap = new Map();
		const task = createTask(tasks, "https://youtube.com/watch?v=test");
		expect(task.status).toBe("pending");
		expect(task.progress).toBe(0);
		expect(task.url).toBe("https://youtube.com/watch?v=test");
		expect(tasks.has(task.id)).toBe(true);
	});
});

describe("download routes", () => {
	let db: Database;
	let app: OpenAPIHono;
	let tasks: TaskMap;

	beforeEach(() => {
		db = initDb(":memory:");
		tasks = new Map();
		app = new OpenAPIHono();
		downloadRoutes(app, db, tasks);
	});

	afterEach(() => {
		db.close();
	});

	test("POST /download validates URL", async () => {
		const res = await app.request("/download", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "not-a-youtube-url" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /download returns 202 with task_id", async () => {
		const res = await app.request("/download", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
		});
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.task_id).toBeDefined();
	});

	test("POST /download rejects duplicate youtube_id", async () => {
		db.run("INSERT INTO tracks (title, filename, youtube_id, format) VALUES (?, ?, ?, ?)", [
			"Existing",
			"existing.opus",
			"dQw4w9WgXcQ",
			"opus",
		]);
		const res = await app.request("/download", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
		});
		expect(res.status).toBe(409);
	});

	test("GET /download/:taskId/status returns task status", async () => {
		const postRes = await app.request("/download", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
		});
		const { task_id } = await postRes.json();

		const res = await app.request(`/download/${task_id}/status`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBeDefined();
		expect(body.progress).toBeDefined();
	});

	test("GET /download/:taskId/status returns 404 for unknown task", async () => {
		const res = await app.request("/download/nonexistent/status");
		expect(res.status).toBe(404);
	});
});
