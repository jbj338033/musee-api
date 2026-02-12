import type { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config";
import type { Track } from "./types";

export function tracksRoutes(app: Hono, db: Database, audioDir = config.audioDir) {
	app.get("/tracks", (c) => {
		const q = c.req.query("q");
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);

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

	app.get("/tracks/:id", (c) => {
		const id = Number(c.req.param("id"));
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);
		return c.json(track);
	});

	app.patch("/tracks/:id", async (c) => {
		const id = Number(c.req.param("id"));
		const existing = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!existing) return c.json({ error: "Track not found" }, 404);

		const body = await c.req.json<Partial<Pick<Track, "title" | "artist" | "album">>>();
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

		if (updates.length === 0) {
			return c.json(existing);
		}

		updates.push("updated_at = datetime('now')");
		values.push(id);

		db.run(`UPDATE tracks SET ${updates.join(", ")} WHERE id = ?`, values);

		const updated = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		return c.json(updated);
	});

	app.delete("/tracks/:id", (c) => {
		const id = Number(c.req.param("id"));
		const track = db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
		if (!track) return c.json({ error: "Track not found" }, 404);

		try {
			unlinkSync(join(audioDir, track.filename));
		} catch {}

		db.run("DELETE FROM tracks WHERE id = ?", [id]);
		return c.body(null, 204);
	});

	app.get("/tracks/:id/stream", (c) => {
		const id = Number(c.req.param("id"));
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

	app.get("/tracks/:id/file", (c) => {
		const id = Number(c.req.param("id"));
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
}
