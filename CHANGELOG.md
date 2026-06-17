# 变更日志 (Changelog)

本项目的所有重大变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本 2.0.0 (SemVer)](https://semver.org/lang/zh-CN/spec/v2.0.0.html) 规范。

---

## [0.6.0] - 2026-06-17

### 新增 (Added)
- **VS Code 官方语法高亮插件**：在 `vscode-extension/` 目录下开发并打包了配套的 VS Code 语言支持插件，为 `.macro` 宏脚本文件提供高精度的指令、变量、定位前缀高亮，并支持在 YAML 测试用例文件的 `script:` 键值块下自动高亮嵌入的 DSL 脚本（通过 TextMate 语法注入）。
- **一键安装插件命令 (`install-extension`)**：在 CLI 工具中新增了 `resumewright install-extension` 命令。在 npm 包发布后，用户只需运行此命令，便会自动寻找 `.vsix` 文件并调用本地 VS Code 命令行工具进行安装。

### 优化 (Changed)
- **打包精简与依赖清理**：移除了本地语法测试所需的 `vscode-textmate` 和 `vscode-oniguruma` 依赖，重构包体积使插件体积从 213KB 骤降至 5.8KB，并将插件文件关联限制为仅激活真正的 `.macro` 宏脚本。

---

## [0.5.0] - 2026-06-15

### 新增 (Added)
- **基于 RPC 桥接的调试工具 (`$$rw`)**：在页面初始化时通过 `context.exposeBinding` 与 Node.js 进程实现桥接，彻底避免了浏览器和 Node 端双重维护定位逻辑的负担。用户在控制台运行 `await $$rw('指令')` 时将直接使用框架原生的 `resolveLocator` 完成匹配，并可直接在控制台审查匹配到的真实 DOM 元素数组。
- **调试工具 `$$rw` 对 `near` 近邻定位语法的支持**：将近邻计算与过滤算法从执行器中解耦导出，在 `$$rw` 的桥接接口中引入了分词（`tokenize`）及近邻选项检测，支持了在 F12 浏览器控制台直接调试带 `near` 语法的定位器。
- **增强的可选步骤控制流 (`?` 语法)**：优化了以 `?` 开头的可选指令逻辑。可选操作指令（如 `? tap`）执行失败时将跳过当前 step 后续的所有步骤，而可选断言指令（如 `? assert_exists`）执行失败时仅跳过本身，会继续向下执行当前 step 中的其他指令。
- **`open` 页面打开命令支持 `fast` 与自定义超时选项**：允许为 `open` 指定可选的第二个参数（如 `open "url" fast` 或 `open "url" 2s`）。其中 `fast` 可快速跳过网络空闲稳定等待时间并进入下一步（依靠 Playwright 原生的 Locator 自动等待），时间参数可指定自定义网络等待超时时间。
- **全局断言默认超时配置 (`assert_timeout`)**：在全局配置 `config.yaml` 或 case 用例文件中支持配置 `assert_timeout` 参数（支持时间字符串如 `"10s"` 或毫秒数如 `10000`）。该超时时长会统一应用到所有未指定行内时间的断言指令（包括 `assert_exists`、`assert_not_exists`、`assert_title_exists`、`assert_url`），从而优雅、统一地应对异步接口查询慢的测试环境。
- **声明式长效持久化变量 (`persistent_variables`)**：支持在全局配置或 case 用例文件头部通过 `persistent_variables` 数组声明需要跨运行周期保留的变量。在每个步骤执行成功后会自动存储在隔离的 `config/persistent/[case_name].json` 中（不受 `resumewright reset` 缓存重置命令影响），并在下一次用例运行时自动读取恢复至 ContextStore 中，且始终能通过 Web 控制台（Dashboard）的变量可视化面板（Variables Inspector）进行展示与监控。

### 修复 (Fixed)
- **引号定位器中斜杠的转义解析**：修复了定位器中引号剥离与修饰符解析逻辑，支持了引号内含有斜杠的特殊文本定位匹配（例如 `"please user by name/id"/-1`）。
- **近邻定位可达性检测（`isReachable`）优化**：新增了“向上追溯 3 层祖先”的相对节点判定规则。完美解决了现代组件库中复合输入框（如带搜索图标的 Combobox、带有占位符 Span 覆盖的 Input 框）由于内部层叠节点被误判为遮挡而导致定位失败的问题，同时依然保留了外部真正的 Modal 遮挡过滤能力。
- **定位器前缀匹配支持**：修复了定位解析器中对 `css:` 和 `xpath:` 显式前缀匹配的遗漏，使得形如 `"css:input"` 或 `"xpath://button"` 的定位指令能被正确识别。
- **斜杠保护与近邻兼容**：修复了近邻锚点文字由于过早剥去外层双引号而导致字符串内的斜杠被误识别为修饰符的问题。
- **TS 类型安全修复**：修复了 `evaluateAll` 回调函数在 TypeScript 严格模式下对 `(elements, id)` 参数的隐式 `any` 类型报错，完善了类型安全性。

### 变更 (Changed)
- **包管理工具迁移 (npm 转换为 pnpm)**：将项目的依赖管理和 Workspace 工作区模式从 `npm` 迁移至 `pnpm`。清理了旧的锁文件并自动生成 pnpm 锁文件，同步更新了所有开发文档（`AGENTS.md`, `CLAUDE.md`, `README.md`, `demo/README.md`）。

---

## [0.4.0] - 2026-06-14

### 新增 (Added)
- **临近定位修饰符 (Near-Anchor)**：实现了 `near` 语法的近邻定位定位器，支持在页面上多个同名元素中，通过锚点元素和方向性限定（`left`, `right`, `top`, `bottom`）以及可达性过滤（Modal遮挡过滤）来精准点击和输入。
- **元素审查命令 (`inspect`)**：新增 `inspect "定位器"` 指令。执行时会自动在终端和浏览器控制台打印目标元素的详细元信息（tag, id, classes, text, visible, disabled, bbox 坐标和自定义属性），并自动暂停页面以便手动调试。
- **定位器的默认可见性过滤**：为所有定位器（含 XPath 与 CSS）默认应用了 `visible: true` 过滤条件，有效解决了单页应用（SPA）过渡期残留隐藏 DOM 的定位冲突问题。
- **失败截图自动留存**：新增失败步骤自动截图与保存功能，并将活跃的角色 Session 直接在 `RolePool` 中进行归档管理。
- **输入修饰符拓展**：支持在 input 写入命令中指定索引修饰符（如 `input "val" to "name" /0`），极大地提升了表单定位的灵活性。

### 变更 (Changed)
- **代码重构与工具化**：整理并提取了核心基础函数至 `src/utils.ts` 中，并新增开发指令集规约文档 `AGENTS.md`。

---

## [0.3.0]

### 新增 (Added)
- **内置动态日期/时间变量**：DSL 脚本原生支持 `$today`, `$now`, `$date` 的计算与时间偏移量偏置（例如 `$today+3d`, `$now-2h`），并支持从运行上下文中读取自定义格式配置。
- **共享步骤复用 (`use_step` / `use_sub_step`)**：YAML 配置中支持引用已定义的共享步骤，方便快速复用公共流。
- **全局配置支持 (`config.yaml`)**：支持读取项目级的全局配置，实现了对相对路径 URL 及公共基础地址的自动补全。
- **灵活的链接断言 (`assert_url`)**：添加了 `assert_url` 指令，支持对页面当前地址进行精确匹配、相对路径补全和 `*` 通配符模糊判定。

### 优化 (Changed)
- **登录与角色管理优化**：重构了登录自动化机制，允许在角色管理中配置更丰富的自定义属性以匹配多元的角色鉴权逻辑。

---

## [0.2.0]

### 新增 (Added)
- **API 响应缓存机制 (`NetworkInterceptor`)**：实现了接口级别的请求响应缓存机制，支持了跨 BrowserContext 共享状态，并在重置 case 时支持对缓存进行清理。
- **动态 Checklist UI 表单**：在可视化控制面板中增加了动态 Checklist 表单，提供对缓存的提交和管理支持。
- **网络缓存命中率优化**：为 `NetworkInterceptor` 新增了更全面的并发与缓存命中优化逻辑，并覆盖了完整的自动化测试。

---

## [0.1.0]

### 新增 (Added)
- **框架核心引擎发布**：完成了 YAML 工作流加载器（YAML Loader）、DSL 解析器（DSL Parser）、上下文状态仓库（ContextStore）和步骤执行器（Step Executor）的完整骨架。
- **可视化调试看板 (Dashboard Server)**：开发了基于原生 Node.js 的 Dashboard 网页服务器，提供用于 Case 管理和可视化的 REST API 及 Vue 3 SPA 交互面板。
- **截图与容错机制**：支持断言成功时自动截图，支持通过 `on_failure` 配置项在自动化步骤失败时控制重试或中断。
- **基础测试套件**：引入了基于 Vitest 的核心测试，覆盖了解析器与上下文状态的单元测试。
