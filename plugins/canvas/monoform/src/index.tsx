import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasAgentOp, CanvasNodeContentProps, CanvasNodeContext, StoredPluginMedia } from "@infinite-canvas/plugin-sdk";

const PROTOCOL = "monoform";
const STUDIO_PORT = "41736";

type MonoformProject = Record<string, unknown>;
type ReferencePayload = { id: string; name: string; dataUrl: string };
type StudioMessage = { type?: string; payload?: Record<string, unknown> };

function studioOrigin() {
    return `${window.location.protocol}//${window.location.hostname}:${STUDIO_PORT}`;
}

function projectKey(nodeId: string) {
    return `project:${nodeId}`;
}

async function referenceImages(ctx: CanvasNodeContext): Promise<ReferencePayload[]> {
    const upstream = ctx.getUpstream().flatMap((node) => {
        const content = node.metadata?.content;
        if (node.type !== "image" || typeof content !== "string" || !content) return [];
        return [{ id: node.id, name: node.title || "画布参考图", content }];
    });
    // metadata.content 是画布 origin 的 blob: URL，跨 origin 的 iframe 无法读取，先转成 data URL 再发送；单张失败不阻塞其余参考图
    const settled = await Promise.allSettled(upstream.map(async ({ content, ...rest }) => ({ ...rest, dataUrl: await ctx.media.readImage({ url: content }) })));
    return settled.flatMap((result) => (result.status === "fulfilled" && result.value.dataUrl ? [result.value] : []));
}

function nextOutputY(ctx: CanvasNodeContext) {
    const outputs = ctx.getDownstream().filter((node) => node.type === "image" || node.type === "video");
    return outputs.reduce((bottom, node) => Math.max(bottom, node.position.y + node.height + 36), ctx.node.position.y);
}

function mediaNodeOps(ctx: CanvasNodeContext, stored: StoredPluginMedia, kind: "image" | "video", title: string): CanvasAgentOp[] {
    const id = `${kind}-${crypto.randomUUID()}`;
    const maxWidth = kind === "video" ? 420 : 720;
    const maxHeight = kind === "video" ? 420 : 540;
    const width = stored.width || (kind === "video" ? 420 : 640);
    const height = stored.height || (kind === "video" ? 236 : 360);
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return [
        {
            type: "add_node",
            id,
            nodeType: kind,
            title,
            x: ctx.node.position.x + ctx.node.width + 96,
            y: nextOutputY(ctx),
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            metadata: {
                content: stored.url,
                storageKey: stored.storageKey,
                status: "success",
                naturalWidth: stored.width,
                naturalHeight: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                durationMs: stored.durationMs,
            },
        },
        { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
    ];
}

function StudioNode({ ctx }: CanvasNodeContentProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState("");
    const contextRef = useRef(ctx);
    contextRef.current = ctx;

    useEffect(() => {
        if (!open) return;
        const origin = studioOrigin();
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#090909";
        const loading = document.createElement("div");
        loading.textContent = "正在连接 MONOFORM…";
        loading.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:14px system-ui,sans-serif";
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "关闭预演工作室";
        close.style.cssText = "position:absolute;right:16px;top:12px;z-index:2;border:1px solid #ffffff44;border-radius:8px;padding:6px 10px;background:#0008;color:#fff;cursor:pointer";
        close.onclick = () => setOpen(false);
        const frame = document.createElement("iframe");
        frame.title = "MONOFORM 素形白模预演";
        frame.allow = "fullscreen; autoplay";
        frame.referrerPolicy = "no-referrer";
        frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
        frame.src = `${origin}/?embed=1&hostOrigin=${encodeURIComponent(window.location.origin)}`;
        overlay.append(loading, frame, close);
        document.body.appendChild(overlay);

        let disposed = false;
        const sendSession = async () => {
            const project = await contextRef.current.storage.get<MonoformProject>(projectKey(contextRef.current.node.id));
            const references = await referenceImages(contextRef.current);
            if (disposed) return;
            frame.contentWindow?.postMessage({ type: `${PROTOCOL}:session`, payload: { instanceId: contextRef.current.node.id, project, references } }, origin);
            loading.remove();
            setStatus("已连接");
        };
        const onMessage = async (event: MessageEvent<StudioMessage>) => {
            if (event.origin !== origin || event.source !== frame.contentWindow) return;
            const type = event.data?.type;
            const payload = event.data?.payload || {};
            if (type === `${PROTOCOL}:ready`) return void sendSession();
            if (type === `${PROTOCOL}:project-changed`) {
                const project = payload.project;
                if (project && typeof project === "object" && !Array.isArray(project)) {
                    await contextRef.current.storage.set(projectKey(contextRef.current.node.id), project);
                    const shots = Array.isArray((project as MonoformProject).shots) ? (project as MonoformProject).shots as unknown[] : [];
                    contextRef.current.updateMetadata({ monoformProjectKey: projectKey(contextRef.current.node.id), monoformShotCount: shots.length, monoformUpdatedAt: Date.now() });
                }
                return;
            }
            if (type === `${PROTOCOL}:png-exported` && payload.blob instanceof Blob) {
                const stored = await contextRef.current.media.storeImage(payload.blob);
                contextRef.current.applyOps(mediaNodeOps(contextRef.current, stored, "image", String(payload.fileName || "MONOFORM 镜头.png")));
                return;
            }
            if (type === `${PROTOCOL}:video-exported` && payload.blob instanceof Blob) {
                const stored = await contextRef.current.media.storeVideo(payload.blob);
                contextRef.current.applyOps(mediaNodeOps(contextRef.current, stored, "video", String(payload.fileName || "MONOFORM 预演.mp4")));
            }
        };
        window.addEventListener("message", onMessage);
        return () => {
            disposed = true;
            window.removeEventListener("message", onMessage);
            overlay.remove();
        };
    }, [open]);

    const shotCount = Number(ctx.node.metadata?.monoformShotCount || 0);
    return (
        <div data-canvas-no-zoom style={{ display: "flex", height: "100%", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: ctx.theme.node.text }}>
            <div style={{ fontSize: 32 }}>🎥</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>MONOFORM 素形预演</div>
            <div style={{ color: ctx.theme.node.muted, fontSize: 12 }}>{shotCount ? `${shotCount} 个镜头 · ${status || "工程已保存"}` : status || "白模、镜头与关键帧预演"}</div>
            <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={() => setOpen(true)} style={{ border: 0, padding: "7px 12px", background: "transparent", color: ctx.theme.node.text, cursor: "pointer", fontSize: 13 }}>打开预演工作室</button>
        </div>
    );
}

export default definePlugin({
    id: "monoform",
    name: "MONOFORM 素形预演",
    version: "0.1.0",
    description: "连接本地 MONOFORM 白模预演工作室，工程按节点隔离，PNG 与 MP4 输出回传画布。",
    nodes: [{
        type: "monoform:studio",
        title: "MONOFORM 素形预演",
        icon: "🎥",
        description: "人物白模、镜头、关键帧和动画预演",
        defaultSize: { width: 360, height: 240 },
        defaultMetadata: { monoformShotCount: 0 },
        hasSourceHandle: true,
        hidePanel: true,
        Content: StudioNode,
    }],
});
