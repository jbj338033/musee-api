import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
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

export function lyricsRoutes(app: Hono, db: Database) {
	app.get("/tracks/:id/lyrics", (c) => {
		const trackId = Number(c.req.param("id"));
		const lyrics = db
			.query<Lyrics, [number]>("SELECT * FROM lyrics WHERE track_id = ?")
			.get(trackId);
		if (!lyrics) return c.json({ error: "Lyrics not found" }, 404);
		return c.json(lyrics);
	});

	app.put("/tracks/:id/lyrics", async (c) => {
		const trackId = Number(c.req.param("id"));
		const track = db
			.query<{ id: number }, [number]>("SELECT id FROM tracks WHERE id = ?")
			.get(trackId);
		if (!track) return c.json({ error: "Track not found" }, 404);

		const body = await c.req.json<{ content: string; is_synced?: boolean }>();
		const synced = body.is_synced ?? isSyncedLrc(body.content);

		const existing = db
			.query<{ id: number }, [number]>("SELECT id FROM lyrics WHERE track_id = ?")
			.get(trackId);

		if (existing) {
			db.run(
				"UPDATE lyrics SET content = ?, is_synced = ?, updated_at = datetime('now') WHERE track_id = ?",
				[body.content, synced ? 1 : 0, trackId],
			);
		} else {
			db.run("INSERT INTO lyrics (track_id, content, is_synced) VALUES (?, ?, ?)", [
				trackId,
				body.content,
				synced ? 1 : 0,
			]);
		}

		const lyrics = db
			.query<Lyrics, [number]>("SELECT * FROM lyrics WHERE track_id = ?")
			.get(trackId);
		return c.json(lyrics);
	});

	app.post("/tracks/:id/lyrics/upload", async (c) => {
		const trackId = Number(c.req.param("id"));
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

		const existing = db
			.query<{ id: number }, [number]>("SELECT id FROM lyrics WHERE track_id = ?")
			.get(trackId);

		if (existing) {
			db.run(
				"UPDATE lyrics SET content = ?, is_synced = ?, updated_at = datetime('now') WHERE track_id = ?",
				[content, synced ? 1 : 0, trackId],
			);
		} else {
			db.run("INSERT INTO lyrics (track_id, content, is_synced) VALUES (?, ?, ?)", [
				trackId,
				content,
				synced ? 1 : 0,
			]);
		}

		const lyrics = db
			.query<Lyrics, [number]>("SELECT * FROM lyrics WHERE track_id = ?")
			.get(trackId);
		return c.json(lyrics);
	});

	app.delete("/tracks/:id/lyrics", (c) => {
		const trackId = Number(c.req.param("id"));
		const existing = db
			.query<{ id: number }, [number]>("SELECT id FROM lyrics WHERE track_id = ?")
			.get(trackId);
		if (!existing) return c.json({ error: "Lyrics not found" }, 404);

		db.run("DELETE FROM lyrics WHERE track_id = ?", [trackId]);
		return c.body(null, 204);
	});
}
