import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchPluginRegistry, hasUpgrade, type PluginRegistryEntry } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [registry, setRegistry] = useState<PluginRegistryEntry[]>([]);
    const [loadingRegistry, setLoadingRegistry] = useState(false);
    const [registryError, setRegistryError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const localPlugins = useMemo(() => plugins.filter((item) => item.local), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !item.official), [plugins]);

    const loadRegistry = useCallback(async () => {
        setLoadingRegistry(true);
        setRegistryError(null);
        try {
            setRegistry(await fetchPluginRegistry());
        } catch (error) {
            setRegistryError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingRegistry(false);
        }
    }, []);

    // Fetch the plugin registry when opening the panel, but only if it has not been loaded yet.
    useEffect(() => {
        if (open && registry.length === 0 && !loadingRegistry && !registryError) void loadRegistry();
    }, [open, registry.length, loadingRegistry, registryError, loadRegistry]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target);
            message.success(t("canvas.plugins.installedPlugin", { name: plugin.name }));
            setUrl("");
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setInstalling(false);
        }
    };

    const handleInstallRegistry = async (entry: PluginRegistryEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: entry.official });
            message.success(t("canvas.plugins.installed", { name: plugin.name }));
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // Installed plugin actions: enable toggle plus update/uninstall for non-local plugins.
    // Highlight the update action when a newer remote version is available.
    const installedControls = (record: InstalledPlugin, upgradable = false) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    <Button
                        type={upgradable ? "primary" : "text"}
                        size="small"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), t("canvas.plugins.updated"))}
                    />
                    <Popconfirm title={t("canvas.plugins.uninstallTitle")} okText={t("canvas.plugins.uninstall")} cancelText={t("canvas.editors.cancel")} onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title={t("canvas.plugins.uninstall")} />
                    </Popconfirm>
                </>
            )}
        </>
    );

    // Add a green dot at the icon's top-right corner when an update is available.
    // A card-colored box shadow separates the dot visually from the icon.
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.node.fill}` }} title={t("canvas.plugins.newVersion")} />
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // Shared plugin row: icon, title with name and version, description, and actions.
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: ReactNode, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? <div className="mt-0.5 min-w-0 text-xs" style={{ color: theme.node.muted }}>{subtitle}</div> : null}
            </div>
            {right}
        </div>
    );


    const registryTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.plugins.registryDescription")}
                </div>
                <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loadingRegistry ? "animate-spin" : ""}`} />} onClick={loadRegistry} disabled={loadingRegistry}>
                    {t("canvas.plugins.refresh")}
                </Button>
            </div>
            {registryError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t("canvas.plugins.loadFailed", { error: registryError })}
                </div>
            ) : loadingRegistry && registry.length === 0 ? (
                emptyHint(t("canvas.plugins.loadingRegistry"))
            ) : registry.length === 0 ? (
                emptyHint(t("canvas.plugins.noRegistryPlugins"))
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {registry.map((entry) => {
                        const record = recordById.get(entry.id);
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        const subtitle = entry.official ? entry.description : (
                            <div className="min-w-0">
                                <div className="truncate">{entry.description}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                                    <span>{t("canvas.plugins.recommendedThirdParty")}</span>
                                    {entry.license ? <span>· {entry.license}</span> : null}
                                    {entry.repository ? <a className="truncate underline" href={entry.repository} target="_blank" rel="noreferrer">· GitHub</a> : null}
                                </div>
                            </div>
                        );
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            subtitle,
                            record ? (
                                installedControls(record, upgradable)
                            ) : (
                                <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => handleInstallRegistry(entry)}>
                                    {t("canvas.plugins.install")}
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>;

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input placeholder={t("canvas.plugins.urlPlaceholder")} value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={handleInstallUrl} allowClear />
                <Button type="primary" loading={installing} onClick={handleInstallUrl} icon={<Puzzle className="size-4" />}>
                    {t("canvas.plugins.install")}
                </Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">{thirdPartyPlugins.length === 0 ? emptyHint(t("canvas.plugins.noThirdParty")) : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>
        </div>
    );

    const tabs = [
        { key: "registry", label: t("canvas.plugins.marketplace"), children: registryTab },
        ...(localPlugins.length > 0 ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }] : []),
        { key: "third", label: t("canvas.plugins.thirdParty"), children: thirdPartyTab },
    ];

    return (
        <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>{t("canvas.plugins.warning")}</span>
                </div>
                <Tabs defaultActiveKey="registry" items={tabs} />
            </div>
        </Modal>
    );
}
