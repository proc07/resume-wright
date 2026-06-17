# ResumeWright DSL VS Code 插件

本插件为 **ResumeWright DSL** 脚本语言提供官方的 VS Code 语言支持与高保真语法高亮。

## 功能特性

- **文件关联**：自动关联并激活 `.macro` 宏脚本文件。
- **操作指令高亮**：对 `open`、`tap`、`input`、`keyboard`、`hover`、`scroll_to`、`screenshot`、`wait`、`check`、`upload`、`execute_script`、`macro` 和 `inspect` 等指令进行精准着色。
- **断言指令高亮**：支持 `assert_exists`、`assert_not_exists`、`assert_text_equal`、`assert_title_exists` 和 `assert_url` 等断言。
- **HTTP 请求高亮**：支持 `do_get`、`do_post`、`do_put` 和 `do_delete`。
- **变量与属性路径**：完美支持 `$workflow_id` 等变量以及类似 `$res.data.steps.0.role` 的点号/路径属性访问高亮。
- **日期/时间变量偏移**：支持内置日期变量及其偏移量高亮，例如 `$today+1d`、`$now-2h`。
- **定位器前缀与 Role 高亮**：识别字符串中的定位器前缀（如 `label:`、`testid:`、`role:`、`placeholder:`、`title:`、`alt:`、`css:`、`xpath:` 以及 `@alias`），使元素定位更加清晰。
- **尾随修饰符**：支持 `/0`、`/-1`、`/button` 等匹配序号/角色修饰符以及 `/>=1`、`/<5` 等比较断言修饰符。
- **多行块级字符串**：支持三引号（`"""`）多行文本块的高亮，并支持内部的变量插值。
- **语言配置**：包含单行注释符号（`#`）、括号/引号自动闭合（Auto-closing pairs）以及代码块折叠配置。
- **YAML 内嵌语法高亮**：通过 TextMate 语法注入（Syntax Injection），在 YAML 测试用例文件的 `script:` 键值块下自动对 ResumeWright DSL 代码进行高亮显示（需配合 YAML 插件使用）。

---

## 安装方法

### 方法一：使用 VSIX 文件安装（推荐）

你可以直接使用已打包好的 `.vsix` 插件文件进行安装：

1. 打开 VS Code。
2. 按下 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux) 打开命令面板。
3. 输入并选择 `Extensions: Install from VSIX...`。
4. 浏览并选中本目录下的 `resumewright-dsl-0.1.5.vsix` 文件进行安装。

或者，你也可以直接在终端运行以下命令进行安装：
```bash
code --install-extension resumewright-dsl-0.1.5.vsix
```

### 方法二：本地开发模式（软链接安装）

如果你想对插件源文件进行修改并实时查看效果，可以在本地创建软链接：

```bash
# 创建软链接到 VS Code 插件目录 (Mac)
ln -s "/Users/zhangli/Desktop/个人项目/resume-wright/vscode-extension" ~/.vscode/extensions/resumewright-dsl-0.1.5
```

创建软链接后，在 VS Code 中按下 `Cmd+Shift+P`，选择 **Developer: Reload Window**（重新加载窗口）即可立即生效。
