import { z } from "@hono/zod-openapi";

export const TrackSchema = z
	.object({
		id: z.number().openapi({ example: 1 }),
		title: z.string().openapi({ example: "입춘 (Let Me Love My Youth)" }),
		artist: z.string().openapi({ example: "한로로" }),
		album: z.string().nullable().openapi({ example: null }),
		duration: z.number().nullable().openapi({ example: 180 }),
		youtube_url: z
			.string()
			.nullable()
			.openapi({ example: "https://www.youtube.com/watch?v=abc123" }),
		youtube_id: z.string().nullable().openapi({ example: "abc123" }),
		filename: z.string().openapi({ example: "abc123.opus" }),
		file_size: z.number().nullable().openapi({ example: 5242880 }),
		format: z.string().openapi({ example: "opus" }),
		thumbnail: z.string().nullable().openapi({ example: "abc123.jpg" }),
		created_at: z.string().openapi({ example: "2026-01-01 00:00:00" }),
		updated_at: z.string().openapi({ example: "2026-01-01 00:00:00" }),
	})
	.openapi("Track");

export const LyricsSchema = z
	.object({
		id: z.number().openapi({ example: 1 }),
		track_id: z.number().openapi({ example: 1 }),
		content: z.string().openapi({ example: "[00:12.34] 가사 첫 줄" }),
		is_synced: z.number().openapi({ example: 1 }),
		created_at: z.string().openapi({ example: "2026-01-01 00:00:00" }),
		updated_at: z.string().openapi({ example: "2026-01-01 00:00:00" }),
	})
	.openapi("Lyrics");

export const ErrorSchema = z
	.object({
		error: z.string().openapi({ example: "Not found" }),
	})
	.openapi("Error");

export const TrackIdParam = z.object({
	id: z.string().openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

export interface Track {
	id: number;
	title: string;
	artist: string;
	album: string | null;
	duration: number | null;
	youtube_url: string | null;
	youtube_id: string | null;
	filename: string;
	file_size: number | null;
	format: string;
	thumbnail: string | null;
	created_at: string;
	updated_at: string;
}

export interface Lyrics {
	id: number;
	track_id: number;
	content: string;
	is_synced: number;
	created_at: string;
	updated_at: string;
}

export interface DownloadTask {
	id: string;
	url: string;
	status: "pending" | "downloading" | "processing" | "completed" | "failed";
	progress: number;
	trackId: number | null;
	error: string | null;
	createdAt: number;
}

export interface LrcLine {
	time: number;
	text: string;
}

export interface LrclibResult {
	trackName: string;
	artistName: string;
	syncedLyrics: string | null;
	plainLyrics: string | null;
}
