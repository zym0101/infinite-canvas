# 插件市场注册表（官方构建 + 推荐第三方）

本目录只放构建脚本，不放构建产物。官方插件由 CI 构建后发布到孤儿分支 `plugins-dist`；推荐第三方插件只在清单中登记固定版本 URL、许可证和源码地址，不复制或重新构建第三方源码，安装后仍按第三方插件管理。未登记的第三方插件继续由用户自行填写 JS URL 安装。

```
registry/
  package.json    # 构建依赖(esbuild + SDK)
  build.mjs       # 构建官方插件并生成包含推荐第三方条目的清单
  dist/           # 构建产物(gitignore,不提交;CI 发布到 plugins-dist 分支)
```

**产物不进 git**:`dist/` 与 `node_modules/` 均被 `.gitignore` 覆盖。`main` 分支只有源码与脚本。

## 发布流程(CI 自动)

`.github/workflows/publish-plugins.yml` 在**打版本 tag(`v*`)**或手动触发(`workflow_dispatch`)时,与 GitHub Pages 发布一起跑:

1. `npm install && npm run build` → 在 `dist/` 产出各官方 `<id>.js` 与插件市场清单 `official-plugins.json`；
2. 把 `dist/` 强推到孤儿分支 **`plugins-dist`**(仅含产物,force-push 覆盖)。

前端默认从下面地址读取(可用 `VITE_PLUGIN_REGISTRY_URL` 覆盖):

```
https://cdn.jsdelivr.net/gh/zym0101/infinite-canvas@plugins-dist/official-plugins.json
```

清单里的官方条目使用相对 `entry`，前端会按清单地址解析为绝对 URL；推荐第三方条目使用固定版本 `url`，并保留 `license` 与 `repository` 供用户安装前核对。两类条目最终都走既有 URL 安装流程，但推荐第三方不会标记为官方插件。jsDelivr 对分支有缓存（约数小时），需要立即生效可对该分支目录做 purge。

## 新增或更新插件

- 官方插件：在 `build.mjs` 的 `OFFICIAL` 中登记，版本继续从插件自身 `package.json` 读取；
- 推荐第三方插件：在 `RECOMMENDED` 中登记不可变版本 URL、许可证和源码地址，不得使用 `@main` 等浮动版本；
- 下次打版本 tag（或手动 `workflow_dispatch`）时，CI 自动重新生成并发布清单。

## 本地自测插件市场

```bash
cd plugins/canvas/registry && npm install && npm run build   # 产出 dist/
# 用任意静态服务器伺服 dist/,把 VITE_PLUGIN_REGISTRY_URL 指向其 official-plugins.json
```
