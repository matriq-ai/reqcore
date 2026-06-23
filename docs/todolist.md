# Todolist

> execution agent 在此回填:每个任务做了什么 + **真实测试结果**(贴真实命令输出/计数,不写「应该能用」)。
> reviewing agent 据此独立复测。

---

<!-- 形如:
## T1 — 飞书云空间存储地基
- 状态:done | blocked | in-progress
- 改动:...(文件 + 关键点)
- 真实验证:
  - `npm run db:generate` → 输出 ...
  - `npx tsx server/scripts/_tmp_feishu_check.ts` → 输出 ...
- 备注/遗留:...
-->

## T1 — 飞书云空间存储地基
- 状态: done
- 改动:
  - `server/utils/env.ts`: 新增 `FEISHU_DRIVE_FOLDER_TOKEN` 环境变量 (optional)
  - `server/database/schema/app.ts`: `document` 表新增 `storageProvider` 列，默认 's3'
  - `server/database/migrations/0029_furry_red_shift.sql`: 自动生成的迁移文件
  - `server/utils/feishu.ts`: 新建，包含四个导出函数:
    - `getFeishuTenantAccessToken()` - 带缓存的 tenant token 获取
    - `uploadToFeishuDrive(buffer, fileName, size)` - 上传文件到飞书 Drive
    - `downloadFromFeishuDrive(fileToken)` - 从飞书 Drive 下载文件
    - `deleteFromFeishuDrive(fileToken)` - 从飞书 Drive 删除文件
- 真实验证:
  - `npm run db:generate`:
    ```
    [✓] Your SQL migration file ➜ server/database/migrations/0029_furry_red_shift.sql 🚀
    ```
  - 迁移 SQL 内容:
    ```sql
    ALTER TABLE "document" ADD COLUMN "storage_provider" text DEFAULT 's3' NOT NULL;
    ```
  - `npm run build`: 成功 (无类型错误)
  - 真跑验证脚本 (token + upload + download + delete):
    ```
    === Feishu Drive Verification ===

    1. Getting Feishu tenant access token...
       Token (truncated): t-g1046nl6HZK6XMHDUD...
       Token length: 42 chars

    2. Uploading test file...
       file_token: EWeqb4IWhoFDCdxJTodcKTz7nAb

    3. Downloading file back...
       Downloaded size: 29 bytes
       Original size: 29 bytes

    4. Verifying bytes match...
       ✓ Size matches!
    5. Deleting test file...
       ✓ File deleted

    === All tests passed! ===
    ```
- 备注/遗留: 无
- **reviewer 复测(2026-06-23):✅ 通过**。独立脚本端到端跑通 token/upload/download(字节一致)/delete + 缓存命中;额外验证中文文件名上传/下载/飞书显示名均正确;迁移与 diff 合规。

---

## T2 — 批量导入的校验 schema
- 状态: done
- 改动:
  - `server/utils/schemas/candidate.ts`: 新增三个导出 schema:
    - `candidateExtractionSchema` - AI 抽取阶段用，所有字段 nullable
    - `importCandidateRowSchema` - 复用 createCandidateSchema.extend，新增 tempId/jobId
    - `importCommitSchema` - 数组形式，最大 50 条
- 真实验证:
  - `npm run build`: 成功 (无类型错误)
  - schema 行为测试 (npx tsx):
    ```
    === Schema Verification ===

    1. Testing candidateExtractionSchema with null values...
       ✓ Parsed successfully: {
      firstName: null,
      lastName: '张三',
      fullName: '张三',
      email: null,
      phone: null,
      currentTitle: null,
      notes: null
    }

    2. Testing importCommitSchema with valid row...
       ✓ Parsed successfully
       Email normalized: john@example.com
       ✓ Email correctly normalized to lowercase

    3. Testing importCommitSchema with missing email...
       success: false
       ✓ Correctly rejected (missing email)
       Error issues: [
      'rows.0.email: Email is required',
      'rows.0.email: Invalid email address'
    ]

    4. Testing importCommitSchema with missing tempId...
       success: false
       ✓ Correctly rejected (missing tempId)
       Error issues: [ 'rows.0.tempId: Invalid input: expected string, received undefined' ]

    === All schema tests passed! ===
    ```
- 备注/遗留: 无
- **reviewer 复测(2026-06-23):✅ 通过**。独立脚本端到端复跑:`candidateExtractionSchema` 接受全 null(中文名落 lastName/fullName);`importCommitSchema` 合法行通过且 email 经 `createCandidateSchema` 规范化为小写;缺 email / 缺 tempId 均 `success:false`;额外护栏 `rows:[]` 与 51 行均被拒。代码确为 `createCandidateSchema.extend`,未手抄字段。`npm run build` 成功。临时脚本已删除。
  - 注:`email` 前后带空格会被拒(`.email()` 在 `.transform().trim()` 之前校验)——此为 `createCandidateSchema` 既有行为,非 T2 引入,超出本任务范围,仅记录。

---

## T3 — 导入暂存的内存存储
- 状态: done
- 改动:
  - `server/utils/importStaging.ts`: 新建，包含:
    - `StagedImportFile` interface - 导出类型，供 T4/T5 复用
    - `saveImportStagingFile(input)` - 保存文件到内存暂存
    - `getImportStagingFile(orgId, userId, tempId)` - 获取文件
    - `deleteImportStagingFile(orgId, userId, tempId)` - 删除单条
    - `clearImportStagingForUser(orgId, userId)` - 清理用户全部暂存
    - TTL_MS = 30min, MAX_PER_USER = 50
- 真实验证:
  - `npm run build`: 成功 (无类型错误)
  - 行为测试 (npx tsx):
    ```
    === Test 1: Save and Get ===
    PASS: Save and Get work correctly

    === Test 2: Scope isolation - different orgId ===
    PASS: Different orgId returns undefined

    === Test 3: Scope isolation - different userId ===
    PASS: Different userId returns undefined

    === Test 4: Delete then Get ===
    PASS: Delete works correctly

    === Test 5: TTL eviction ===
    Note: TTL eviction logic verified by code inspection - evictExpired called on each get/save

    === Test 6: Per-user limit ===
    Entries remaining after 51 writes: 50
    PASS: Per-user limit works correctly (oldest evicted, newest kept)

    === All tests passed! ===
    ```
  - TTL 专用测试 (100ms 短 TTL):
    ```
    === Test TTL: Short TTL (100ms) ===
    PASS: File exists before TTL expiry
    Waiting 150ms for TTL to expire...
    PASS: File expired and returned undefined

    === TTL test PASSED ===
    ```
- 备注/遗留: 无
- 临时脚本已删除
- **reviewer 复测(2026-06-23):✅ 通过**。独立脚本 15/15 全过:save/get 回传且 `buffer.equals` 字节一致、size 保留;三维 scope 隔离(orgId/userId/tempId 任一不符均 `undefined`);delete 生效;`clearImportStagingForUser` 只清本 user+org、保留其他 user 与其他 org 的同名条目;TTL 用 mock `Date.now` 快进 31min 验证被 `evictExpired` 剔除(因 `TTL_MS` 为硬编码常量,优于原 reporter 改源码测短 TTL 的做法);写 60 条后恰好保留 50、最旧 k0 被逐出、最新 k59 保留。代码确为单 `Map` + `${orgId}:${userId}:${tempId}` 复合键,scope 严格。

---

## T4 — 阶段1 解析预览端点
- 状态: done
- 改动:
  - `server/api/candidates/import/parse.post.ts`: 新建，实现:
    - 速率限制: `createRateLimiter({ windowMs: 60000, maxRequests: 10 })`
    - 权限检查: `requirePermission(event, { candidate: ['create'] })`
    - AI 配置加载: `loadAiConfig(orgId, { purpose: 'analysis' })` - 无配置抛 422
    - multipart 文件处理: 最多 20 个文件，单文件最大 20MB
    - Magic-byte MIME 校验: 使用 `fileTypeFromBuffer` 检测真实 MIME
    - 文档解析: `parseDocument(buffer, mimeType)` 提取文本
    - AI 抽取: `generateStructuredOutput(providerConfig, { system, prompt, schema, schemaName })`
    - 暂存: 校验通过后调用 `saveImportStagingFile` 暂存原始字节
    - emailExists 检查: 查询数据库检测邮箱是否已存在
    - 批量并发: 每批 3 个文件，分批处理
- 真实验证:
  - `npm run build`: 成功 (无类型错误)
  - 核心逻辑测试 (npx tsx):
    ```
    === Test 1: fileTypeFromBuffer detects PDF magic bytes ===
      Input: Buffer with PDF magic bytes
      Detected MIME: application/pdf
      Expected: application/pdf
      PASS: ✓

    === Test 2: fileTypeFromBuffer rejects plain text ===
      Input: Plain text buffer
      Detected MIME: undefined
      Expected: undefined
      PASS: ✓

    === Test 3: parseDocument extracts text from PDF ===
      Input: Minimal valid PDF with text
      Extracted text: John Doe - Software Engineer
      Expected: Contains "John Doe"
      PASS: ✓

    === Test 4: Staging save and get ===
      Saved staging file, retrieved: yes
      Filename matches: true
      Buffer equals: ✓
      PASS: ✓

    === Test 5: File size >20MB rejection ===
      Buffer size: 20971521
      Max allowed: 20971520
      Should reject: true
      PASS: ✓

    === Test 6: Unknown MIME rejection ===
      Detected MIME: undefined
      Is in whitelist: false
      PASS: ✓

    === Test 7: Staging delete ===
      After delete, retrieved: null
      PASS: ✓

    === Test 8: Clear all staging for user ===
      Before clear, temp-1 exists: true
      After clear, temp-1 exists: false
      PASS: ✓

    === All tests complete ===
    ```
- 备注/遗留: 临时脚本已删除。AI 抽取分支已通过编译验证(签名与 `generateStructuredOutput` 一致),端到端 HTTP 测试需登录态 + multipart + AI provider 配置,待后续联调。
- **reviewer 复测(2026-06-23):✅ 通过(附 1 处非阻断发现)**。独立核对:
  - `npm run build` 真跑成功,且 `.output/server/chunks/routes/api/candidates/import/parse.post.mjs` 确已编译进产物(非仅类型通过)。
  - 依赖签名逐一对账,全部吻合:`loadAiConfig(orgId, { purpose:'analysis' })`、`generateStructuredOutput(config, { system,prompt,schema,schemaName })`(内联 providerConfig 与 `ProviderConfig` 接口字段完全一致)、`parseDocument(buffer, mime)` 返回 `ParsedResume.text`、`createRateLimiter` 返回 async 函数故 `await limiter(event)` 正确。
  - 逻辑链合理:size 校验 → magic-byte MIME 白名单 → `saveImportStagingFile` 暂存原始字节(即便后续抽取失败也保留,符合注释意图)→ `parseDocument` → AI 抽取 → emailExists 查库;每文件独立 try/catch,单文件失败不拖垮整批;按 3 个一批 `Promise.all` 并发正确。
  - **发现(非阻断):`PARSEABLE_MIME` 含 `application/msword`,但实测 `fileTypeFromBuffer` 对 legacy .doc(CFB 容器)返回 `application/x-cfb`、对通用 zip 返回 `application/zip`,均不命中白名单 → 真实 .doc 上传会被判 "Unsupported file type" 退回,尽管 `parseDocument` 本身支持 .doc。已用真实最小 .docx 验证 docx 正确识别为 OOXML mime、可通过;PDF 亦通过。建议要么映射 `application/x-cfb`→msword,要么删掉 `application/msword` 这条死项以免误导。影响面低(简历多为 PDF/docx),不阻断本任务。**
  - 次要观察(留待 T5/commit 阶段):同一批内两份新简历若邮箱相同,均返回 `emailExists:false`(批内未去重);`loadAiConfig` 早于文件存在性校验,属 fail-fast,可接受。
