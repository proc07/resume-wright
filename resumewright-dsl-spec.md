# DSL 语言规范

> ResumeWright 测试脚本描述语言，采用 **BDD + 关键字驱动** 风格。
> 本文档描述 YAML Case 文件中 `script:` 块的完整语法。

---

## 一、设计原则

- **一行一操作**：每条命令完成一个明确动作，无多余嵌套
- **文本优先定位**：直接写界面可见文字，无需写 CSS/XPath
- **符号自动识别**：通过字符串开头符号自动判断定位类型
- **统一变量语法**：全部使用 `$snake_case`，无论在哪里定义和使用
- **内联变量捕获**：变量提取在操作发生后立即执行，时机精确
- **非阻塞容错**：任何命令前加 `?`，失败不中断流程

---

## 二、元素定位系统

### 2.1 完整定位语法表

引擎根据字符串**开头符号或前缀**自动选择定位方式：

| 写法 | 识别方式 | 对应 Playwright | 适用场景 |
|---|---|---|---|
| `"提交申请"` | 默认 | `getByText('提交申请', {exact:true})` | 按钮、链接、标签等可见文字 |
| `"*提交*"` | `*` 包裹 | `getByText(/提交/)` | 包含匹配，文字是子串 |
| `"Approve\|审批通过"` | `\|` 分隔 | `getByText(/Approve\|审批通过/)` | OR 匹配，兼容多语言 |
| `"label:申请金额"` | `label:` 前缀 | `getByLabel('申请金额')` | 表单输入框（有 label）|
| `"placeholder:请输入"` | `placeholder:` 前缀 | `getByPlaceholder('请输入')` | 表单输入框（无 label）|
| `"role:button[确认]"` | `role:` 前缀 | `getByRole('button', {name:'确认'})` | 语义化角色定位 |
| `"testid:btn-approve"` | `testid:` 前缀 | `getByTestId('btn-approve')` | 开发加了 data-testid 的元素 |
| `"title:关闭对话框"` | `title:` 前缀 | `getByTitle('关闭对话框')` | 有 title 属性的图标按钮 |
| `"alt:用户头像"` | `alt:` 前缀 | `getByAltText('用户头像')` | 图片元素 |
| `"//div[@data-action='x']"` | `//` 开头 | `locator('xpath=...')` | XPath（DOM 兜底）|
| `".task-row .btn-approve"` | `.` 开头 | `locator('.task-row .btn-approve')` | CSS 类选择器（DOM 兜底）|
| `"#submit-btn"` | `#` 开头 | `locator('#submit-btn')` | CSS ID 选择器（DOM 兜底）|
| `"@关闭弹窗"` | `@` 开头 | 查 `elements.csv` 别名 | 复杂定位器复用 |

### 2.2 定位优先级

```
testid:   ← 最稳定，开发专门维护
label:    ← 表单输入的首选
role:     ← 语义化，结构稳定
placeholder: ← 无 label 时的备选
"文字"    ← 普通按钮/文字元素
title: / alt: ← 特殊元素
//  .  #  ← DOM 兜底，结构变动即失效
@别名    ← 复杂定位器统一管理
```

### 2.3 文本修饰符

可叠加在任意定位方式后，进一步限定目标：

| 修饰符 | 含义 | 示例 |
|---|---|---|
| `/0` | 第 0 个匹配元素 | `"提交"/0` |
| `/-1` | 最后一个匹配元素 | `"提交"/-1` |
| `/span` | 限定为指定 DOM 标签 | `"提交"/button` |

```bash
tap "审批通过"/0          # 多个同名按钮时取第 0 个
tap "审批通过"/-1         # 取最后一个（弹窗上的按钮通常排在后面）
tap "提交"/button         # 限定只找 button 标签中文字为「提交」的
```

### 2.4 elements.csv — 复杂定位器别名管理

将难以内联书写的复杂 XPath / CSS 统一维护在 `config/elements.csv`：

```csv
"name","locator"
"关闭弹窗","xpath://div[starts-with(@class,'modal-close')]//button"
"首行审批按钮","css:.task-table tbody tr:first-child .btn-approve"
"导出菜单项","xpath://li[@data-menu-key='export']"
```

使用时通过 `@别名` 引用：
```bash
tap "@关闭弹窗"
tap "@首行审批按钮"
tap "@导出菜单项"
```

### 2.5 role 支持的 ARIA 角色

```
button       checkbox     combobox     dialog
gridcell     heading      img          link
listbox      menuitem     menubar      option
radio        row          searchbox    slider
spinbutton   status       switch       tab
tabpanel     textbox      tree         treeitem
alert        log          marquee      timer
tooltip      feed         figure       main
navigation   region       article      form
```

---

## 三、基础动作词汇

### open — 打开页面

```bash
open "/login"                    # 相对路径（自动拼装 base_url）
open "https://app.example.com/login" # 完整绝对路径
open "$workflow_url"             # 使用变量（动态 URL）
open "/workflow/$workflow_id/review" # 相对路径且包含变量插值
```

---

### tap — 点击

```bash
tap "提交申请"                         # 默认文字匹配
tap "label:申请标题"                   # 通过 label 定位（点击 label 关联元素）
tap "role:button[确认提交]"            # 语义化 role
tap "testid:btn-final-approve"         # testid（最稳定）
tap "title:关闭"                       # 图标按钮（有 tooltip）
tap "审批通过"/0                        # 第 0 个
tap "审批通过"/-1                       # 最后一个（弹窗按钮）
tap "*采购*"                           # 包含匹配
tap "Approve|审批通过"                 # 多语言 OR
tap "//div[@data-action='open']"       # XPath 兜底
tap ".task-row:first-child .btn"       # CSS 兜底
tap "@关闭弹窗"                        # elements.csv 别名
tap 0.5 0.5                            # 相对位置点击（屏幕中央）
tap "100" "200"                        # 绝对像素坐标
? tap "跳过引导"                       # 非阻塞：找不到不报错
```

---

### input — 输入

```bash
input "admin@co.com" to "label:邮箱账号"       # 输入到指定 label 的输入框
input "50000"        to "label:申请金额"
input "Q3 采购"      to "placeholder:请输入标题"  # 无 label 时用 placeholder
input "10"           to "role:spinbutton[数量]"   # 数字输入框
input ""             to "label:备注"              # 清空输入框（content 为空字符串）
input "$res.data.title" to "label:标题"           # 输入变量值
input "内容"                                      # 输入到当前焦点元素（配合 tap 使用）
? input "可选内容"   to "label:备注"              # 非阻塞
```

---

### keyboard — 键盘操作

```bash
keyboard "ENTER"
keyboard "TAB"
keyboard "ESCAPE"
keyboard "CONTROL" "A"            # Ctrl+A 全选
keyboard "SHIFT" "ENTER"          # Shift+Enter 换行
```

**支持的 Key（常用）：**
`ENTER` `TAB` `ESCAPE` `BACKSPACE` `DELETE` `SPACE`
`CONTROL` `SHIFT` `ALT`
`ARROWUP` `ARROWDOWN` `ARROWLEFT` `ARROWRIGHT`
`F1`～`F12` `A`～`Z` `0`～`9`

---

### hover — 鼠标悬停

```bash
hover "更多操作"
hover "role:button[操作菜单]"
hover ".dropdown-trigger"
```

---

### scroll_to — 滚动到元素

```bash
scroll_to "提交审批"
scroll_to "testid:footer-section"
scroll_to "//div[@class='page-footer']"
```

---

### screenshot — 截图

将截图附加到当前测试报告，建议在关键步骤后调用：

```bash
screenshot
```

---

### wait — 强制等待

> ⚠️ 尽量少用，优先使用 `assert_exists` 的超时参数

```bash
wait 2s
wait 0.5s
```

---

### check — 操作 checkbox / radio

自动找到离该文字最近的 checkbox 或 radio 进行勾选/反选：

```bash
check "同意服务条款"
check "加急申请"
check "工程部"
```

---

### upload — 上传文件

```bash
upload "./fixtures/budget.xlsx"               # 上传单个文件
upload "./fixtures/attachments/"              # 上传目录下所有文件
```

引擎会自动查找页面上的 `<input type="file">` 元素并调用 `setInputFiles`。

---

### execute_script — 执行 JavaScript

```bash
# 基础用法（返回值赋给变量）
$count = execute_script
         """
         return document.querySelectorAll('.task-row').length;
         """

# 带参数
$pos = execute_script "$workflow_id" "$user_id"
       """
       const workflowId = arguments[0];
       const userId = arguments[1];
       return { workflowId, userId };
       """

# 配合断言使用
assert_text_equal "$count" "5"
```

---

## 四、断言词汇

### assert_exists — 断言元素存在

```bash
assert_exists "提交成功"                   # 断言可见
assert_exists "提交成功" 30s               # 30 秒内出现则通过
assert_exists "testid:status-badge" 10s
assert_exists "审批人"/3                   # 出现恰好 3 次（= 可省略）
assert_exists "审批人"/=3                  # 同上，显式 =
assert_exists "审批人"/>2                  # 出现多于 2 次
assert_exists "审批人"/>=1                 # 出现至少 1 次
assert_exists "审批人"/<5                  # 出现少于 5 次
? assert_exists "可选提示" 5s             # 非阻塞断言
```

---

### assert_not_exists — 断言元素不存在

```bash
assert_not_exists "加载中"                 # 断言 loading 消失
assert_not_exists "错误提示" 10s           # 10 秒内不出现则通过
```

---

### assert_text_equal — 断言文本相等

```bash
assert_text_equal "$status" "已审批"
assert_text_equal "$res.data.status" "approved"
assert_text_equal "$count" "5"
```

---

### assert_title_exists — 断言页面标题

```bash
assert_title_exists "采购审批 - 工作台"
```

---

### assert_url — 断言页面 URL

支持完整 URL 精确匹配、相对 URL 匹配、带有 `*` 的通配符模糊匹配，以及 Hash 路由部分匹配：

```bash
# 1. 完整 URL 精确匹配
assert_url "http://127.0.0.1:61775/purchase/new"

# 2. 相对 URL 匹配 (可带或不带前导斜杠)
assert_url "/purchase/new"
assert_url "purchase/new"

# 3. * 通配符模糊匹配
assert_url "*/purchase/*"
assert_url "*new"

# 4. Hash 路由匹配
assert_url "#/dashboard/overview"
assert_url "*#/dashboard/*"

# 5. 支持可选的超时时间（默认 5s）
assert_url "/purchase/new" 10s
```

---

## 五、HTTP 请求词汇

### 基础用法

```bash
do_get    "https://api.example.com/workflow/$workflow_id"
do_post   "https://api.example.com/approve/$task_id" 201   # 期望 HTTP 201
do_put    "https://api.example.com/item/$item_id"
do_delete "https://api.example.com/item/$item_id"
```

默认期望 HTTP 200，可在 URL 后加状态码自定义。

### 带请求体（POST / PUT）

```bash
do_post "https://api.example.com/submit"
"""
{
  "workflowId": "$workflow_id",
  "action": "approve",
  "comment": "$comment"
}
"""
```

### 带请求头

```bash
do_post "https://api.example.com/submit"
"""
header:{"Authorization": "Bearer $token", "Content-Type": "application/json"}
{
  "action": "approve"
}
"""
```

### 接收响应并赋值

```bash
$res = do_get "https://api.example.com/workflow/$workflow_id"

# JSON 自动解析，使用点号访问字段
assert_text_equal "$res.data.status" "pending"
input "$res.data.title" to "label:申请标题"

# 数组用 .0 .1 访问
assert_text_equal "$res.data.steps.0.role" "manager"
assert_text_equal "$res.data.approvers.0.name" "张三"
```

---

## 六、变量系统

### 6.1 命名规范

| 规则 | 说明 |
|---|---|
| 命名风格 | 统一 `$snake_case`（小写字母 + 下划线）|
| 引用语法 | 统一 `$var_name`，无需花括号 |
| 嵌套访问 | 点号 `.`，例如 `$res.data.id` |
| 数组访问 | `.0` `.1`，例如 `$res.data.steps.0.role` |
| 字符串插值 | 直接嵌入字符串，例如 `"https://api.com/$workflow_id"` |
| 禁止使用 | `${UPPERCASE}` / `$ctx.xxx` / 全大写命名 |

### 6.2 赋值来源

| 来源 | 语法 | 说明 |
|---|---|---|
| 当前页面 URL | `$var = current_url` | 完整 URL 字符串 |
| URL 正则匹配 | `$var = url_match "pattern"` | 取第一个捕获分组 |
| URL 查询参数 | `$var = url_param "key"` | `/list?id=xxx` 中的 `xxx` |
| 页面元素文字 | `$var = "locator"` | 支持所有定位语法 |
| HTTP 响应 | `$var = do_get/post/... "url"` | JSON 自动解析 |
| JS 执行结果 | `$var = execute_script """ js """` | JS return 值 |

### 6.3 内联提取——时机精确

变量赋值语句可出现在 script 的**任意位置**，在动作发生后立即捕获：

```bash
open "https://app.example.com/purchase/new"
input "Q3 采购" to "label:申请标题"
input "50000"   to "label:申请金额"
tap "role:button[提交申请]"

# ← 点击提交后页面跳转，立即在此处捕获新 URL
$workflow_url = current_url
$workflow_id  = url_match "/purchase/([\w-]+)"

assert_exists "申请已提交" 10s
screenshot
```

### 6.4 作用域规则

```
$workflow_url  ← 在任意 step 的 script 中赋值后，
$workflow_id     自动写入 ContextStore 并持久化，
                 后续所有 steps 的 script 均可直接使用。

$res           ← HTTP 响应等临时变量，本 script 块内有效。
                 如需跨步骤使用，显式提取并重新赋值：
                 $task_id = $res.data.currentTask.id

$1 $2 $3       ← 宏的位置参数，仅宏内部有效。
```

### 6.5 变量引用免引号支持

在 DSL 脚本中，引用变量时无需包裹在引号中。系统同时兼容带引号和不带引号的引用方式：

```bash
# 1. 导航命令 (支持无引号)
open $workflow_url
# (等同于：open "$workflow_url")

# 2. 断言命令 (支持无引号)
assert_text_equal $doc_number "PO-2024-001"
# (等同于：assert_text_equal "$doc_number" "PO-2024-001")
```

### 6.6 内置动态日期时间变量 (Relative Dates & Times)

系统内置了三种特殊的日期时间变量：`$today` / `$date`（日期，默认 `YYYY-MM-DD`）以及 `$now`（时间点，默认 `YYYY-MM-DD HH:mm:ss`）。

#### 6.6.1 时间偏移计算 (+n / -n)
支持使用 `+` 或 `-` 进行灵活的时间偏移计算，单位支持：
- `d` (天)
- `M` (月)
- `y` (年)
- `h` (小时)
- `m` (分钟)

#### 6.6.2 动态格式化控制变量 ($date_format & $datetime_format)
如果默认格式无法满足需求，可以通过在脚本上下文中定义控制变量 `$date_format` 与 `$datetime_format` 来动态改变后续所有日期时间变量的输出格式：
- 支持的占位符有：
  - `YYYY`：四位数年份（如 `2026`）
  - `YY`：两位数年份（如 `26`）
  - `MM`：两位数月份（如 `06`）
  - `M`：一位或两位数月份（如 `6`）
  - `DD`：两位数天数（如 `09`）
  - `D`：一位或两位数天数（如 `9`）
  - `HH`：两位数小时（如 `22`）
  - `H`：一位或两位数小时（如 `22`）
  - `mm`：两位数分钟（如 `43`）
  - `m`：一位或两位数分钟（如 `43`）
  - `ss`：两位数秒数（如 `00`）
  - `s`：一位或两位数秒数（如 `0`）

> [!NOTE]
> 如果自定义格式中包含空格（例如 `YYYY-MM-DD HH:mm`），由于分词器规则，变量必须被包裹在引号内（如 `"$now"`），否则会发生解析截断错误。如果不包含空格（如 `YYYY/MM/DD`），则无需包裹引号（如 `$today`）。

#### 6.6.3 综合示例

```bash
# 1. 默认输出 (格式: YYYY-MM-DD)
input $today to "label:申请日期"                   # 输出: 2026-06-09

# 2. 时间偏移 (明天和昨天的日期)
input $today+1d to "label:截止日期"                # 输出: 2026-06-10
input $today-1d to "label:发票日期"                # 输出: 2026-06-08

# 3. 其它单位偏移 (2个月后, 1年前)
input $today+2M to "label:续约日期"                # 输出: 2026-08-09
input $today-1y to "label:历史归档日期"            # 输出: 2025-06-09

# 4. 动态改变日期格式
$date_format = "YYYY/MM/DD"
input $today to "label:斜杠日期"                   # 输出: 2026/06/09
input $today+3d to "label:截止"                   # 输出: 2026/06/12

$date_format = "YYYYMMDD"
input $today to "label:紧凑日期"                   # 输出: 20260609

# 5. 动态改变时间格式 (注意：带空格时，后续变量需加引号)
$datetime_format = "YYYY-MM-DD HH:mm"
input "$now" to "label:操作时间"                   # 输出: 2026-06-09 22:09
input "$now+1h" to "label:任务提醒时间"             # 输出: 2026-06-09 23:09
```

### 6.7 使用示例

```bash
# step1 中捕获
tap "role:button[提交]"
$workflow_url = current_url
$workflow_id  = url_match "/workflow/([\w-]+)"
$doc_number   = "testid:doc-number"          # 从页面元素提取
$res          = do_get "https://api.example.com/workflow/$workflow_id"
$task_id      = $res.data.currentTask.id

# step2 中直接使用 step1 的变量（自动跨步骤，无需引号）
open $workflow_url
assert_text_equal $doc_number "PO-2024-001"
do_post "https://api.example.com/task/$task_id/approve"
```

---

## 七、非阻塞模式

任何命令前加 `?`，该步骤失败时记录警告日志，但**不中断**后续执行：

```bash
? tap "跳过引导"                    # 引导弹窗不一定每次出现
? tap "@关闭广告弹窗"               # 广告弹窗可能不出现
? assert_exists "已归档" 3s         # 归档可能异步完成，非关键断言
? input "可选备注" to "label:备注"  # 备注字段可能不存在
```

---

## 八、宏（Macro）— 可复用操作单元

### 定义宏文件

文件扩展名为 `.macro`，内容为标准 DSL 脚本，支持位置参数 `$1` `$2` `$3`：

```bash
# macros/login.macro
open "/login"
input "$1" to "label:邮箱账号/手机号"
input "$2" to "label:密码"
tap "role:button[登录]"
assert_exists "工作台" 10s
```

```bash
# macros/close_dialog.macro
? tap "@关闭弹窗"
? tap "role:button[取消]"
```

### 调用宏

```bash
macro login "admin@co.com" "password123"         # 与 macro 文件同目录可省略路径
macro ./macros/login "user@co.com" "pass456"     # 显式路径
macro ./macros/close_dialog                       # 无参宏
```

### 框架内置宏

```bash
macro rw:login "$role_name"       # 使用 Role Pool 登录指定角色
macro rw:goto_workflow             # 导航到 $workflow_url
macro rw:wait_status "$text" 30s  # 轮询等待状态变为指定文字
```

---

## 九、元素定位决策树

编写脚本时，按以下顺序选择定位方式：

```
目标元素是什么类型？
│
├─ 表单输入框
│   ├─ 有关联 <label>？          → label:标签文字
│   ├─ 有 placeholder？         → placeholder:占位文字
│   ├─ 有 data-testid？         → testid:xxx
│   └─ 都没有？                 → role:textbox[name] 或 @别名
│
├─ 按钮 / 链接
│   ├─ 有明显可见文字？          → "直接写文字"（getByText 默认）
│   ├─ 只有 tooltip（title）？  → title:提示内容
│   ├─ 有 data-testid？         → testid:xxx（最稳定）
│   └─ 需要语义精确？           → role:button[名称]
│
├─ 弹窗 / 对话框
│   └─ → role:dialog[标题]
│
├─ 图片
│   └─ → alt:图片描述
│
├─ 无任何标识的复杂元素
│   ├─ 有规律的 class？         → .css-selector 或 @别名
│   └─ 只能用结构定位？         → //xpath 或 @别名
│
└─ 需要复用的复杂定位器          → @别名（写入 elements.csv）
```

---

## 十、Playwright 映射速查表

| DSL 语法 | Playwright 实现 |
|---|---|
| `open "url"` | `page.goto(url)` |
| `tap "文字"` | `page.getByText('文字', {exact:true}).click()` |
| `tap "文字"/0` | `page.getByText('文字').nth(0).click()` |
| `tap "文字"/-1` | `page.getByText('文字').last().click()` |
| `tap "文字"/span` | `page.locator('span').filter({hasText:'文字'}).click()` |
| `tap "*文字*"` | `page.getByText(/文字/).click()` |
| `tap "A\|B"` | `page.getByText(/A\|B/).click()` |
| `tap "label:xxx"` | `page.getByLabel('xxx').click()` |
| `tap "placeholder:xxx"` | `page.getByPlaceholder('xxx').click()` |
| `tap "role:button[x]"` | `page.getByRole('button', {name:'x'}).click()` |
| `tap "testid:xxx"` | `page.getByTestId('xxx').click()` |
| `tap "title:xxx"` | `page.getByTitle('xxx').click()` |
| `tap "alt:xxx"` | `page.getByAltText('xxx').click()` |
| `tap "//xpath"` | `page.locator('xpath=//xpath').click()` |
| `tap ".css"` | `page.locator('.css').click()` |
| `tap "@别名"` | `resolveAlias('别名').click()` |
| `input "v" to "label:x"` | `page.getByLabel('x').fill('v')` |
| `input "" to "label:x"` | `page.getByLabel('x').clear()` |
| `keyboard "ENTER"` | `page.keyboard.press('Enter')` |
| `hover "文字"` | `page.getByText('文字').hover()` |
| `scroll_to "文字"` | `page.getByText('文字').scrollIntoViewIfNeeded()` |
| `screenshot` | `page.screenshot({path: '...'})` |
| `check "文字"` | `page.getByLabel('文字').check()` |
| `upload "path"` | `page.locator('input[type=file]').setInputFiles('path')` |
| `assert_exists "文字"` | `expect(page.getByText('文字')).toBeVisible()` |
| `assert_exists "文字" 30s` | `expect(...).toBeVisible({timeout:30000})` |
| `assert_exists "文字"/n` | `expect(page.getByText('文字')).toHaveCount(n)` |
| `assert_not_exists "文字"` | `expect(page.getByText('文字')).not.toBeVisible()` |
| `assert_text_equal "a" "b"` | `expect(a).toBe(b)` |
| `wait 2s` | `page.waitForTimeout(2000)` |
| `do_get "url"` | `page.request.get(url)` |
| `do_post "url" + body` | `page.request.post(url, {data:body})` |
| `$var = current_url` | `ctx.set('var', page.url())` |
| `$var = url_match "p"` | `ctx.set('var', page.url().match(p)?.[1])` |
| `$var = url_param "k"` | `ctx.set('var', new URL(page.url()).searchParams.get('k'))` |
| `$var = ".selector"` | `ctx.set('var', await page.locator('.selector').textContent())` |
| `$var = execute_script """..."""` | `ctx.set('var', await page.evaluate(js))` |
| `? tap "..."` | `try { await tap() } catch { warn(); }` |

---

## 十一、完整 Script 示例

```bash
# step1_create 的完整 script
open "https://app.example.com/purchase/new"

# 表单填写（全部使用 label 定位）
input "Q3 办公设备采购" to "label:申请标题"
input "50000"           to "label:申请金额"
input "Team expansion"  to "label:申请原因"
check "加急申请"
upload "./fixtures/budget.xlsx"

# 提交
tap "role:button[提交申请]"

# 提交后页面跳转，立即捕获变量
$workflow_url = current_url
$workflow_id  = url_match "/purchase/([\w-]+)"

# 验证并截图
assert_exists "申请已提交" 10s
screenshot

# 通过 API 验证服务端状态
$res = do_get "https://api.example.com/purchase/$workflow_id"
assert_text_equal "$res.data.status" "pending"
assert_text_equal "$res.data.amount" "50000"
```

```bash
# step3_finance 的完整 script（使用 step1 捕获的变量）
open "$workflow_url"                           # step1 已写入 ContextStore
assert_exists "待财务审核" 10s

$res = do_get "https://api.example.com/purchase/$workflow_id"
assert_text_equal "$res.data.status" "manager_approved"

input "金额合规，财务确认" to "label:财务意见"
tap "role:button[财务确认通过]"

$final_status = "testid:workflow-status"       # 提交后捕获最终状态
assert_text_equal "$final_status" "已完成"

? assert_exists "已归档" 5s                   # 非阻塞：归档可能异步
screenshot
```
