# ResumeWright Demo — 真实项目示例

> 本目录是一个**独立的真实项目**，演示如何以插件形式使用 `resumewright` 框架。

---

## 目录结构

```
demo/
├── cases/                         # 业务 Case YAML 文件
│   ├── purchase-approval.yaml     # 采购申请全流程（3 角色）
│   └── invoice-review-substeps.yaml  # 发票审核（含 sub_steps）
├── config/
│   └── elements.csv               # 项目特定的 DOM 元素别名
├── macros/
│   ├── login.macro                # 登录宏
│   └── close_dialog.macro         # 关闭弹窗宏
├── tests/
│   └── integration/
│       ├── workflow.test.ts       # 完整工作流集成测试
│       └── fixtures/
│           └── demo-app.html      # 本地仿真 Web 应用（3 角色、完整审批链路）
├── vitest.config.ts
├── package.json                   # 依赖 resumewright: "file:../"
└── README.md
```

---

## 安装 & 运行

### 安装依赖

```bash
cd demo
pnpm install
```

### 运行集成测试（验证完整工作流）

```bash
pnpm test
```

### 运行 Cases（需配置真实应用 URL 和账号）

```bash
# 校验 YAML 语法
pnpm run validate

# 运行指定 Case
pnpm run run:purchase

# 运行全部 Cases（并发 5）
pnpm run run:all

# 查看断点状态
pnpm run status

# 清除所有 Checkpoint 重新跑
pnpm run reset && pnpm run run:all
```

---

## 集成测试说明

`tests/integration/workflow.test.ts` 包含 4 个测试套件：

| 套件 | 内容 |
|---|---|
| **DSL 基础命令** | open / input / tap / check / assert_exists / 变量捕获 |
| **完整三角色工作流** | 申请人提交 → 主管审批 → 财务确认 → 申请人验证完成 |
| **Checkpoint 断点续跑** | 模拟崩溃后从断点恢复，验证变量持久化 |
| **YAML Case 校验** | loadCase API 验证两个 Case 文件结构 |

测试流程：

```
requesterPage ──── 登录（申请人）─→ 填写表单 ─→ 提交 ─→ 获取 $workflow_url
                                                              │
                                                              ▼
managerPage ──── 登录（主管）──────────────── open $workflow_url ─→ 审批通过
                                                              │
                                                              ▼
financePage ──── 登录（财务）──────────────────────── open $workflow_url ─→ 财务确认
                                                              │
                                                              ▼
requesterPage ─────────────────────────── 验证状态 = "已完成" ✅
```

---

## 在真实项目中使用（与本 demo 相同方式）

```bash
pnpm add resumewright
```

```typescript
// 1. 直接执行 DSL 脚本（嵌入已有 Playwright 测试）
import { executeScript, ContextStore } from 'resumewright';
const ctx = new ContextStore();
await executeScript(`
  open "https://your-app.com"
  tap "role:button[提交]"
  $url = CURRENT_URL
`, page, ctx);

// 2. 批量运行所有 Cases
import { Scheduler } from 'resumewright';
await new Scheduler('cases', { concurrency: 3 }).runAll();

// 3. 加载并验证 YAML
import { loadCase } from 'resumewright';
const def = loadCase('cases/my-workflow.yaml');
console.log(def.steps.length); // 步骤数
```
