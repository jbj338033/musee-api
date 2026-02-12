import { mkdirSync } from "node:fs";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { config } from "./config";
import { initDb } from "./db";
import { type TaskMap, downloadRoutes } from "./download";
import { lyricsRoutes } from "./lyrics";
import { tracksRoutes } from "./tracks";

mkdirSync(config.audioDir, { recursive: true });

const db = initDb();
const tasks: TaskMap = new Map();
const app = new OpenAPIHono();

downloadRoutes(app, db, tasks);
tracksRoutes(app, db);
lyricsRoutes(app, db);

app.doc("/doc", {
	openapi: "3.1.0",
	info: { title: "musee-api", version: "0.1.0", description: "Personal music download server" },
});

app.get("/swagger", swaggerUI({ url: "/doc" }));

export default app;

console.log(`musee-api listening on :${config.port}`);
