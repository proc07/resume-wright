# ResumeWright — 项目完整功能与技术规格

> 一个面向 Playwright 的**可恢复执行框架**，支持多角色 Workflow 自动化、步骤级断点续跑、DSL 脚本驱动、并行调度。
>
> DSL 脚本语言的完整语法规范，请参阅 → **[resumewright-dsl-spec.md](./resumewright-dsl-spec.md)**

---

## 一、项目背景与目标

### 痛点

Playwright 脚本是顺序执行的，一旦抛出未捕获异常，进程结束，内存状态全部丢失。面对以下场景时尤其痛苦：

- **多角色审批 Workflow**：User A 提交 → User B 填写 → User C/D 审核，执行链长达数十分钟，中途崩溃必须从头重跑
- **动态 UUID URL**：每次创建 Workflow 产生新 URL，后续角色必须自动获取这个 URL 才能继续操作
- **大规模并行测试**：100+ 个 Case 串行跑，效率低，一个失败不应影响全局
- **非幂等操作**：表单提交、API 调用不能重复执行，崩溃重启后不能直接重放

### 目标

构建一个**对现有代码侵入性极低**的执行框架，让 Playwright 脚本具备：

1. **断点续跑**：从上次失败的步骤继续执行，而不是从头重跑
2. **上下文传递**：动态 UUID URL、表单值等数据在多角色之间自动流转
3. **防重复提交**：已成功的 API 调用在恢复时直接返回缓存，不真实发送
4. **并行执行**：100 个 Case 同时运行，可控并发数
5. **DSL 脚本**：用接近自然语言的关键字风格编写测试步骤，见 [resumewright-dsl-spec.md](./resumewright-dsl-spec.md)

---

## 三、YAML Case 结构规范

每个 Case 是一份 YAML 文件，负责**流程编排**（角色定义、步骤顺序、失败策略、并发配置）。步骤内的具体操作逻辑，通过 `script` 字段内嵌 DSL 脚本编写，语法详见 [resumewright-dsl-spec.md](./resumewright-dsl-spec.md)。

```yaml
name: string          # Case 名称（唯一标识）
description: string   # Case 描述
timeout: number       # 整体执行超时（ms）

roles:                # 角色凭证定义
  <role_name>:
    username: string
    password: string

steps:
  - id: string        # 步骤唯一 ID（Checkpoint 的依据，不可重复）
    role: string      # 执行该步骤的角色名（对应 roles 中的 key）

    script: |         # DSL 脚本块，语法见 resumewright-dsl-spec.md
      open "..."
      tap "..."
      $var = current_url
      ...

    on_failure:       # 失败处理策略（可选）
      strategy: retry | skip | manual
      max_retries: number       # 默认 3
      retry_delay: number       # 重试间隔 ms，默认 3000
      restore_snapshot: boolean # 重试前从快照恢复页面状态

    sub_steps:        # 子步骤（可选，用于 Step 内更细粒度的断点续跑）
      - id: string
        script: |
          ...
        snapshot_before_submit: boolean  # 关键提交前额外保存快照
        on_failure:
          strategy: retry
          max_retries: 3
```

### 3.2 全局配置文件 config.yaml

为了避免在每个 Case 中重复编写相同的设定（例如相同的 `base_url`、默认超时或失败策略），系统支持在项目根目录下定义一个全局的 `config.yaml` 配置文件：

```yaml
base_url: "http://127.0.0.1:3000"
timeout: 30000
login_macro_path: "login"
on_failure:
  strategy: "retry"
  max_retries: 3
  retry_delay: 2000
  restore_snapshot: true
```

#### 配置合并与覆写规则 (Override Rules)
1. **优先度**：如果在具体的用例 YAML 中有显式定义某个配置项，则以用例的定义为准；如果用例中未定义，则自动继承全局 `config.yaml` 的默认值。
2. **`base_url` 相对路径自动补全**：
   - 框架会自动向上下文中注入变量 `$base_url`。
   - 在 DSL 脚本中，如果执行 `open "/relative-path"` 或是 `open "relative-path"`（非 `http://` / `https://` / `about:` 等协议开头的相对路径），系统会自动检测并补全为 `base_url + "/relative-path"`，无需再在脚本里重复写完整的域名端口。

### YAML 职责边界

| 职责 | 由谁负责 |
|---|---|
| 流程顺序、角色分配 | YAML `steps` |
| 步骤失败策略 | YAML `on_failure` |
| 子步骤粒度控制 | YAML `sub_steps` |
| 并发 / 超时配置 | YAML `timeout` + Scheduler 参数 |
| 具体操作、变量捕获 | DSL `script` 块 |
| 变量提取时机 | DSL 内联 `$var = ...`（精确控制）|

---

## 四、六大核心引擎模块

### 4.1 ContextStore — 跨角色变量系统

**解决问题：** 动态 UUID URL 及运行时数据在多角色步骤之间自动传递。

**核心能力：**
- 所有在 DSL `script` 中通过 `$var = ...` 赋值的变量，自动持久化到 ContextStore
- 后续所有步骤的 `script` 中可直接使用 `$var_name`
- 支持点号嵌套访问：`$res.data.status`、`$res.data.steps.0.role`
- 每次 Step 完成后与 Checkpoint 同步写盘，崩溃重启后变量自动恢复

**典型数据流：**
```
step1 script:
  tap "提交申请"             ← 页面跳转到 /workflow/uuid-xxx
  $workflow_url = current_url       ← 精确时机捕获，写入 ContextStore
  $workflow_id  = url_match "/workflow/([\w-]+)"

step2 script:
  open "$workflow_url"       ← 直接读取，无需任何配置
  ...

step3/4 script:
  open "$workflow_url"       ← 同一个变量，即使崩溃重启依然有效
```

**作用域规则：**

| 变量类型 | 定义方式 | 作用域 |
|---|---|---|
| 跨步骤变量 | DSL `$var = ...`（系统自动持久化）| 全局，所有后续 steps 可用 |
| 步骤内临时变量 | DSL `$res = do_get ...` 等 | 本 script 块内有效 |
| 宏位置参数 | `$1` `$2` `$3` | 宏内部有效 |

---

### 4.2 Checkpoint — Step 级断点续跑

**解决问题：** 脚本崩溃重启后，已完成的 Step 自动跳过，从上次失败点继续。

**机制：**
- 每个 Step 完成后立即写盘（原子写，防止写一半崩溃）
- 重启时读取记录，已完成的 Step 直接 Skip 并打印日志
- 同步持久化当前 ContextStore 快照（确保变量不丢失）

**存储路径：** `.resumewright/checkpoints/<case-name>.json`

```json
{
  "caseName": "purchase-order-001",
  "completedSteps": ["step1_create", "step2_manager"],
  "context": {
    "workflow_url": "https://app.com/workflow/a3f9-uuid",
    "workflow_id": "a3f9-uuid"
  },
  "lastUpdated": "2024-01-15T10:24:12Z"
}
```

---

### 4.3 SubStep Store — 子步骤级断点续跑

**解决问题：** Step 内部有多个子操作（填写表单 A → 提交 → 填写表单 B → 提交），某一子操作失败时，从该子操作恢复，而不是整个 Step 重来。

**存储结构：**
```
.resumewright/sub-steps/<step-id>/
  ├── state.json        # 各子步骤完成状态
  ├── api-cache.json    # 该 Step 内所有 API 响应缓存
  └── snapshots/
      ├── sub-step-1.json   # 子步骤开始前的页面快照
      └── sub-step-2.json
```

**state.json 示例：**
```json
{
  "fill_form_a": { "status": "completed", "completedAt": "2024-01-15T10:23:45Z" },
  "upload_file": { "status": "completed", "completedAt": "2024-01-15T10:24:12Z" },
  "call_api":    { "status": "failed", "error": "timeout", "retryCount": 1 }
}
```

---

### 4.4 Network Interceptor — API 拦截与响应缓存

**解决问题：** 防止崩溃重启后，已成功的非幂等 API（POST/PUT/DELETE）被重复调用，导致重复创建记录、重复发邮件、重复计费等副作用。

**拦截逻辑：**
```
请求到来
  ├── GET 请求 → 直接放行
  └── POST / PUT / DELETE / PATCH
        ├── 生成请求指纹（MD5 of Method + URL + Body[:500]）
        ├── 查询 api-cache.json
        │     ├── 命中缓存 → route.fulfill(cachedResponse)（不真实发送）
        │     └── 未命中  → 真实发送 → 成功后立即写入缓存
        └── 继续
```

**挂载时机：** 每个 Step 或 SubStep 开始执行前，通过 `page.route('**/*', handler)` 注册拦截器，Step 完成后移除。

---

### 4.5 DOM Snapshot — 页面快照与状态恢复

**解决问题：** 崩溃后浏览器状态丢失，恢复时需要把页面精确还原到崩溃前的状态。

**快照内容：**
```typescript
{
  id: string,
  url: string,              // 当前页面 URL
  timestamp: number,
  storageState: {           // Playwright 标准格式
    cookies: Cookie[],
    origins: StorageOrigin[]
  },
  pageState: {
    title: string,
    stateIndicator: string  // [data-state] 属性值（页面阶段标识）
  }
}
```

**快照时机：**
- 每个 SubStep 开始执行前自动保存
- YAML 中声明 `snapshot_before_submit: true` 时，在 submit 动作前额外保存

**恢复流程：**
1. 加载快照的 `storageState`，重置 Cookie 和 Storage
2. `page.goto(snapshot.url)` 导航回快照 URL
3. 等待页面加载，继续执行当前子步骤

---

### 4.6 Role Pool — 角色 Session 复用

**解决问题：** 多角色在同一 Workflow 中交替操作，频繁登录登出导致执行效率低。

**机制：**
- 每个角色首次使用时执行真实登录，将 `storageState` 持久化至 `.resumewright/states/<role>.json`
- 后续同角色请求直接加载缓存上下文（`BrowserContext`），秒级切换
- 每次使用前通过 `session_check_url` 校验 Session 是否过期，过期则重新登录并更新缓存
- 每个 Case 拥有独立 Role Pool 实例，不同 Case 的角色上下文相互隔离

---

## 五、错误恢复策略总表

| 失败场景 | 恢复方式 |
|---|---|
| 元素定位失败 | 从当前 SubStep 的 DOM 快照恢复页面，按策略重试 |
| API 接口超时 / 5xx | 按 `max_retries` 重试，`restore_snapshot: true` 时恢复页面后重试 |
| API 已成功但页面随后崩溃 | 缓存拦截阻止重复调用，从快照恢复继续后续操作 |
| 整个 Step 失败 | 从该 Step 的第一个 SubStep 重新开始 |
| Session 过期 | Role Pool 自动重新登录并更新 Session 缓存 |
| 进程意外崩溃 | 重启后读取 Checkpoint + ContextStore，精确续跑 |
| 动态 URL 丢失 | ContextStore 已持久化，重启后 `$workflow_url` 仍然有效 |

---

## 六、CLI 接口

```bash
# 运行所有 Case（默认并发 5）
npx resumewright run

# 指定并发数
npx resumewright run --concurrency 10

# 运行指定 Case
npx resumewright run cases/purchase-approval.yaml

# 有头模式（显示浏览器，用于调试）
npx resumewright run --headed cases/purchase-approval.yaml

# 仅运行上次失败的 Case（自动读取 Checkpoint 续跑）
npx resumewright run --only-failed

# 查看所有 Case 执行状态
npx resumewright status

# 清除指定 Case 的 Checkpoint（从头执行）
npx resumewright reset cases/purchase-approval.yaml

# 清除所有 Checkpoint
npx resumewright reset --all
```
