import { join } from "node:path";

const DATA_DIR = Bun.env.DATA_DIR ?? join(import.meta.dir, "..", "data");

export const config = {
	port: Number(Bun.env.PORT ?? 3000),
	dataDir: DATA_DIR,
	audioDir: join(DATA_DIR, "audio"),
	dbPath: join(DATA_DIR, "musee.db"),
	ytDlpPath: Bun.env.YT_DLP_PATH ?? "yt-dlp",
	defaultFormat: "opus" as const,
};
