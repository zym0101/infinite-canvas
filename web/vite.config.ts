import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const sharedConfigFile = process.env.SHARED_AI_CONFIG_FILE ? resolve(process.env.SHARED_AI_CONFIG_FILE) : resolve(webDir, "../.local/shared-ai-config.json");
const sharedConfigRoute = "/api/shared-ai-config";

type SharedConfigFile = { version: 1; revision: string; updatedAt: string; config: { channels: unknown[] } };

function validSharedConfig(value: unknown): value is { channels: unknown[] } {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("channels" in value)) return false;
    const channels = value.channels;
    if (!Array.isArray(channels) || channels.length > 100) return false;
    return channels.every((channel) => channel && typeof channel === "object" && !Array.isArray(channel));
}

function readSharedConfig(): SharedConfigFile | null {
    try {
        const data: unknown = JSON.parse(readFileSync(sharedConfigFile, "utf8"));
        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        if (!("version" in data) || data.version !== 1 || !("revision" in data) || typeof data.revision !== "string" || !("updatedAt" in data) || typeof data.updatedAt !== "string" || !("config" in data) || !validSharedConfig(data.config)) return null;
        return { version: 1, revision: data.revision, updatedAt: data.updatedAt, config: data.config };
    } catch {
        return null;
    }
}

function writeSharedConfig(config: { channels: unknown[] }) {
    const data: SharedConfigFile = { version: 1, revision: `${Date.now()}-${randomUUID()}`, updatedAt: new Date().toISOString(), config };
    mkdirSync(dirname(sharedConfigFile), { recursive: true });
    const temporaryFile = `${sharedConfigFile}.${process.pid}.tmp`;
    writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryFile, sharedConfigFile);
    return data;
}

function sendJson(res: Connect.ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
}

function readJsonBody(req: Connect.IncomingMessage) {
    return new Promise<unknown>((resolveBody, reject) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 1_000_000) reject(new Error("request body too large"));
        });
        req.on("end", () => {
            try {
                resolveBody(JSON.parse(body || "{}"));
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}


function sharedAiConfigApi(): Plugin {
    const attach = (middlewares: Connect.Server) => middlewares.use(sharedConfigRoute, async (req, res) => {
        if (req.method === "GET") {
            sendJson(res, 200, readSharedConfig() || { version: 1, revision: null, updatedAt: null, config: null });
            return;
        }
        if (req.method !== "PUT") {
            sendJson(res, 405, { error: "method not allowed" });
            return;
        }
        const origin = req.headers.origin;
        const expectedOrigin = req.headers.host ? `http://${req.headers.host}` : "";
        if (origin && origin !== expectedOrigin) {
            sendJson(res, 403, { error: "origin not allowed" });
            return;
        }
        try {
            const body = await readJsonBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body) || !("config" in body) || !validSharedConfig(body.config)) {
                sendJson(res, 400, { error: "invalid AI configuration" });
                return;
            }
            sendJson(res, 200, writeSharedConfig(body.config));
        } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
    });
    return {
        name: "shared-ai-config-api",
        configureServer(server) {
            attach(server.middlewares);
        },
        configurePreviewServer(server) {
            attach(server.middlewares);
        },
    };
}
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), sharedAiConfigApi(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
