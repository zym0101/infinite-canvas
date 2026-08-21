# MONOFORM 本地预演节点

本地插件，连接运行在 `41736` 端口的 MONOFORM 预演工作室。工程按画布节点保存在插件私有 localforage；上游图片作为参考图传入，PNG 和 MP4 输出写回画布媒体节点。

MONOFORM 本地源码位于仓库根目录 `.local/monoform-previs-studio`，该目录不会提交到 Git。

```bash
cd .local/monoform-previs-studio
npm install
npm run build
npm run preview -- --host 0.0.0.0 --port 41736 --strictPort
```
