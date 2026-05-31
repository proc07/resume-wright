# ResumeWright

> 一个面向 Playwright 的**可恢复执行框架**，支持多角色 Workflow 自动化、步骤级断点续跑、DSL 脚本驱动、并行调度。

---

## 特性

| 特性 | 说明 |
|---|---|
| 🔄 断点续跑 | 从上次失败的步骤继续，不从头重跑 |
| 🔀 跨角色变量 | URL、表单值在多角色步骤间自动流转 |
| 🛡️ 防重复提交 | 已成功的非幂等 API 崩溃重启后自动命中缓存 |
| ⚡ 并行执行 | 最多 N 个 Case 同时运行，可控并发 |
| 📝 DSL 脚本 | 接近自然语言的关键字风格编写测试步骤 |
| 🎭 角色复用 | Session 缓存，角色切换秒级完成 |

---

## 快速开始

### 安装

```bash
npm install
npx playwright install chromium
```

### 编写 Case

```yaml
# cases/my-workflow.yaml
name: "我的工作流"
roles:
  user: { username: "user@co.com", password: "pass" }

steps:
  - id: step1
    role: user
    script: |
      open "https://app.example.com"
      tap "role:button[开始]"
      $url = current_url
      assert_exists "成功" 10s
      screenshot
```

### 运行

```bash
# 运行所有 Case（并发 5）
npx tsx run.ts run

# 运行指定 Case
npx tsx run.ts run cases/my-workflow.yaml

# 有头模式（调试）
npx tsx run.ts run --headed cases/my-workflow.yaml

# 并发 10
npx tsx run.ts run --concurrency 10

# 仅运行上次失败的 Case（续跑）
npx tsx run.ts run --only-failed

# 查看状态
npx tsx run.ts status

# 清除指定 Checkpoint
npx tsx run.ts reset cases/my-workflow.yaml

# 清除所有 Checkpoint
npx tsx run.ts reset --all

# 校验 YAML 语法
npx tsx run.ts validate

# 列出所有 Case
npx tsx run.ts list
```

---

## DSL 语法速览

```bash
# 导航
open "https://app.example.com"
open "$workflow_url"                        # 使用变量

# 点击
tap "提交申请"                              # 文字匹配
tap "role:button[确认]"                     # ARIA role
tap "label:申请标题"                        # label 关联
tap "testid:btn-approve"                    # data-testid
tap "*采购*"                                # 包含匹配
tap "审批通过"/0                            # 第 0 个
? tap "跳过引导"                            # 非阻塞

# 输入
input "Q3 采购" to "label:申请标题"
input "$res.data.title" to "label:标题"    # 变量插值
input "" to "label:备注"                    # 清空

# 断言
assert_exists "提交成功" 10s
assert_exists "审批人"/>2                   # 出现多于 2 次
assert_not_exists "加载中" 5s
assert_text_equal "$status" "已完成"

# 变量捕获
$workflow_url = current_url
$workflow_id  = url_match "/workflow/([\w-]+)"
$doc_no       = "testid:doc-number"        # 从元素提取文字
$res          = do_get "https://api.co.com/workflow/$workflow_id"
assert_text_equal "$res.data.status" "pending"

# 其他
screenshot
wait 2s
check "同意服务条款"
upload "./fixtures/file.pdf"
keyboard "ENTER"
macro login "user@co.com" "password"       # 调用宏
```

---

## 目录结构

```
resume-wright/
├── src/
│   ├── engine/          # 六大核心引擎
│   ├── dsl/             # DSL 解析器与执行器
│   ├── adapters/        # YAML / CSV 加载
│   └── types/           # TypeScript 类型
├── cases/               # Case YAML 文件
├── macros/              # 可复用宏文件（.macro）
├── config/
│   └── elements.csv     # DOM 元素别名
├── fixtures/            # 测试附件
├── .resumewright/       # 运行时状态（加入 .gitignore）
│   ├── checkpoints/     # Step 级 Checkpoint
│   ├── sub-steps/       # SubStep 状态 + API 缓存
│   ├── states/          # 角色 Session 缓存
│   └── screenshots/     # 失败截图
└── run.ts               # CLI 入口
```

---

## 架构图

```
Case YAML + DSL Script
        ↓
  并行调度器（p-limit）
        ↓
  Workflow Engine
  ┌─────────────┬──────────────┬─────────────────┐
  │ Checkpoint  │ ContextStore │  SubStep Store  │
  └─────────────┴──────────────┴─────────────────┘
        ↓
  三层防御体系
  ┌───────────────────────────────────────────┐
  │ Network Interceptor (API 缓存)            │
  │ DOM Snapshot (页面快照恢复)               │
  │ Role Pool (Session 复用)                  │
  └───────────────────────────────────────────┘
        ↓
  Playwright Browsers
```

---

## 配置 elements.csv

将复杂定位器统一维护在 `config/elements.csv`：

```csv
"name","locator"
"关闭弹窗","xpath://div[starts-with(@class,'modal-close')]//button"
"首行审批按钮","css:.task-table tbody tr:first-child .btn-approve"
```

在 DSL 中用 `@别名` 引用：

```bash
tap "@关闭弹窗"
tap "@首行审批按钮"
```

---

## 宏（Macro）

```bash
# macros/login.macro
open "https://app.example.com/login"
input "$1" to "label:邮箱账号"
input "$2" to "label:密码"
tap "role:button[登录]"
assert_exists "工作台" 10s
```

```bash
# 在 Case script 中调用
macro login "user@co.com" "password123"
```

**内置宏：**

```bash
macro rw:login "$role_name"        # 使用 Role Pool 登录
macro rw:goto_workflow             # open "$workflow_url"
macro rw:wait_status "已完成" 30s # 等待状态文字出现
```
