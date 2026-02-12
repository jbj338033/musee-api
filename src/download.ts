import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "@hono/zod-openapi";
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { config } from "./config";
import { searchLrclib } from "./lyrics";
import { ErrorSchema } from "./types";
import type { DownloadTask, Track } from "./types";

export type TaskMap = Map<string, DownloadTask>;

const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/;
const PROGRESS_REGEX = /\[download\]\s+([\d.]+)%/;

export function extractYoutubeId(url: string): string | null {
	const match = url.match(YOUTUBE_REGEX);
	return match?.[1] ?? null;
}

export function parseProgress(line: string): number | null {
	const match = line.match(PROGRESS_REGEX);
	return match ? Number.parseFloat(match[1]) : null;
}

export function createTask(tasks: TaskMap, url: string): DownloadTask {
	const task: DownloadTask = {
		id: crypto.randomUUID(),
		url,
		status: "pending",
		progress: 0,
		trackId: null,
		error: null,
		createdAt: Date.now(),
	};
	tasks.set(task.id, task);
	return task;
}

async function runDownload(task: DownloadTask, youtubeId: string, db: Database, format: string) {
	task.status = "downloading";
	const filename = `${youtubeId}.${format}`;
	const outputPath = join(config.audioDir, filename);

	try {
		const metaProc = Bun.spawn([config.ytDlpPath, "--print-json", "--skip-download", task.url], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const metaText = await new Response(metaProc.stdout).text();
		await metaProc.exited;

		let title = "Unknown";
		let artist = "Unknown";
		let duration: number | null = null;

		try {
			const meta = JSON.parse(metaText);
			title = meta.title ?? "Unknown";
			artist = meta.uploader ?? meta.channel ?? "Unknown";
			duration = meta.duration ? Math.round(meta.duration) : null;
		} catch {}

		const proc = Bun.spawn(
			[config.ytDlpPath, "-x", "--audio-format", format, "--progress", "-o", outputPath, task.url],
			{ stdout: "pipe", stderr: "pipe" },
		);

		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseProgress(line);
				if (progress !== null) task.progress = progress;
			}
		}

		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`yt-dlp exited with code ${exitCode}: ${stderr}`);
		}

		task.status = "processing";

		const file = Bun.file(outputPath);
		const fileSize = file.size;

		const result = db
			.query<Track, [string, string, number | null, string, string, string, number, string]>(
				`INSERT INTO tracks (title, artist, duration, youtube_url, youtube_id, filename, file_size, format)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 RETURNING *`,
			)
			.get(title, artist, duration, task.url, youtubeId, filename, fileSize, format);

		if (result) {
			task.trackId = result.id;

			try {
				const lyricsResult = await searchLrclib(title, artist);
				if (lyricsResult) {
					db.run("INSERT INTO lyrics (track_id, content, is_synced) VALUES (?, ?, ?)", [
						result.id,
						lyricsResult.content,
						lyricsResult.isSynced ? 1 : 0,
					]);
				}
			} catch {}
		}

		task.status = "completed";
		task.progress = 100;
	} catch (err) {
		task.status = "failed";
		task.error = err instanceof Error ? err.message : "Unknown error";
	}
}

const postDownload = createRoute({
	method: "post",
	path: "/download",
	tags: ["Download"],
	summary: "YouTube URL로 오디오 다운로드 시작",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						url: z
							.string()
							.url()
							.openapi({ example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
						format: z.string().optional().openapi({ example: "opus" }),
					}),
				},
			},
		},
	},
	responses: {
		202: {
			description: "다운로드 태스크 생성됨",
			content: {
				"application/json": {
					schema: z.object({ task_id: z.string().uuid() }),
				},
			},
		},
		400: {
			description: "잘못된 YouTube URL",
			content: { "application/json": { schema: ErrorSchema } },
		},
		409: {
			description: "이미 존재하는 트랙",
			content: {
				"application/json": {
					schema: z.object({ error: z.string(), track_id: z.number() }),
				},
			},
		},
	},
});

const getStatus = createRoute({
	method: "get",
	path: "/download/{taskId}/status",
	tags: ["Download"],
	summary: "다운로드 진행 상태 조회",
	request: {
		params: z.object({
			taskId: z.string().openapi({ param: { name: "taskId", in: "path" }, example: "uuid" }),
		}),
	},
	responses: {
		200: {
			description: "태스크 상태",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string().uuid(),
						status: z.enum(["pending", "downloading", "processing", "completed", "failed"]),
						progress: z.number(),
						track_id: z.number().nullable(),
						error: z.string().nullable(),
					}),
				},
			},
		},
		404: { description: "태스크 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

export function downloadRoutes(app: OpenAPIHono, db: Database, tasks: TaskMap) {
	app.openapi(postDownload, async (c) => {
		const { url, format: fmt } = c.req.valid("json");
		const youtubeId = extractYoutubeId(url);

		if (!youtubeId) {
			return c.json({ error: "Invalid YouTube URL" }, 400);
		}

		const existing = db
			.query<{ id: number }, [string]>("SELECT id FROM tracks WHERE youtube_id = ?")
			.get(youtubeId);
		if (existing) {
			return c.json({ error: "Track already exists", track_id: existing.id }, 409);
		}

		const format = fmt ?? config.defaultFormat;
		const task = createTask(tasks, url);
		runDownload(task, youtubeId, db, format);

		return c.json({ task_id: task.id }, 202);
	});

	app.openapi(getStatus, (c) => {
		const { taskId } = c.req.valid("param");
		const task = tasks.get(taskId);
		if (!task) return c.json({ error: "Task not found" }, 404);

		return c.json({
			id: task.id,
			status: task.status,
			progress: task.progress,
			track_id: task.trackId,
			error: task.error,
		});
	});
}
