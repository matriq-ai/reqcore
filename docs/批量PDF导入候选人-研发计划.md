# 批量 PDF 导入候选人(AI 识别 + 飞书云空间存储)— 研发计划

> 本文档为研发计划,供阅读评审,暂不执行。

## 背景与目标

招聘场景常一次拿到一批简历 PDF。当前只能逐个「Add Candidate」手填,简历单文件上传走 S3。本功能要实现:

**批量上传多个 PDF → AI 识别候选人信息 → 预览可编辑表格(每行一个 PDF,可改字段、可选岗位)→ 确认后批量创建候选人。**

- 候选人创建时**不强制绑岗**;岗位在导入界面里逐行 / 批量选择。
- **PDF 原文件存到飞书云空间(Feishu Drive)而非 S3**,并记为候选人 `resume` 文档。

### 已确认决策
1. **提取方式**:AI(复用现有 `generateStructuredOutput`,依赖组织已在 Settings→AI 配好 provider)。
2. **流程**:先预览编辑,再入库。
3. **岗位绑定**:在导入界面里选(每行下拉 + 批量「全部应用为某岗位」)。
4. **PDF 存储**:每个 PDF 上传到飞书云空间,记为候选人 `resume` 文档;现有单文件 S3 路径保持不变,本功能用飞书。

## 复用的现有基建(已探索确认)

| 能力 | 位置 |
|---|---|
| PDF 文本抽取 | `server/utils/resume-parser.ts` → `parseDocument(buffer, mimeType)` |
| AI 结构化输出 | `server/utils/ai/provider.ts` → `generateStructuredOutput<T>({config, options:{system,prompt,schema,schemaName}})` |
| AI 配置加载 | `server/utils/ai/loadConfig.ts`(无配置返回 422) |
| AI 抽取范例 | `server/utils/ai/scoring.ts` |
| 单建候选人 + 去重 | `server/api/candidates/index.post.ts`(`(orgId,email)` 唯一,409) |
| 建 application 绑岗 | `server/api/applications/index.post.ts`(初始 status `new`) |
| 文件校验工具 | `server/utils/schemas/document.ts`(MIME 白名单 / 大小 / `sanitizeFilename`) |
| 临时内存存储范式 | `server/utils/chatbotAttachments.ts`(TTL + per-user 上限) |
| 列表 / 入口 | `app/pages/dashboard/candidates/index.vue` |
| 岗位选择器 | `app/components/ApplyToJobModal.vue`(拉 `GET /api/jobs?status=open`) |
| Composables | `useCandidates` / `useApplications` |

候选人表可独立存在(不强制 application),`(orgId,email)` 去重,**email 必填**。

## 架构:两阶段(解析预览 → 提交入库)

避免单请求里给 N 个 PDF 串行跑 AI + 上传飞书导致超时,且只为用户真正导入的行上传飞书文件。

### 阶段 1 — 解析预览 `POST /api/candidates/import/parse`(multipart,多个 PDF)
- 鉴权 + 限流(仿 `chatbot/upload`);`requirePermission(candidate:create)`
- 每个文件:MIME(magic bytes)+ 大小(≤20MB,飞书上限)校验 → `parseDocument()` 抽文本 → `generateStructuredOutput()` 用候选人抽取 schema 让 LLM 输出 `{firstName,lastName,fullName,email,phone,currentTitle,notes}`
- 原始 PDF 字节暂存内存(**新建 `server/utils/importStaging.ts`**,仿 `chatbotAttachments.ts`:key=`${orgId}:${userId}:${tempId}`,TTL ~30min,批量上限),供阶段 2 上传飞书,免重传
- AI 调用并发限流(如 3),整批最多 N 个文件(如 20)
- 返回每行:`{tempId, filename, extracted{...}, emailExists:bool, parseError?}`

### 阶段 2 — 提交入库 `POST /api/candidates/import/commit`(JSON,用户编辑后的行)
- 入参 `rows: [{tempId, firstName, lastName, displayName?, email, phone?, jobId?}]`
- 逐行处理:
  1. 去重:`(orgId,email)` 已存在 → 跳过并标记(不覆盖)
  2. 从内存取该 `tempId` 的 PDF → **上传飞书云空间** → 拿 `file_token`
  3. 建 candidate(复用 `createCandidateSchema` 校验)
  4. 写 `document` 记录:`type=resume`、`storageProvider='feishu'`、`storageKey=file_token`、originalFilename/mimeType/sizeBytes、`parsedContent`=阶段1文本
  5. 若有 `jobId` → 复用建 application 逻辑绑岗(status `new`)
  6. activity_log
- 返回每行结果 `{tempId, status: created|skipped_duplicate|error, candidateId?, message?}`

## 飞书云空间存储(新增)

**新建 `server/utils/feishu.ts`:**
- `getFeishuTenantAccessToken()`:`POST /open-apis/auth/v3/tenant_access_token/internal` `{app_id:env.AUTH_FEISHU_CLIENT_ID, app_secret:env.AUTH_FEISHU_CLIENT_SECRET}` → 模块级内存缓存 token(expire~7200s,剩 <30min 才刷新)
- `uploadToFeishuDrive(buffer, fileName, size)`:`POST /open-apis/drive/v1/files/upload_all` multipart `{file_name, parent_type:"explorer", parent_node:env.FEISHU_DRIVE_FOLDER_TOKEN, size, file}` + `Authorization: Bearer <tenant_token>` → 返回 `file_token`
- `downloadFromFeishuDrive(fileToken)`:`GET /open-apis/drive/v1/files/{file_token}/download` + tenant token → Buffer(供文档下载/预览端点流式代理)

**env(`server/utils/env.ts`):** 新增 `FEISHU_DRIVE_FOLDER_TOKEN`(目标文件夹 token,本功能必填),复用已有 `AUTH_FEISHU_CLIENT_ID/SECRET`。

**document 表(`server/database/schema/app.ts`):** 新增列 `storageProvider text not null default 's3'`(值 `'s3'|'feishu'`);feishu 时 `storageKey` 存 `file_token`。跑 `npm run db:generate` 出迁移。

**下载/预览端点**(`server/api/documents/[id]/download.get.ts`、`preview.get.ts`):按 `storageProvider` 分支——`s3` 走现有 `downloadFromS3`,`feishu` 走 `downloadFromFeishuDrive`。保持服务端代理流式、不暴露外链的现有安全模型。

## 校验 schema(`server/utils/schemas/candidate.ts` 扩展)
- 候选人抽取 schema(AI 用):`{firstName, lastName, fullName?, email?, phone?, currentTitle?, notes?}`(email 允许空,留待人工补)
- commit 入参 schema:rows 数组,每行复用 `createCandidateSchema` 字段 + 可选 `tempId`、`jobId`
- 中文姓名:AI 尽量拆 firstName/lastName,拆不开则整名进 lastName + 设 displayName;**email 缺失或重复的行在阶段 2 一律拦截/跳过**,前端预览强制用户补 email 才能勾选导入

## 前端
- **入口**:`candidates/index.vue` 顶部「Add Candidate」旁加「批量导入」按钮 → 新页 `app/pages/dashboard/candidates/import.vue`
- **import.vue**:
  1. 多选 PDF 拖拽区 → 调阶段1 `parse`(带上传进度)
  2. 可编辑表格:每行 = 文件名 + firstName/lastName/email/phone 输入框 + **岗位下拉**(复用 `ApplyToJobModal` 的 `GET /api/jobs?status=open` 拉取逻辑)+ 状态列(重复邮箱/缺邮箱/解析失败 标记)
  3. 顶部「全部应用为岗位 ▾」批量给所有行设岗位;勾选框选行
  4. 「导入选中(N)」→ 调阶段2 `commit` → 展示每行结果 → 成功跳/链到候选人列表
- **新建 composable** `app/composables/useCandidateImport.ts`(封装 parse / commit)
- i18n:`en.json` + `zh-CN.json` 新增 `dashboard.candidates.import.*` 文案(其余 5 语言自动回退英文)

## 关键改动文件
- **新增**:`server/api/candidates/import/parse.post.ts`、`server/api/candidates/import/commit.post.ts`、`server/utils/feishu.ts`、`server/utils/importStaging.ts`、`app/pages/dashboard/candidates/import.vue`、`app/composables/useCandidateImport.ts`
- **修改**:`server/utils/env.ts`、`server/database/schema/app.ts`(+迁移)、`server/api/documents/[id]/download.get.ts` + `preview.get.ts`(feishu 分支)、`server/utils/schemas/candidate.ts`、`app/pages/dashboard/candidates/index.vue`(入口按钮)、`i18n/locales/en.json` + `zh-CN.json`

## 飞书开放平台前置配置(需你操作)
1. **权限管理**:给已有应用开通云空间上传权限 `drive:file:upload`(或 `drive:drive`),并发布版本。
2. 在飞书云空间建一个文件夹(放简历),从其 URL `.../drive/folder/<token>` 取文件夹 token → 写入 `FEISHU_DRIVE_FOLDER_TOKEN`。
3. 说明:经 tenant_access_token 上传的文件归应用所有,应用可凭 tenant token 取回(应用内预览/下载正常);如需人在飞书界面直接看,可把该文件夹共享给相关成员。

## 验证(端到端)
1. `.env` 填 `FEISHU_DRIVE_FOLDER_TOKEN`,组织在 Settings→AI 配好 provider;`docker compose up --build -d app`。
2. 候选人列表点「批量导入」→ 上传 2–3 个简历 PDF → 预览表格出现、字段已 AI 填充。
3. 改一行字段、给部分行选岗位、用「全部应用为岗位」批量设一个 → 「导入选中」。
4. 校验:候选人列表新增对应候选人;选了岗位的在该岗位 pipeline 出现 application(status new);候选人详情「Documents」有 resume,点预览能看到 PDF(走飞书下载代理);重复邮箱行被跳过并提示。
5. 后端:`document.storageProvider='feishu'`、`storageKey` 为飞书 file_token;飞书云空间目标文件夹里出现上传的 PDF。
6. 失败路径:无 AI 配置 → parse 返回 422 引导去配置;非 PDF / >20MB → 该文件报错不阻塞其余;email 缺失行未补 → 不可勾选导入。

## 风险与备注
- **同步批处理上限**:整批 AI 抽取耗时随文件数线性增长,设上限(~20/批)+ AI 并发限流;超大批量的异步队列 + 进度列为后续增强。
- **AI 抽取准确率**:预览表格强制人工复核(已是流程要求);email 缺失/重复行受控。
- **飞书 tenant token 依赖**:应用须有 drive 上传权限且在租户内已发布,否则上传报权限错误——前置配置已列明。
- **两套存储后端**:document 表用 `storageProvider` 区分,现有 S3 单文件上传路径不受影响;下载/预览端点已分支兼容。
- **中文姓名拆分**:firstName/lastName 必填约束下,拆不准时靠预览人工修正 + displayName 兜底。

## 已核实的飞书接口(出处)
- 授权页/登录(已在用):`accounts.feishu.cn/open-apis/authen/v1/authorize`
- tenant_access_token:`POST /open-apis/auth/v3/tenant_access_token/internal`(返回 token + expire~7200s)
- 云空间上传:`POST /open-apis/drive/v1/files/upload_all`(multipart,≤20MB,需 `drive:file:upload`/`drive:drive`,返回 file_token)
- 云空间下载:`GET /open-apis/drive/v1/files/{file_token}/download`
