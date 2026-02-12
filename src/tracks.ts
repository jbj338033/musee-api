import type { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "@hono/zod-openapi";
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { config } from "./config";
import { ErrorSchema, TrackIdParam, TrackSchema } from "./types";
import type { Track } from "./types";

const listTracks = createRoute({
	method: "get",
	path: "/tracks",
	tags: ["Tracks"],
	summary: "트랙 목록 조회",
	request: {
		query: z.object({
			q: z.string().optional().openapi({ example: "한로로" }),
			limit: z.string().optional().openapi({ example: "50" }),
			offset: z.string().optional().openapi({ example: "0" }),
		}),
	},
	responses: {
		200: {
			description: "트랙 목록",
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(TrackSchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
					}),
				},
			},
		},
	},
});

const getTrack = createRoute({
	method: "get",
	path: "/tracks/{id}",
	tags: ["Tracks"],
	summary: "트랙 상세 조회",
	request: { params: TrackIdParam },
	responses: {
		200: { description: "트랙 상세", content: { "application/json": { schema: TrackSchema } } },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const patchTrack = createRoute({
	method: "patch",
	path: "/tracks/{id}",
	tags: ["Tracks"],
	summary: "트랙 메타데이터 수정",
	request: {
		params: TrackIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						title: z.string().optional(),
						artist: z.string().optional(),
						album: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: { description: "수정된 트랙", content: { "application/json": { schema: TrackSchema } } },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const deleteTrack = createRoute({
	method: "delete",
	path: "/tracks/{id}",
	tags: ["Tracks"],
	summary: "트랙 삭제 (파일+DB)",
	request: { params: TrackIdParam },
	responses: {
		204: { description: "삭제 완료" },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const streamTrack = createRoute({
	method: "get",
	path: "/tracks/{id}/stream",
	tags: ["Tracks"],
	summary: "오디오 스트리밍 (Range 지원)",
	request: { params: TrackIdParam },
	responses: {
		200: { description: "오디오 전체" },
		206: { description: "오디오 부분 (Range)" },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const downloadFile = createRoute({
	method: "get",
	path: "/tracks/{id}/file",
	tags: ["Tracks"],
	summary: "오디오 파일 다운로드",
	request: { params: TrackIdParam },
	responses: {
		200: { description: "오디오 파일" },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const getCover = createRoute({
	method: "get",
	path: "/tracks/{id}/cover",
	tags: ["Tracks"],
	summary: "커버 이미지",
	request: { params: TrackIdParam },
	responses: {
		200: { description: "커버 이미지 (JPEG)" },
		404: { description: "커버 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

export function tracksRoutes(app: OpenAPIHono, db: Database, audioDir = config.audioDir) {
	app.openapi(listTracks, (c) => {
		const { q, limit: l, offset: o } = c.req.valid("query");
		const limit = Number(l ?? 50);
		const offset = Number(o ?? 0);

		let data: Track[];
		let total: number;

		if (q) {
			const pattern = `%${q}%`;
			data = db
				.query<Track, [string, string, number, number]>(
					"SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
				)
				.all(pattern, pattern, limit, offset);
			total =
				db
					.query<{ count: number }, [string, string]>(
						"SELECT COUNT(*) as count FROM tracks WHERE title LIKE ? OR artist LIKE ?",
					)
					.get(pattern, pattern)?.count ?? 0;
		} else {
			data = db
				.query<Track, [number, number]>("SELECT * FROM tracks ORDER BY id DESC LIMIT ? OFFSET ?")
				.all(limit, offset);
			total =
				db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tracks").get()?.count ?? 0;
		}

		return c.json({ data, total, limit, offset });
	});

	app.openapi(getTrack, (c) => {
		const id = Number(c.req.valid("param").id);
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);
		return c.json(track);
	});

	app.openapi(patchTrack, async (c) => {
		const id = Number(c.req.valid("param").id);
		const existing = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!existing) return c.json({ error: "Track not found" }, 404);

		const body = c.req.valid("json");
		const updates: string[] = [];
		const values: (string | number)[] = [];

		if (body.title !== undefined) {
			updates.push("title = ?");
			values.push(body.title);
		}
		if (body.artist !== undefined) {
			updates.push("artist = ?");
			values.push(body.artist);
		}
		if (body.album !== undefined) {
			updates.push("album = ?");
			values.push(body.album);
		}

		if (updates.length === 0) return c.json(existing);

		updates.push("updated_at = datetime('now')");
		values.push(id);
		const updated = db
			.query<Track, (string | number)[]>(
				`UPDATE tracks SET ${updates.join(", ")} WHERE id = ? RETURNING *`,
			)
			.get(...values) as Track;
		return c.json(updated);
	});

	app.openapi(deleteTrack, (c) => {
		const id = Number(c.req.valid("param").id);
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);

		try {
			unlinkSync(join(audioDir, track.filename));
		} catch {}

		db.run("DELETE FROM tracks WHERE id = ?", [id]);
		return c.body(null, 204);
	});

	app.openapi(streamTrack, (c) => {
		const id = Number(c.req.valid("param").id);
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);

		const filePath = join(audioDir, track.filename);
		const file = Bun.file(filePath);
		const fileSize = file.size;

		const range = c.req.header("Range");
		if (range) {
			const match = range.match(/bytes=(\d+)-(\d*)/);
			if (match) {
				const start = Number.parseInt(match[1], 10);
				const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
				const chunk = file.slice(start, end + 1);

				return new Response(chunk, {
					status: 206,
					headers: {
						"Content-Range": `bytes ${start}-${end}/${fileSize}`,
						"Accept-Ranges": "bytes",
						"Content-Length": String(end - start + 1),
						"Content-Type": file.type || "audio/ogg",
					},
				});
			}
		}

		return new Response(file, {
			headers: {
				"Accept-Ranges": "bytes",
				"Content-Length": String(fileSize),
				"Content-Type": file.type || "audio/ogg",
			},
		});
	});

	app.openapi(downloadFile, (c) => {
		const id = Number(c.req.valid("param").id);
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);

		const file = Bun.file(join(audioDir, track.filename));
		return new Response(file, {
			headers: {
				"Content-Disposition": `attachment; filename="${track.filename}"`,
				"Content-Type": file.type || "audio/ogg",
			},
		});
	});

	app.openapi(getCover, (c) => {
		const id = Number(c.req.valid("param").id);
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track?.thumbnail) return c.json({ error: "Cover not found" }, 404);

		const file = Bun.file(join(audioDir, track.thumbnail));
		if (file.size === 0) return c.json({ error: "Cover not found" }, 404);

		return new Response(file, {
			headers: {
				"Content-Type": "image/jpeg",
				"Cache-Control": "public, max-age=86400",
			},
		});
	});
}
