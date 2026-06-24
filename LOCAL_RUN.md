**正确做法**：**Docker 只跑 db + minio 两个基础设施，app 用 `npm run dev` 跑工作树。** 这样完全跳过那个慢的镜像构建，还有热重载、能直接吃到你刚改的 catch。

先确认一下 `.env` 里连接地址是 `localhost`（host 上跑 dev 必须走 localhost，而不是 compose 里覆盖的 `db:`/`minio:` 内部主机名）：

`.env` 已经全指向 `localhost`（db `:5432`、minio `:9000`、auth `:3000`），所以 host 上 `npm run dev` 能直连 Docker 里的 db/minio。看一下当前容器和依赖状态：

一切已就绪——你之前其实已经在用这套了：`reqcore_db` 和 `reqcore_minio` 都已 healthy 跑了 14 小时，`node_modules` 和 `.nuxt` 都在。**唯一慢的 `app` 容器没在跑，正合适。**

所以本地运行就一条命令：

```bash
npm run dev      # → http://localhost:3000
```

## 完整流程（给你存档）

```bash
# 1. 基础设施：只起 db + minio，永远不要带 app（app 才是 build: . 那个慢的）
docker compose up -d db minio

# 2. 依赖（已装好，跳过即可）
npm install

# 3. 迁移到最新（幂等，安全重跑；会建好 storage_provider 列）
npm run db:migrate

# 4. 可选：种子数据
npm run db:seed

# 5. 跑工作树，热重载，直接吃你改的代码
npm run dev      # http://localhost:3000
```

**关键点：**
- `docker compose up -d db minio` —— **显式只列 db minio 两个服务**。`docker compose up`（不带服务名）会把 `app` 也带起来触发慢构建。
- `.env` 已指向 `localhost`（db:5432 / minio:9000 / auth:3000），host 上 dev 直连容器，无需改任何配置。
- `npm run build` / `npm run dev` 在你的 node v25 上正常；只有 `nuxi typecheck` 会 OOM（与此无关）。

## 顺带把 AI 报错一起抓了

既然要跑 dev，正好接上上一件事——dev 起来后重新上传简历，终端会打出我刚加的 `[import.parse] AI extraction failed for "...": <真实错误>`。

要我现在**后台起 `npm run dev`** 吗？这样它跑着、你去浏览器操作，我能直接读终端日志帮你定位那个 AI 报错。


