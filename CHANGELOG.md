# 变更日志 (Changelog)

本项目的所有重大变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本 2.0.0 (SemVer)](https://semver.org/lang/zh-CN/spec/v2.0.0.html) 规范。

---

## [Unreleased] - 2026-07-17

### 新增 (Added)
- **`assert_enabled` 与 `assert_disabled` 断言指令**：DSL 脚本原生支持 `assert_enabled "locator"` 与 `assert_disabled "locator"` 两个新指令，支持 `near` 近邻修饰符（如 `assert_enabled "xxx" near "anchor"`），支持尾部 `/all` 过滤修饰符以校验页面上所有符合条件的匹配节点，用于精准校验表单或操作按钮的可用与禁用状态，并支持断言成功时自动截图和超时自定义配置。
- **API 响应顺序采集与回放**：普通运行按请求发起顺序记录同一接口的全部响应，缓存重新运行时使用 Step/SubStep 作用域、请求指纹和 occurrence 逐条回放，支持状态轮询等同接口多响应场景。
- **动态请求体兼容**：请求指纹改为 Method + 归一化 URL；请求体仅用于诊断。同一端点按 occurrence 回放，避免 workflow ID、cache token 等嵌套动态值变化造成写请求缓存误判缺失。旧版 body-based 缓存会在加载时自动迁移。
- **安全的回放错误传播**：写请求缓存缺失时先中止请求，再在 Step/SubStep 生命周期边界抛出错误，避免从 Playwright route 回调抛错导致未处理异常退出。
- **CLI 缓存默认值修复**：`run --read-cache` 现在会默认启用 API 拦截器；此前未同时传入 `--api-cache` 时可能静默禁用缓存并发送真实请求。仍可通过 `--no-api-cache` 显式关闭。
- **会话参数兼容**：URL 指纹会忽略 `globalId` 与 `cacheToken`，避免登录会话或分页令牌变化导致 GET 缓存误判缺失。
- **缓存 attempt 快照隔离**：每次子步骤重试独立采集，仅最近一次成功 attempt 作为有效快照；失败 attempt 不再污染后续缓存重跑。
- **回放差异诊断**：增加未消费缓存、GET 真实返回和写请求缓存缺失报告。GET 缓存耗尽时允许访问真实接口，写请求缓存耗尽时在产生副作用前安全失败。
- **完整 HTTP 响应缓存**：支持记录和回放 2xx、3xx、4xx、5xx，并为响应正文增加 UTF-8/base64 编码标记。
- **逐请求缓存来源标识**：为最新运行持久化 `api-requests.json` 请求记录；Dashboard 在 occurrence 右侧仅为实际缓存命中的接口显示 `cache` 标记，真实网络请求不显示该标记。
- **角色级应用初始化缓存**：在登录或 storageState 恢复前挂载短生命周期 BrowserContext 拦截器，将首页、`config.json` 和 `users/details` 等启动 GET 请求保存到独立的 `role::<role>::bootstrap` scope。不同角色使用独立快照，回放完成角色 bootstrap 后才进入 Step/SubStep 业务缓存，并在 Dashboard 单独展示角色缓存来源。
- **Case 级共享静态启动缓存**：同源白名单中的首页、HTML 和 `config.json` 按 fingerprint 只保存一份，后续角色 and 并发请求直接复用；`users/details` 等动态接口继续按角色隔离。个性化响应通过 Set-Cookie/Vary 自动降级为角色缓存，Dashboard 单独展示共享启动请求及 CACHE 来源。
- **Local Network Access 自动授权**：首次运行、普通重新运行和缓存回放创建 BrowserContext 后、创建 Page 前，均按 `base_url` origin 自动授予 `local-network-access` 权限；缓存回放时阻止 Service Worker 绕过缓存 route，避免 Chromium 权限弹窗阻断登录、在线采集或本地响应回放。不支持该权限的浏览器会告警后继续运行。
- **首次采集缓存可用标记**：请求 journal 新增 `cacheAvailable`，Dashboard 的 CACHE badge 统一表示响应已保存、可以回放；首次真实采集成功后立即显示，同时保留 `fromCache` 诊断实际缓存命中来源。
- **缓存重跑错误截图分区**：最新一次缓存重跑只有最终失败时才写入独立错误截图，并在 Step 下新增“缓存步骤运行快照”；普通运行截图保持不变。

### 变更 (Changed)
- CLI 普通运行默认进入缓存采集模式，只有显式传入 `--read-cache` 才启用顺序回放。
- Dashboard 缓存列表展示 occurrence 顺序，并支持显示没有 SubStep 的普通 Step 缓存。
- Dashboard 共享启动缓存改为 按 Method + 归一化 URL fingerprint 的资源级单行视图，不再重复展示各角色触发记录及 occurrence；磁盘请求 journal 仍保留完整审计信息。
- 使用缓存重新运行不再删除或覆盖首次普通运行的 Step/SubStep 状态、接口请求记录、DOM snapshots、普通截图和 trace；重跑数据写入独立 `cache-rerun-*` overlay，下次普通运行才建立新 baseline。
- 继续兼容旧版 `api-cache.json` 数组，旧条目会按文件顺序自动推导 occurrence。

## [0.8.3] - 2026-07-10

- **VS Code 配色一键同步功能**：
  - 在 DSL 语法着色主题设计器 (Theme Designer) 中，原有的“配置导出与应用”选项卡面板被直接替换为全新的“同步设置 (Sync to VS Code)”一键同步功能。
  - 服务端新增 `/api/theme/sync` REST API，支持将设计好的 TextMateRules 语法配色自动写入并覆盖当前工作区的 `.vscode/settings.json` 配置文件。
  - 支持自动检测 VS Code 工作区根目录（自适应处理 `demo/` 子目录或项目根目录），并智能去除 JSON 文件中的单行/多行注释以支持健壮的文件读取和解析，实现高亮配色的实时渲染生效。
- **看板步骤树复用标识 (Badge) 支持**：
  - 看板左侧步骤树支持识别通过 `use_step` 复用生成的动态步骤节点，接口与前端状态完全打通。
  - 为所有复用步骤卡片在右上角新增精致亮眼的 `REPEAT` 金色角标，提高测试链路关键复用节点的视觉辨识度。

## [0.8.2] - 2026-07-10

- **`use_step` 选择性跳过块 (Selective Skip Blocks) 与源匹配自动登录保护**：
  - 支持在 DSL 脚本中通过成对的注释 `# @skip_block [name]` 声明可选跳过的指令块。直接执行原步骤时，这些块内的指令依旧正常执行。
  - 在 Zod Schema 与 case 类型中为 Step/SubStep 新增 `skip_blocks` 选项，支持 `skip_blocks: true`（跳过所有标记块）或 `skip_blocks: [name1, name2]`（跳过指定名称的块）。
  - 在 YAML 引用展开合并期，按需自动过滤被复用的 `script` 脚本行，实现完全静态、零运行开销的代码块过滤。
  - 在用例加载期新增对所有步骤/子步骤脚本的静态分析。如检测到有头无尾的未闭合 `# @skip_block` 标记，将立即抛出带有文件名及 1-based 行号的清晰解析错误。
  - **源匹配自动登录保护 (Origin-based Auto-Login Skip)**：在步骤执行前，静态探测其脚本（或子步骤脚本）中的首条 `open` 目标 URL。如果该 URL 为绝对地址且其 Origin（协议/域名/端口）与 `config.yaml` 或用例配置的 `base_url` 不同，则该步骤对该角色的执行将自动跳过自动登录（Login Macro）和历史 Session 磁盘缓存载入，创建一个全新的、干净的浏览器上下文，防止向无关域（如 bilibili、百度等）携带本系统登录凭证或执行无效登录脚本。
  - **免 ID 声明与内容寻址稳定 ID 自动生成 (Auto ID Generation & Stability)**：
    - 支持在 `use_step` 复用步骤时缺省声明 `id` 属性。
    - **单次复用向下兼容**：若该模版步骤在用例中仅被引用一次，则自动沿用继承 `template.id`，完全向下兼容原有行为。
    - **多次复用冲突解决与稳定性保证**：若同一模板被多次复用（导致 ID 冲突），系统将自动排除 `id` 属性后，对其余所有控制属性（如 `skip_blocks`、`role` 等）进行字典序排序并计算 SHA-256 哈希值，生成内容寻址的后缀（如 `verify_done_a1b2c3`），若在同一 Case 内依旧存在属性完全相同的多个复用步骤，则在其后递增分配顺序后缀（如 `verify_done_a1b2c3_2`）。这确保了当用户删除或调整中间的某些不同属性步骤时，其余复用步骤的 ID 绝不产生位移变动，有力维护了测试 Checkpoint 断点恢复的稳定性。

## [0.8.1] - 2026-07-09

### 新增 (Added)
- **DSL 语法着色主题设计器 (Theme Designer)**：
  - 设计并实现了一套完全交互式的 DSL 着色主题设计网页（可直接在看板侧边栏快捷访问，或通过路径 `/tools/theme-designer/` 访问）。
  - 支持对 YAML 文件中 DSL 脚本的所有语法关键字、变量、定位修饰前缀、可选修饰符、注释、字符串等进行前景色、背景色、文字样式（加粗、斜体、下划线）的配置与定制。
  - 支持动态新增、删除、修改自定义词法分类及匹配规则（支持关键字列表与正则表达式两种模式），使得后续若新增 DSL 命令或扩展语法时，可以直接通过网页界面编辑分类规则动态适配，具备极强的未来可扩展性。
  - 内置了 One Dark Pro、Dracula、Cyberpunk neon、Solarized Light 以及 GitHub Dark 等多套精美预设主题，支持一键切换。
  - 提供了完整的导入/导出系统：支持将配色配置导出为 JSON 方案文件以便二次导入，导出为 CSS 变量以便集成应用到网页端，以及自动生成对应 VS Code 的 <code>editor.tokenColorCustomizations</code> 样式定制配置片段，实现了编辑器插件与看板的高亮风格打通。
  - 在 Dashboard 看板侧边栏标题区（`AppSidebar.vue`）新增了调色板（🎨）快捷访问按钮；服务端（`server.ts`）新增了对该工具静态资源的映射和拦截托管路由，支持本地开箱即用。

## [0.8.0] - 2026-06-26

### 新增 (Added)
- **`wait_api` 异步接口等待指令**：实现了全新的 DSL 指令 `wait_api`，用于等待页面内触发的异步 XHR/Fetch 接口完成。支持对请求 URL 路径的包含/子串部分匹配以及带 `*` 通配符的模糊匹配。具备在途请求合并等待（如有多个在途的同名匹配请求，使用 `Promise.all` 等待其全部完成）、已完成请求直接通过（不在当前生命周期会话内重复等待）以及未来请求挂起等待机制，并支持指定超时时长与额外的渲染延时。
- **`use_step` 复用步骤首条命令为 `open` 时强制页面重置与网络等待**：当执行通过 `use_step` 复用出来的步骤且其第一条有效指令是打开页面（`open`）时，为避免前序步骤页面残留干扰，测试引擎将自动执行强制页面重置——先调用 `page.goto('about:blank')`，再打开目标 URL；同时强制剥离 `fast` 参数以强迫其执行完整的页面 load 及网络空闲等待，完美确保了复用测试流的独立与隔离。
- **`input` 兼容性 Fallback 写入**：在 input 命令底层引入兼容性检测机制（`fillDslInput`）。当常规的 `locator.fill()` 执行完毕但值因受控状态被清空或丢失时，自动进入 fallback 分支——先聚焦（`focus()`），再使用原生 `value` 属性的原型（prototype）setter 设置值，并分发 `input` 和 `change` 事件，确保受控输入框能够被可靠写入，极大提升了对受控表单的写入稳定性。
- **`execute_script` 命名参数支持**：支持以 `key=value` 的形式向 `execute_script` 传递参数，内部执行 JS 代码时将自动解构这些命名参数为局部变量，无需再编写晦涩的 `arguments[N]`。
- **宏命名参数重构**：将演示宏中的位置参数配合 `# params:` 重构为直观易读的命名参数形式，大幅提升宏代码的可读性与维护性。
- **本地步骤/子步骤复用逻辑支持**：新增了对同用例（Case）文件内前置定义的步骤/子步骤的引用复用支持（当 `use_step` 值不含点号 `.` 时判定为本地引用），支持链式合并与覆盖（Local Wins），避免大段重复测试代码。
- **可选指令空行分界符支持**：在 DSL 解析器中新增了空行解析为 `boundary` 指令的逻辑。这使得在 DSL 脚本中，空行能作为天然的模块分界符，把连续的可选指令（`?` 指令）分割成独立的区块，某一可选指令块报错不再连带影响下一个由空行隔开的独立可选指令块的尝试执行。
- **多匹配定位友好警告展示**：在 DSL 指令（如 `tap`, `input`, `hover`, `scroll_to`, `check` 等）运行时引入了对多匹配定位器的歧义检测。当匹配元素大于 1 时，分别在终端控制台和浏览器 DevTools 控制台以高亮/结构化的形式输出友好警告提示，直接附带匹配到的 DOM 节点对象，并提供具体的索引修饰符修复建议（如 `/0`）。
- **宏与脚本的原生布尔/数字/字符串类型支持**：支持在宏调用（如 `macro form_js true 0 "hello"`) 中保留参数的原生类型，并在变量赋值及 `execute_script` 执行传参时智能识别为 Boolean、Number 和 String。引入防嵌套引号冲突检测，自动解决宏内变量包裹引号时的符号冗余。

### 优化 (Changed)
- **网页看板步骤详情标题耗时展示**：在选中步骤的右侧子步骤面板（`SubStepsPanel.vue`）头部，新增了步骤运行耗时（如 `1.2s` 或 `500ms`）的实时与静态展示。利用计时器在步骤运行中动态更新耗时，并复用了与左侧树一致的格式化逻辑，使用户能在步骤详情页顶部一目了然地看到该步骤的总体执行时间。
- **网页看板步骤节点耗时无遗漏展示与强缓存提醒**：修复了在 Web 看板“用例步骤树”节点中，由于对 `0` 执行了隐式的 JavaScript 逻辑真假判定，导致即使步骤已完成，但如果其耗时在 1ms 以下为 0 时会被隐藏耗时显示的问题。升级了 `StepNode.vue` 的判定为显式非空，并新增 watch 调试日志；在 `cases.ts` 中使用更严格的 `??` 运算符代替 `||` 确保 0 毫秒的耗时能被准确合并渲染，并在 `resetCaseUiState` 中增加对步骤时间的初始清空，防止旧耗时残留。提供浏览器强缓存刷新提醒（`Cmd+Shift+R`）。
- **网页看板运行快照切换范围局载优化**：优化了 Dashboard 控制面板中图片灯箱（Lightbox）的预览交互。当用户点击某一具体 Step 或 SubStep 下的运行快照缩略图时，灯箱的左右切换导航范围将被局限在当前步骤的快照集合内，避免意外浏览到其他步骤的图片，大大提升了步骤级别快照的审查与对比体验。
- **声明式长效持久化变量（`persist_vars`）增强**：在变量的保存和加载阶段实现对变量名键的自适应规范化处理，自动去除可能携带的 `$` 前缀符号。这使得无论用户在配置文件中书写的是 `url` 还是带有前缀的 `$url`，系统均能兼容匹配并正确持久化、载入。
- **`inspect` 指令调试对齐**：修改了 `inspect` 调试检查指令的底层定位解析机制，使其支持与浏览器端 `$$rw` 一致的 plain text 占位符及 label 降级（fallback）定位解析能力，并在其没有找到对应常规匹配时自动触发降级定位和闪烁检查高亮。

### 变更 (Changed)
- **主/子步骤复用关键字统合为 `use_step`**：移除了独立的 `use_sub_step` 配置项。现在无论在主步骤（Step）还是子步骤（SubStep）级别，均统一使用 **`use_step`** 配置项来进行引用和复用。
- **长效持久化变量配置项缩写重构**：将配置项 `persistent_variables` 统一重设为更简洁、可读的 **`persist_vars`**，优化拼写长度与书写体验。

## [0.7.0] - 2026-06-23

### 新增 (Added)
- **表单标签与 Role 免前缀自动识别**：简化常见表单控制元素（如 `checkbox`、`radio`、`button`、`input`、`textarea`、`select`）的定位编写。当不指定特殊定位前缀时，解析器会自动映射为底层的 CSS 或 Role 定位，同时完整支持索引修饰符（如 `input/0` 或 `textarea/-1`）。

### 优化 (Changed)
- **高精度轴投影与全局重试近邻定位算法**：重构了近邻定位算法，引入基于轴投影偏差（`axisGap`）的垂直/水平过滤规则，并扩大重试范围至包括坐标、可达性在内的全局闭环。完美解决了由于方向偏移导致误点上下行同名按钮的痛点（已在 Demo 中补充动态延时渲染列表的防误匹配测试用例）。
- **防冲突的混合截图命名方案**：重构了截图命名规则，在文件名中融合了执行序列号与脚本行号（格式：`${paddedCount}_${lineStr}_${cleanTag}-${stepId}.png`，例如 `01_L12_manual-step_1.png`）。彻底解决了多图截取及多次运行时的名称冲突覆盖问题，并方便用户直接根据行号精准定位 DSL 代码。
- **慢速请求中止优化**：在 `NetworkInterceptor` 注销时，对所有处于真实网络等待状态（`route.fetch`）的路由进行并行 `abort()` 中止，并在 `catch` 块中通过全局注销状态信号进行拦截过滤，彻底避免了退出步骤时由异步请求造成的 `Route is already handled!` unhandled rejection 崩溃。

### 修复 (Fixed)
- **子步骤变量实时写盘与断续恢复**：为 `ContextStore` 引入了 `onChange` 变动监听机制，在变量被修改时立即同步写入 `checkpoint.json`。解决了包含子步骤的主步骤执行中途报错或中断后，因跳过已完成子步骤导致其内定义变量丢失的缺陷，并支持了 Dashboard 中间变量的实时可视化展现。

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
