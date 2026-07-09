# Tests 说明

## 目录结构

```
tests/
├── unit/                          # 单元测试（快速，无需浏览器）
│   ├── dsl/
│   │   ├── parser.test.ts         # DSL 解析器
│   │   └── locator-resolver.test.ts # 元素定位解析
│   ├── engine/
│   │   ├── context-store.test.ts  # 跨角色变量系统
│   │   └── checkpoint.test.ts     # 断点续跑持久化
│   └── adapters/
│       └── yaml-loader.test.ts    # YAML 加载与 Schema 校验
│
├── integration/                   # 集成测试（需要真实 Playwright 浏览器）
│   ├── dsl-executor.test.ts       # 完整 DSL 命令对真实页面执行
│   └── fixtures/
│       └── test-app.html          # 本地测试 Web App
│
└── plugin-usage/
    └── basic-usage.ts             # 插件用法示例（5 种使用方式）
```

---

## 运行测试

### 单元测试（推荐首先运行）

```bash
npm test
# 或
npx vitest run
```

### 单元测试（Watch 模式，开发时使用）

```bash
npm run test:watch
# 或
npx vitest
```

### 覆盖率报告

```bash
npm run test:coverage
# 报告生成在 coverage/ 目录
```

### 集成测试（需要 Playwright Chromium）

> 首次运行前确保已安装 Playwright 浏览器：
> ```bash
> npx playwright install chromium
> ```

```bash
npm run test:integration
# 或
npx vitest run --config vitest.integration.config.ts
```

---

## 单元测试覆盖范围

| 模块 | 测试文件 | 测试数量 |
|---|---|---|
| DSL Parser | `unit/dsl/parser.test.ts` | 30+ 用例 |
| Locator Resolver | `unit/dsl/locator-resolver.test.ts` | 25+ 用例 |
| Context Store | `unit/engine/context-store.test.ts` | 20+ 用例 |
| Checkpoint | `unit/engine/checkpoint.test.ts` | 15+ 用例 |
| YAML Loader | `unit/adapters/yaml-loader.test.ts` | 15+ 用例 |

---

## 集成测试说明

`tests/integration/dsl-executor.test.ts` 会：

1. 启动本地 HTTP 服务器（随机端口），提供 `fixtures/test-app.html`
2. 启动真实 Chromium 浏览器（无头模式）
3. 对测试页面执行真实 DSL 命令，验证：
   - `open` 导航
   - `input` 填写表单
   - `tap` 点击按钮
   - `$var = CURRENT_URL` / `URL_MATCH` 变量捕获
   - `assert_exists` 断言
   - `check` 复选框
   - `?` 非阻塞模式
   - 完整工作流（提交 → 获取 ID → 审批）

---

## 插件用法示例

`tests/plugin-usage/basic-usage.ts` 展示了 5 种使用方式：

| 用法 | 描述 |
|---|---|
| **Scheduler** | 批量运行整个 cases/ 目录 |
| **WorkflowRunner** | 运行单个 Case，获取结构化结果 |
| **executeScript** | 在已有 Playwright 测试中嵌入 DSL |
| **Checkpoint** | 自定义断点续跑逻辑 |
| **@playwright/test 集成** | 在 Playwright Test 框架中使用 DSL |

---

## 在真实项目中作为插件使用

```bash
# 安装（发布后）
npm install resumewright

# 本地开发阶段
npm install /path/to/resume-wright
```

```typescript
// 导入 API
import { Scheduler, WorkflowRunner, executeScript, ContextStore } from 'resumewright';

// 在 @playwright/test 中使用 DSL
import { test } from '@playwright/test';
import { executeScript, ContextStore } from 'resumewright';

test('my workflow', async ({ page }) => {
  const ctx = new ContextStore();
  await executeScript(`
    open "https://your-app.com"
    tap "role:button[开始]"
    $url = CURRENT_URL
    assert_exists "成功" 10s
  `, page, ctx);
});
```
