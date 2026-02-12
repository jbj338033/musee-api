import type { Database } from "bun:sqlite";
import { z } from "@hono/zod-openapi";
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ErrorSchema, LyricsSchema, TrackIdParam } from "./types";
import type { LrcLine, LrclibResult, Lyrics } from "./types";

const LRC_LINE_REGEX = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s?(.*)/;

export function parseLrc(text: string): LrcLine[] {
	const lines: LrcLine[] = [];
	for (const raw of text.split("\n")) {
		const match = raw.match(LRC_LINE_REGEX);
		if (!match) continue;
		const minutes = Number.parseInt(match[1], 10);
		const seconds = Number.parseInt(match[2], 10);
		const ms =
			match[3].length === 3 ? Number.parseInt(match[3], 10) : Number.parseInt(match[3], 10) * 10;
		lines.push({
			time: minutes * 60 + seconds + ms / 1000,
			text: match[4],
		});
	}
	return lines;
}

export function isSyncedLrc(text: string): boolean {
	return text.split("\n").some((line) => LRC_LINE_REGEX.test(line));
}

export async function searchLrclib(
	trackName: string,
	artistName: string,
): Promise<{ content: string; isSynced: boolean } | null> {
	try {
		const params = new URLSearchParams({ track_name: trackName, artist_name: artistName });
		const res = await fetch(`https://lrclib.net/api/search?${params}`);
		const results: LrclibResult[] = await res.json();
		if (!results.length) return null;

		const withSynced = results.find((r) => r.syncedLyrics);
		if (withSynced?.syncedLyrics) {
			return { content: withSynced.syncedLyrics, isSynced: true };
		}

		const withPlain = results.find((r) => r.plainLyrics);
		if (withPlain?.plainLyrics) {
			return { content: withPlain.plainLyrics, isSynced: false };
		}

		return null;
	} catch {
		return null;
	}
}

const getLyrics = createRoute({
	method: "get",
	path: "/tracks/{id}/lyrics",
	tags: ["Lyrics"],
	summary: "가사 조회",
	request: { params: TrackIdParam },
	responses: {
		200: { description: "가사", content: { "application/json": { schema: LyricsSchema } } },
		404: { description: "가사 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const putLyrics = createRoute({
	method: "put",
	path: "/tracks/{id}/lyrics",
	tags: ["Lyrics"],
	summary: "가사 등록/수정",
	request: {
		params: TrackIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						content: z.string().openapi({ example: "[00:12.34] 가사 첫 줄" }),
						is_synced: z.boolean().optional().openapi({ example: true }),
					}),
				},
			},
		},
	},
	responses: {
		200: { description: "저장된 가사", content: { "application/json": { schema: LyricsSchema } } },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const uploadLrc = createRoute({
	method: "post",
	path: "/tracks/{id}/lyrics/upload",
	tags: ["Lyrics"],
	summary: "LRC 파일 업로드",
	request: {
		params: TrackIdParam,
		body: { content: { "multipart/form-data": { schema: z.object({ file: z.any() }) } } },
	},
	responses: {
		200: { description: "저장된 가사", content: { "application/json": { schema: LyricsSchema } } },
		400: { description: "파일 없음", content: { "application/json": { schema: ErrorSchema } } },
		404: { description: "트랙 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

const deleteLyrics = createRoute({
	method: "delete",
	path: "/tracks/{id}/lyrics",
	tags: ["Lyrics"],
	summary: "가사 삭제",
	request: { params: TrackIdParam },
	responses: {
		204: { description: "삭제 완료" },
		404: { description: "가사 없음", content: { "application/json": { schema: ErrorSchema } } },
	},
});

function upsertLyrics(db: Database, trackId: number, content: string, synced: boolean): Lyrics {
	const existing = db
		.query<{ id: number }, [number]>("SELECT id FROM lyrics WHERE track_id = ?")
		.get(trackId);

	if (existing) {
		return db
			.query<Lyrics, [string, number, number]>(
				"UPDATE lyrics SET content = ?, is_synced = ?, updated_at = datetime('now') WHERE track_id = ? RETURNING *",
			)
			.get(content, synced ? 1 : 0, trackId) as Lyrics;
	}

	return db
		.query<Lyrics, [number, string, number]>(
			"INSERT INTO lyrics (track_id, content, is_synced) VALUES (?, ?, ?) RETURNING *",
		)
		.get(trackId, content, synced ? 1 : 0) as Lyrics;
}

export function lyricsRoutes(app: OpenAPIHono, db: Database) {
	app.openapi(getLyrics, (c) => {
		const trackId = Number(c.req.valid("param").id);
		const lyrics = db
			.query<Lyrics, [number]>("SELECT * FROM lyrics WHERE track_id = ?")
			.get(trackId);
		if (!lyrics) return c.json({ error: "Lyrics not found" }, 404);
		return c.json(lyrics);
	});

	app.openapi(putLyrics, async (c) => {
		const trackId = Number(c.req.valid("param").id);
		const track = db
			.query<{ id: number }, [number]>("SELECT id FROM tracks WHERE id = ?")
			.get(trackId);
		if (!track) return c.json({ error: "Track not found" }, 404);

		const body = c.req.valid("json");
		const synced = body.is_synced ?? isSyncedLrc(body.content);
		const lyrics = upsertLyrics(db, trackId, body.content, synced);
		return c.json(lyrics);
	});

	app.openapi(uploadLrc, async (c) => {
		const trackId = Number(c.req.valid("param").id);
		const track = db
			.query<{ id: number }, [number]>("SELECT id FROM tracks WHERE id = ?")
			.get(trackId);
		if (!track) return c.json({ error: "Track not found" }, 404);

		const formData = await c.req.formData();
		const file = formData.get("file");
		if (!file || !(file instanceof Blob)) {
			return c.json({ error: "No file provided" }, 400);
		}

		const content = await file.text();
		const synced = isSyncedLrc(content);
		const lyrics = upsertLyrics(db, trackId, content, synced);
		return c.json(lyrics);
	});

	app.openapi(deleteLyrics, (c) => {
		const trackId = Number(c.req.valid("param").id);
		const existing = db
			.query<{ id: number }, [number]>("SELECT id FROM lyrics WHERE track_id = ?")
			.get(trackId);
		if (!existing) return c.json({ error: "Lyrics not found" }, 404);

		db.run("DELETE FROM lyrics WHERE track_id = ?", [trackId]);
		return c.body(null, 204);
	});
}
