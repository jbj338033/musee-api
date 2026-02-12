import { mkdirSync } from "node:fs";
import { Hono } from "hono";
import { config } from "./config";
import { initDb } from "./db";
import { type TaskMap, downloadRoutes } from "./download";
import { lyricsRoutes } from "./lyrics";
import { tracksRoutes } from "./tracks";

mkdirSync(config.audioDir, { recursive: true });

const db = initDb();
const tasks: TaskMap = new Map();
const app = new Hono();

app.get("/", (c) => c.json({ name: "musee-api", version: "0.1.0" }));

downloadRoutes(app, db, tasks);
tracksRoutes(app, db);
lyricsRoutes(app, db);

export default {
	port: config.port,
	fetch: app.fetch,
};

console.log(`musee-api listening on :${config.port}`);
