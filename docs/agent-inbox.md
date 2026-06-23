# Agent Inbox

> 本文件由 reviewing agent(Claude,另一 session)维护,是派给 execution agent 的当前任务。
> 一次只放一个任务。做完按 `docs/todolist.md` 的要求回填**真实测试结果**后停下,等待复测与下一个任务。
> 不在本文件内的工作不要做。本文件为空或写「无当前任务」时,停下等待。

---

## 当前任务:T4 — 阶段1 解析预览端点(新建 server/api/candidates/import/parse.post.ts)

### 背景与为什么
「批量 PDF 导入候选人」两阶段。本任务做**阶段1 `parse`**:接收 multipart 的多个简历文件 → 逐个抽文本 + AI 识别候选人字段 → **原始字节暂存内存(T3)** → 返回每行预览。**不碰飞书上传、不入库、不碰前端**——那些是 T5(commit)/前端任务。T1(飞书)、T2(schema)、T3(暂存)均已完成并复测通过,本任务直接 import 复用它们。

### 现状已核实(签名以实际代码为准,计划文档里的调用形态有出入,以下为准)
- **鉴权/限流模板**:`server/api/ai-config/generate-criteria.post.ts`(完整小端点,已读)——`await limiter(event)` → `requirePermission(event, { candidate: ['create'] })` → `orgId = session.session.activeOrganizationId`、`userId = session.user.id`。限流用 `createRateLimiter({ windowMs, maxRequests, message })`(来自 `server/utils/rateLimit`)。
- **multipart + magic-byte MIME 校验范式**:`server/api/chatbot/upload.post.ts`(已读)——`readMultipartFormData(event)` 拿 parts;每个 part 有 `.name/.data(Buffer)/.filename/.type`;用 `fileTypeFromBuffer(buf)`(来自 `file-type`)按**magic bytes**判 MIME,不信前端给的 type。本任务收多个文件:`form.filter(p => p.name === 'files')`。
- **可解析 MIME 白名单**(对齐 chatbot 的 `PARSEABLE_MIME`):`application/pdf`、`application/msword`、`application/vnd.openxmlformats-officedocument.wordprocessingml.document`。计划标题虽说 PDF,但 `parseDocument` 同样支持 doc/docx,一并接受、成本为零。
- **抽文本**:`parseDocument(buffer, mimeType): Promise<ParsedResume | null>`(`server/utils/resume-parser.ts`,已读)。返回 `{ text, sections, metadata }`,失败/不支持返回 `null`。要的就是 `parsed?.text`。
- **AI 配置**:`loadAiConfig(orgId, { purpose: 'analysis' })`(`server/utils/ai/loadConfig.ts`,已读)——**无配置时抛 422**(statusMessage 引导去 Settings→AI)。**在循环外只调一次**,让 422 直接成为整个请求的响应(满足计划「无 AI 配置 → parse 422 引导」)。
- **AI 结构化输出**:`generateStructuredOutput(config, { system, prompt, schema, schemaName, schemaDescription? }): Promise<{ object, usage }>`(`server/utils/ai/provider.ts:163`,已读)。**注意:config 是第一个位置参数**(不是计划文档写的 `{config, options}`)。
- **config 映射**(照搬 generate-criteria.post.ts @37):
  ```ts
  const providerConfig = {
    provider: config.provider as SupportedProvider, // import type { SupportedProvider } from '../../../utils/ai/provider'
    model: config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  }
  ```
- **抽取 schema**:`candidateExtractionSchema`(T2,`server/utils/schemas/candidate.ts`),`schemaName: 'CandidateExtraction'`。
- **暂存**:`saveImportStagingFile({ orgId, userId, tempId, filename, mimeType, size, buffer })`(T3)。`tempId = crypto.randomUUID()`。
- **emailExists 预览提示**:仿 `server/api/candidates/index.post.ts` @12 的去重查询——`db.query.candidate.findFirst({ where: and(eq(candidate.organizationId, orgId), eq(candidate.email, emailLower)), columns: { id: true } })`,有则 `emailExists:true`。email 先 `.toLowerCase().trim()` 再查(与 createCandidateSchema 的规范化一致)。
- **批量/大小上限**:计划 @44/@106——每批最多 **20** 个文件;单文件 ≤ **20MB**(飞书上限,与现有 `document.ts` 的 10MB 不同,本功能用 20MB,在端点内定义局部常量 `IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024`)。AI 并发限流 **3**。

### 工程约定(必须遵守)
- 2 空格缩进;仅在「为什么」不明显处写单行注释。
- **只新建 `server/api/candidates/import/parse.post.ts` 这一个文件**,不加依赖、不建额外抽象。并发控制用**内联的简单分批 `Promise.all`**(把文件数组按 3 个一组,逐组 `await Promise.all`),不要引第三方并发库。
- 字节用 `Buffer`,不落盘。

### 要做的改动 — 新建 `server/api/candidates/import/parse.post.ts`

`export default defineEventHandler` 流程:
1. `await limiter(event)`(`createRateLimiter`,如 `windowMs:60_000, maxRequests:10`)。
2. `requirePermission(event, { candidate: ['create'] })` → 取 `orgId`、`userId`。
3. `loadAiConfig(orgId, { purpose: 'analysis' })`(循环外,一次)→ 映射 `providerConfig`。无配置抛 422 直接返回。
4. `readMultipartFormData(event)` → `const fileParts = (form ?? []).filter(p => p.name === 'files' && p.data && p.filename)`。空 → 400「No files provided」。超过 20 个 → 400「Too many files (max 20)」。
5. 对每个 part,**逐文件处理函数**(用于分批并发),产出一行 `ParseRow`:
   - `const tempId = crypto.randomUUID()`、`filename = part.filename`。
   - 大小:`part.data.length > IMPORT_MAX_FILE_BYTES` → `{ tempId, filename, extracted: null, emailExists: false, parseError: 'File too large (max 20MB)' }`,**不暂存**。
   - magic-byte MIME:`const mime = (await fileTypeFromBuffer(part.data))?.mime`;不在白名单 → `parseError: 'Unsupported file type'`,**不暂存**。
   - 通过校验 → **先 `saveImportStagingFile(...)` 暂存原始字节**(`size: part.data.length`),保证即使后续抽取失败、用户仍可手填字段并在 commit 时上传该文件。
   - `parseDocument(part.data, mime)` → 无 text → `{ ..., extracted: null, parseError: 'Could not extract text' }`(已暂存,行仍可手动补字段导入)。
   - 有 text → `generateStructuredOutput(providerConfig, { system, prompt: text(可截断,如前 12000 字), schema: candidateExtractionSchema, schemaName: 'CandidateExtraction' })` → `extracted = result.object`。
     - AI 调用 try/catch:抛错 → 该行 `extracted: null, parseError: 'AI extraction failed'`(**单文件失败不拖垮整批**),已暂存的字节保留。
   - `emailExists`:`extracted?.email` 非空时按上面查询计算,否则 false。
   - system 提示:简短英文,说明从简历文本抽 `{firstName,lastName,fullName,email,phone,currentTitle,notes}`,找不到给 null,中文姓名拆分策略同 T2 schema 的 `.describe`。
6. 用分批并发(每批 3)跑完所有文件,**保持与输入相同的顺序**返回。
7. 返回 `{ rows: ParseRow[] }`。

`ParseRow` 形状(端点内定义即可,无需导出):`{ tempId: string; filename: string; extracted: CandidateExtraction | null; emailExists: boolean; parseError?: string }`。

### 验收标准
- [ ] 仅新建该 endpoint 文件;鉴权 `candidate:create` + 限流;无 AI 配置走 422。
- [ ] magic-byte 校验 MIME(不信前端 type);单文件 ≤20MB;每批 ≤20 文件;AI 并发 ≤3。
- [ ] 通过校验的文件**已 `saveImportStagingFile` 暂存**且 `tempId` 与返回行一致;单文件解析/AI 失败只标该行 `parseError`、不 500 整请求。
- [ ] 类型/构建不报错。

### 验证(必须真跑,贴真实输出到 todolist)
> 端点要真打需要登录态 + multipart + 配好 AI provider,纯脚本较难。**优先**用一个临时脚本验证「**可独立验证的核心逻辑**」,端到端 HTTP 留作备注说明如何手测。
1. **类型/构建**:`npm run build` 不因本次改动报错,贴结果尾部。(`nuxt typecheck` 在本机 node v25 会 OOM,与改动无关,用 build 验类型。)
2. **核心逻辑真跑**(临时脚本 `server/scripts/_tmp_parse_check.ts`,**无需** AI/登录;把端点里**可抽出的纯函数**或直接 inline 复制校验+暂存逻辑来测,或最小化地 import 真实依赖):至少覆盖——
   - 喂一个**真实 PDF 字节**(可用 T1 思路自造一个极小 PDF,或仓库里若有样例简历则用之)给 `fileTypeFromBuffer` → 确认识别为 `application/pdf`;喂一段纯文本字节 → 确认**不在**白名单被拒。
   - `parseDocument(pdfBuffer, 'application/pdf')` → 贴出 `text` 前若干字符,证明抽取通。
   - 校验「>20MB 拒绝」「未知 MIME 拒绝」两条分支返回 `parseError` 且**未**调用 `saveImportStagingFile`;一条合法 PDF 走完后 `getImportStagingFile(orgId,userId,tempId)` 能取回且字节一致。
   - 跑完删除临时脚本。
3. **AI 抽取**:若本机 `.env`/DB 难以构造 analysis 配置,可**仅对 `generateStructuredOutput` 的调用形态做编译期保证**(build 通过即证明签名正确),并在 todolist 备注「AI 抽取分支已编译验证,端到端待联调」。**不要**伪造「应该能用」。

### 不许标记完成的情况
- 信前端给的 `part.type` 当 MIME(没用 magic bytes)→ 返工(安全要求)。
- 单文件失败导致整请求 500(没做 per-file try/catch)→ 返工。
- 校验通过却没暂存,或暂存 `tempId` 与返回行对不上 → 返工(会让 T5 取不到文件)。
- 没真跑 build / 核心逻辑脚本就标 done。

完成并回填 `docs/todolist.md`(新增 T4 段,贴真实输出)后停下,等待复测。

---

<details>
<summary>T2 原任务规格(留档)</summary>

## T2 — 批量导入的校验 schema(扩展 server/utils/schemas/candidate.ts)

### 背景与为什么
「批量 PDF 导入候选人」分两阶段:阶段1 `parse` 让 LLM 从简历抽出候选人字段;阶段2 `commit` 把用户编辑后的行入库。本任务只做这两阶段都要用的 **zod 校验 schema**,不碰端点、不碰 AI 调用、不碰前端。后续 T4(parse)/T5(commit)直接 import 这里的 schema。

现状已核实:
- `server/utils/schemas/candidate.ts` 已有 `createCandidateSchema`(@22:firstName/lastName/email 必填,email 会 `.toLowerCase().trim()`;displayName/phone/gender/dateOfBirth/quickNotes 可选)、`updateCandidateSchema`、`candidateQuerySchema`、`candidateIdParamSchema`。
- AI 结构化输出范式(见 `server/utils/ai/scoring.ts` 顶部 + `server/utils/ai/provider.ts:163` 的 `generateStructuredOutput<T>({config, options:{system,prompt,schema,schemaName,schemaDescription?}})`):schema 用 `z.object({...})` 定义,配 `schemaName`;底层走 Vercel AI SDK `generateObject`。
- `document` 表无关字段不在本任务。

### 工程约定(必须遵守)
- 2 空格缩进;仅在「为什么」不明显处写单行注释。
- 不引入新抽象/不建新文件——**只在 `candidate.ts` 里加导出**,对齐现有 schema 的写法(`export const xxxSchema = z.object(...)` + 必要时 `export type`)。

### 要做的改动 — 在 `server/utils/schemas/candidate.ts` 末尾新增

**1. AI 抽取 schema(阶段1,LLM 用)**
```ts
/** Shape the LLM must return per resume. All fields nullable — model returns null when a field isn't found; email/name get corrected by the user in the preview table before commit. */
export const candidateExtractionSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  currentTitle: z.string().nullable(),
  notes: z.string().nullable(),
})
export type CandidateExtraction = z.infer<typeof candidateExtractionSchema>
```
- 用 `.nullable()` 而非 `.optional()`:让模型**总是返回每个 key**(找不到给 null),比省略字段更稳。
- **不要**在这个 schema 上加 `.email()` / `.min(1)` 之类强校验——抽取阶段允许脏数据,人工在预览表里改;真正的校验留给下面的 commit schema。
- 给关键字段补 `.describe(...)`(英文)引导抽取,尤其交代**中文姓名**拆分策略:能拆就 firstName/lastName,拆不开把整名放 lastName、fullName 给完整姓名。

**2. commit 入参 schema(阶段2)**
```ts
/** One row the user confirmed for import. Reuses createCandidateSchema's field rules (email required + normalized), plus the staging id and optional job binding. */
export const importCandidateRowSchema = createCandidateSchema.extend({
  tempId: z.string().min(1),
  jobId: z.string().min(1).optional(),
})

export const importCommitSchema = z.object({
  rows: z.array(importCandidateRowSchema).min(1).max(50),
})
export type ImportCandidateRow = z.infer<typeof importCandidateRowSchema>
```
- **复用 `createCandidateSchema`**(用 `.extend`),从而 email 在 commit 阶段强制必填 + 规范化,与「缺 email 的行不可导入」的产品规则一致。
- `tempId` 关联阶段1暂存的 PDF;`jobId` 可选(选了才建 application 绑岗)。
- `.max(50)`:批量上限的护栏(parse 端点会另设每批文件数上限,计划暂定 ~20;此处取个不小于它的值即可)。

### 验收标准
- [ ] `candidate.ts` 新增 `candidateExtractionSchema` + 类型、`importCandidateRowSchema`、`importCommitSchema` + 类型,均已 export。
- [ ] commit row 复用 `createCandidateSchema`(`.extend`),不是另起一套字段。
- [ ] 类型/构建不报错。

### 验证(必须真跑,贴真实输出到 todolist)
1. **类型**:`npm run build`(或 `npx nuxt typecheck`)不因本次改动报错,贴结果尾部。
2. **schema 行为真跑**:写临时脚本(如 `server/scripts/_tmp_schema_check.ts`,**无需** `.env`),`npx tsx` 跑并贴输出,至少覆盖:
   - `candidateExtractionSchema.parse({firstName:null,lastName:'张三',fullName:'张三',email:null,phone:null,currentTitle:null,notes:null})` → 通过(证明 null 可接受)。
   - `importCommitSchema` 对一条**合法行**(含 tempId、合法 email、firstName/lastName)`.parse` 通过;email 经 `createCandidateSchema` 规范化为小写。
   - `importCommitSchema.safeParse` 对**缺 email** 和 **缺 tempId** 的行分别返回 `success:false`(贴出 `error.issues` 里相关字段)。
   - 跑完删除临时脚本。

### 不许标记完成的情况
- 上述任一 `parse`/`safeParse` 预期与实际不符就标 blocked,贴真实输出,不要写「应该能用」。
- commit row 没复用 `createCandidateSchema`(手抄一份字段)→ 返工。

完成并回填 `docs/todolist.md` 后停下,等待复测。

</details>

---

## ✅ 已完成并复测通过

### T3 — 导入暂存的内存存储
reviewing agent 已独立复测通过(2026-06-23):仅新建 `server/utils/importStaging.ts`,导出 `StagedImportFile` + `saveImportStagingFile`/`getImportStagingFile`/`deleteImportStagingFile`/`clearImportStagingForUser`。独立脚本 15/15:save/get `buffer.equals` 字节一致、三维 scope 隔离(orgId/userId/tempId)、delete 生效、`clearImportStagingForUser` 只清本 user+org、TTL 用 mock `Date.now` 快进 31min 触发 `evictExpired`、写 60 条恰好留 50(最旧逐出/最新保留)。复合键 `${orgId}:${userId}:${tempId}`,scope 严格。详见 `docs/todolist.md` T3。备注(超出本任务、留给后续):进程内单 `Map`,多实例/重启暂存会丢——T5 commit 若假设 phase1/phase2 命中同进程,水平扩容时需粘性会话或换共享存储。

<details>
<summary>T3 原任务规格(留档)</summary>

#### T3 — 导入暂存的内存存储(新建 server/utils/importStaging.ts)
- 仿 `chatbotAttachments.ts`:模块级 `Map` + `key(orgId,userId,tempId)` 严格 scope 隔离 + `TTL_MS=30min` + `MAX_PER_USER=50` + `evictExpired()` + 写入前按 (org,user) 淘汰最旧。
- 导出 `interface StagedImportFile { tempId; userId; orgId; filename; mimeType; size; buffer:Buffer; expiresAt }` 供 T4/T5 复用。
- 导出 `saveImportStagingFile(input)` / `getImportStagingFile(orgId,userId,tempId)` / `deleteImportStagingFile(orgId,userId,tempId)` / `clearImportStagingForUser(orgId,userId)`。
- 存原始字节 `Buffer`,不落盘、不序列化。验证:`npm run build` + 临时脚本覆盖 save/get 字节一致、scope 隔离、delete、TTL、人均上限。

</details>

### T2 — 批量导入的校验 schema
reviewing agent 已独立复测通过(2026-06-23):`candidate.ts` 新增 `candidateExtractionSchema`(+类型)、`importCandidateRowSchema`、`importCommitSchema`(+类型)均已 export;commit row 确为 `createCandidateSchema.extend`(未手抄字段)。独立脚本复跑:全 null 抽取通过、合法行通过且 email 规范化小写、缺 email/缺 tempId/空数组/51 行均被拒;`npm run build` 成功;临时脚本已删。详见 `docs/todolist.md` T2。

### T1 — 飞书云空间存储地基
reviewing agent 已独立复测通过(2026-06-23):迁移 `0029` 正确;`env.ts`/`app.ts` diff 合规;`feishu.ts` 四函数 token/upload/download/delete 用真实凭证端到端跑通(含中文文件名,下载字节一致);无残留脚本。验收全过。下方为原任务规格,留档。

<details>
<summary>T1 原任务规格(留档)</summary>

#### 飞书云空间存储地基(env + storageProvider 列 + server/utils/feishu.ts)

### 背景与为什么
「批量 PDF 导入候选人」功能(完整计划见 `docs/批量PDF导入候选人-研发计划.md`)要把简历 PDF 存到飞书云空间而非 S3。这是整个功能的**地基**:先把存储后端、DB 列、env 准备好,后续 parse/commit 端点和前端再依赖它。本任务**只做地基,不碰端点、不碰前端**。

现状已核实:
- 飞书 SSO 已上线,`.env` 里 `AUTH_FEISHU_CLIENT_ID` / `AUTH_FEISHU_CLIENT_SECRET` 已配且非空 → tenant token 可真实拉取。应用为 `cli_aaba57b3e87b5bd4`。
- **存储目标已定并实测通过:应用自有 Drive 文件夹 `reqcore-resumes`**(folder token `JajHfypC1lBrt2d2gDmcUr8mnIc`)。已写入 `.env` 的 `FEISHU_DRIVE_FOLDER_TOKEN`。上传走 `parent_type:'explorer'` + 该 folder token。
- **应用 drive scope 已发版生效**:reviewing agent 用 bot 身份(= 同一应用 tenant token)实测 上传→下载→删除 全部成功,下载字节与原文件一致。所以 `feishu.ts` 的 upload/download 这次**可以也必须真跑验证**(用 bot 身份)。
- (历史:曾尝试存进 wiki 节点「招聘工作」,但 tenant 身份写 wiki 节点被拒 `forbidden 1061004`,故改用应用自有 Drive 文件夹。)
- 现有 S3 工具:`server/utils/s3.ts`(`uploadToS3` @57、`downloadFromS3` @78、懒初始化 client @26)——`feishu.ts` 的写法对齐它。
- `document` 表:`server/database/schema/app.ts:130`,目前 `storageKey` @135 注释说是 S3 object key。
- env 飞书块:`server/utils/env.ts:169-186`。
- 迁移目录:`server/database/migrations/`,最新 `0028`,下一个将是 `0029`。

### 工程约定(必须遵守)
- 2 空格缩进;仅在「为什么」不明显处写单行注释,不写废话注释。
- 不引入超出本任务的新抽象;扁平的单文件函数,不要 class。
- 对齐 `s3.ts` 的既有风格:模块级懒初始化 + 模块级缓存,函数 `export async function`。

### 要做的改动

**1. `server/utils/env.ts`** — 在飞书块(`AUTH_FEISHU_PROVIDER_NAME` 之后,约第 186 行)新增:
```ts
/** Feishu Drive folder token where imported resume PDFs are uploaded (parent_type=explorer). Required for batch PDF import. */
FEISHU_DRIVE_FOLDER_TOKEN: emptyToUndefined.pipe(z.string().min(1)).optional(),
```
保持 `.optional()`(不在 schema 层强制,运行时用到再校验),与同块其它飞书变量一致。`.env` 里已填好该值。

**2. `server/database/schema/app.ts`** — `document` 表新增列(放在 `storageKey` 之后):
```ts
storageProvider: text('storage_provider').notNull().default('s3'),
```
并把 @127 的注释从「`storageKey` is the S3 object key」更新为说明:`s3` 时为 S3 object key,`feishu` 时为飞书 file_token。
然后跑 `npm run db:generate` 生成迁移(应得到 `0029_*.sql`)。**不要手写迁移**,让 drizzle-kit 生成。

**3. 新建 `server/utils/feishu.ts`** — 三个导出函数,对齐 `s3.ts` 风格:
- `getFeishuTenantAccessToken(): Promise<string>`
  - `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`,body `{ app_id: env.AUTH_FEISHU_CLIENT_ID, app_secret: env.AUTH_FEISHU_CLIENT_SECRET }`。
  - 模块级缓存 token + 过期时刻(返回含 `tenant_access_token` 和 `expire`,单位秒,约 7200);剩余 < 30min 才刷新。
  - 缺少 client id/secret 时抛清晰错误。
- `uploadToFeishuDrive(buffer: Buffer, fileName: string, size: number): Promise<string>`
  - `POST https://open.feishu.cn/open-apis/drive/v1/files/upload_all`,multipart `{ file_name, parent_type: 'explorer', parent_node: env.FEISHU_DRIVE_FOLDER_TOKEN, size, file }`,header `Authorization: Bearer <tenant_token>`。
  - 缺 `FEISHU_DRIVE_FOLDER_TOKEN` 时抛清晰错误。返回 `file_token`。
- `downloadFromFeishuDrive(fileToken: string): Promise<Buffer>`
  - `GET https://open.feishu.cn/open-apis/drive/v1/files/{file_token}/download` + tenant token → `Buffer`。
  - 注意飞书返回的非 0 `code` 要当错误抛(带 `code`/`msg`),不要把错误 JSON 当文件返回。
- `deleteFromFeishuDrive(fileToken: string): Promise<void>`
  - `DELETE https://open.feishu.cn/open-apis/drive/v1/files/{file_token}?type=file` + tenant token。
  - 对齐 `s3.ts` 的 `deleteFromS3`(@100)。供测试清理用,后续候选人/文档删除端点接 feishu 分支时也会复用。非 0 `code` 抛错。

### 验收标准
- [ ] env 新增变量,`document` 表有 `storage_provider` 列且默认 `'s3'`,生成了 `0029_*.sql` 迁移。
- [ ] `server/utils/feishu.ts` 四个函数(token / upload / download / delete)实现完成,token 有模块级缓存与提前刷新逻辑。
- [ ] 类型/构建不报错。
- [ ] `getFeishuTenantAccessToken()` 用 `.env` 里的真实凭证**真的拉到了** token。
- [ ] `uploadToFeishuDrive` / `downloadFromFeishuDrive` 用真实凭证对 `FEISHU_DRIVE_FOLDER_TOKEN` 跑通(上传→下载字节一致),测试文件已清理。

### 验证(必须真跑,贴真实输出到 todolist)
1. **迁移**:跑 `npm run db:generate`,贴出新生成的 `server/database/migrations/0029_*.sql` 路径和其中关于 `storage_provider` 的 SQL。
2. **类型**:跑 `npx nuxt typecheck`(或 `npm run build` 至少不因本次改动报类型错),贴结果尾部。
3. **token + upload/download/delete 真跑**:写一个临时脚本(如 `server/scripts/_tmp_feishu_check.ts`,先加载 `.env`),依次:① `getFeishuTenantAccessToken()`(贴 token 截断 + expire);② `uploadToFeishuDrive(buf, name, size)` 传个几字节小文件 → 贴 file_token;③ `downloadFromFeishuDrive(file_token)` 取回并断言字节与上传一致;④ `deleteFromFeishuDrive(file_token)` 删掉测试文件。`npx tsx` 运行,**贴出全部真实输出**,验证后删除临时脚本。
   > 参考:reviewing agent 已用 `lark-cli --as bot`(= 同一应用 tenant token)验证过同一文件夹的 上传→下载→删除 全部可行,所以这步预期能通;通不过就贴错误标 blocked。

### 不许标记完成的情况
- token 真跑没成功(报权限/网络错)→ 标记 blocked,贴错误,不要写「应该能用」。
- upload / download 没有用真实凭证跑通就标 done。应用 drive scope 已发版生效、文件夹已建好,**这次必须真跑**:`uploadToFeishuDrive` → `downloadFromFeishuDrive`(校验字节一致)→ `deleteFromFeishuDrive` 清理,贴真实输出。

完成并回填 todolist 后停下,等待复测。

</details>
