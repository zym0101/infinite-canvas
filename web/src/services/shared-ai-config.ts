import { applySharedAiConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";

type SharedConfigResponse = { version?: number; revision?: string | null; updatedAt?: string | null; config?: unknown; error?: string };

const SHARED_CONFIG_URL = "/api/shared-ai-config";
const REQUEST_TIMEOUT_MS = 2500;
const POLL_INTERVAL_MS = 3000;
let startPromise: Promise<void> | null = null;
let revision = "";
let applyingRemote = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pollingStarted = false;

function hasUsableChannels(config: AiConfig) {
    return config.channels.some((channel) => channel.baseUrl.trim() && channel.models.length > 0 && (channel.apiFormat === "local" || channel.apiKey.trim()));
}

function isConfigPayload(value: unknown): value is Partial<AiConfig> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && "channels" in value && Array.isArray(value.channels));
}

async function requestSharedConfig() {
    const response = await fetch(SHARED_CONFIG_URL, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Shared AI config request failed (${response.status})`);
    return await response.json() as SharedConfigResponse;
}

async function saveSharedConfig(config: AiConfig) {
    const response = await fetch(SHARED_CONFIG_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({})) as SharedConfigResponse;
    if (!response.ok) throw new Error(data.error || `Shared AI config save failed (${response.status})`);
    revision = data.revision || revision;
}

function applyRemoteConfig(data: SharedConfigResponse) {
    if (!data.revision || data.revision === revision || !isConfigPayload(data.config)) return false;
    applyingRemote = true;
    revision = data.revision;
    applySharedAiConfig(data.config);
    applyingRemote = false;
    return true;
}

async function refreshSharedConfig() {
    try {
        applyRemoteConfig(await requestSharedConfig());
    } catch {
        // The browser-local cache remains usable when the shared Vite API is unavailable.
    }
}

function startPolling() {
    if (pollingStarted) return;
    pollingStarted = true;
    window.setInterval(() => void refreshSharedConfig(), POLL_INTERVAL_MS);
    window.addEventListener("focus", () => void refreshSharedConfig());
}

function subscribeLocalChanges() {
    useConfigStore.subscribe((state, previous) => {
        if (applyingRemote || state.config === previous.config) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void saveSharedConfig(useConfigStore.getState().config).catch(() => undefined);
        }, 500);
    });
}

async function initialize() {
    await useConfigStore.persist.rehydrate();
    const localConfig = useConfigStore.getState().config;
    try {
        const shared = await requestSharedConfig();
        if (!applyRemoteConfig(shared) && !shared.revision && hasUsableChannels(localConfig)) await saveSharedConfig(localConfig);
    } catch {
        // Keep localStorage as an offline fallback.
    }
    subscribeLocalChanges();
    startPolling();
}

export function startSharedAiConfigSync() {
    startPromise ||= initialize();
    return startPromise;
}
