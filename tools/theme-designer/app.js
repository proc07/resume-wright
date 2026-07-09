// ==========================================================================
// ResumeWright DSL Theme Designer - Logic Script
// ==========================================================================

// 默认的语法着色分类（内置匹配规则与作用域）
const DEFAULT_CATEGORIES = [
  {
    id: "comment",
    name: "注释 (Comments)",
    color: "#8b949e",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: true,
    underline: false,
    scope: "comment.line.number-sign.resumewright",
    ruleType: "regex",
    ruleValue: "#.*$"
  },
  {
    id: "string",
    name: "字符串 (Strings)",
    color: "#a5d6ff",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: false,
    underline: false,
    scope: "string.quoted.double.resumewright",
    ruleType: "regex",
    ruleValue: "\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|\"\"\"[\\s\\S]*?\"\"\""
  },
  {
    id: "escapes",
    name: "转义符 (Escapes)",
    color: "#ff7b72",
    bg: "#000000",
    bgEnable: false,
    bold: true,
    italic: false,
    underline: false,
    scope: "constant.character.escape.resumewright",
    ruleType: "regex",
    ruleValue: "\\\\."
  },
  {
    id: "variable",
    name: "变量 (Variables)",
    color: "#ff7b72",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: false,
    underline: false,
    scope: "variable.other.readwrite.resumewright",
    ruleType: "regex",
    ruleValue: "\\$[a-zA-Z_]\\w*(?:\\.\\w+)*|\\$[1-9]\\d*|\\$(today|date|now)(?:[+-]\\d+[dmhyM])?"
  },
  {
    id: "optional_prefix",
    name: "可选前缀 (? 符号)",
    color: "#ff7b72",
    bg: "#000000",
    bgEnable: false,
    bold: true,
    italic: false,
    underline: false,
    scope: "keyword.operator.optional.resumewright",
    ruleType: "regex",
    ruleValue: "^\\s*(\\?)\\s"
  },
  {
    id: "command",
    name: "指令 (Commands)",
    color: "#79c0ff",
    bg: "#000000",
    bgEnable: false,
    bold: true,
    italic: false,
    underline: false,
    scope: "keyword.control.flow.action.resumewright",
    ruleType: "keywords",
    ruleValue: "open, tap, input, keyboard, hover, scroll_to, screenshot, wait, check, upload, execute_script, macro, inspect, wait_api, assert_exists, assert_not_exists, assert_text_equal, assert_title_exists, assert_url, do_get, do_post, do_put, do_delete, goto, back"
  },
  {
    id: "builtins",
    name: "系统变量/函数 (Built-ins)",
    color: "#79c0ff",
    bg: "#000000",
    bgEnable: false,
    bold: true,
    italic: false,
    underline: false,
    scope: "support.function.builtin.resumewright",
    ruleType: "keywords",
    ruleValue: "CURRENT_URL, URL_MATCH, URL_PARAM"
  },
  {
    id: "locator_prefix",
    name: "定位修饰前缀 (Locator Prefixes)",
    color: "#f0883e",
    bg: "#000000",
    bgEnable: false,
    bold: true,
    italic: false,
    underline: false,
    scope: "entity.name.tag.locator.prefix.resumewright",
    ruleType: "regex",
    ruleValue: "\\b(role|label|testid|css|xpath)(:)|@\\w+"
  },
  {
    id: "locator_modifiers",
    name: "定位修饰词 (Modifiers)",
    color: "#79c0ff",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: false,
    underline: false,
    scope: "keyword.operator.word.resumewright",
    ruleType: "keywords",
    ruleValue: "to, near, left, right, top, bottom, nth"
  },
  {
    id: "operators",
    name: "运算符 (Operators)",
    color: "#79c0ff",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: false,
    underline: false,
    scope: "keyword.operator.arithmetic.resumewright",
    ruleType: "regex",
    ruleValue: "=|\\+|\\-|\\*"
  },
  {
    id: "numbers_durations",
    name: "数值与时长 (Numbers/Durations)",
    color: "#d2a8ff",
    bg: "#000000",
    bgEnable: false,
    bold: false,
    italic: false,
    underline: false,
    scope: "constant.numeric.offset.resumewright",
    ruleType: "regex",
    ruleValue: "\\b\\d+(?:ms|s|m|h)?\\b"
  }
];

// 内置主题预设
const PRESETS = [
  {
    id: "github-dark",
    name: "GitHub Dark",
    isDark: true,
    colors: {
      bgApp: "#0d1117",
      bgCard: "rgba(22, 27, 34, 0.75)",
      bgInput: "#090d13",
      border: "rgba(48, 54, 61, 0.8)",
      textMain: "#e6edf3",
      textMuted: "#8b949e",
      comment: "#8b949e",
      string: "#a5d6ff",
      escapes: "#ff7b72",
      variable: "#ff7b72",
      optional_prefix: "#ff7b72",
      command: "#ff7b72",
      builtins: "#79c0ff",
      locator_prefix: "#f0883e",
      locator_modifiers: "#79c0ff",
      operators: "#79c0ff",
      numbers_durations: "#d2a8ff"
    }
  },
  {
    id: "one-dark",
    name: "One Dark Pro",
    isDark: true,
    colors: {
      bgApp: "#282c34",
      bgCard: "rgba(33, 37, 43, 0.75)",
      bgInput: "#1e2227",
      border: "rgba(24, 26, 31, 0.8)",
      textMain: "#abb2bf",
      textMuted: "#5c6370",
      comment: "#5c6370",
      string: "#98c379",
      escapes: "#56b6c2",
      variable: "#e06c75",
      optional_prefix: "#c678dd",
      command: "#61afef",
      builtins: "#56b6c2",
      locator_prefix: "#e5c07b",
      locator_modifiers: "#d19a66",
      operators: "#56b6c2",
      numbers_durations: "#d19a66"
    }
  },
  {
    id: "antigravity-dark",
    name: "Antigravity Dark",
    isDark: true,
    colors: {
      bgApp: "#060814",
      bgCard: "rgba(13, 17, 39, 0.75)",
      bgInput: "#0a0c20",
      border: "rgba(99, 102, 241, 0.35)",
      textMain: "#f8fafc",
      textMuted: "#64748b",
      comment: "#475569",
      string: "#10b981",
      escapes: "#f43f5e",
      variable: "#f43f5e",
      optional_prefix: "#a855f7",
      command: "#6366f1",
      builtins: "#0ea5e9",
      locator_prefix: "#fbbf24",
      locator_modifiers: "#a855f7",
      operators: "#f1f5f9",
      numbers_durations: "#ec4899"
    }
  },
  {
    id: "antigravity-light",
    name: "Antigravity Light",
    isDark: false,
    colors: {
      bgApp: "#f8fafc",
      bgCard: "rgba(255, 255, 255, 0.85)",
      bgInput: "#ffffff",
      border: "rgba(99, 102, 241, 0.18)",
      textMain: "#0f172a",
      textMuted: "#64748b",
      comment: "#94a3b8",
      string: "#059669",
      escapes: "#e11d48",
      variable: "#e11d48",
      optional_prefix: "#7c3aed",
      command: "#4f46e5",
      builtins: "#0284c7",
      locator_prefix: "#d97706",
      locator_modifiers: "#7c3aed",
      operators: "#334155",
      numbers_durations: "#db2777"
    }
  }
];

// DSL 示例演示文本
const SAMPLE_DSL = `# ==========================================
# 完整的 ResumeWright DSL 关键字与语法展示脚本
# ==========================================

# 1. 导航与基础动作 (Navigation & Core Actions)
open "/home"
goto "/dashboard"
? back
tap "role:button[进入设置]"
hover "label:账号管理"
check "css:input[type=checkbox]"
scroll_to "xpath://footer"
inspect "testid:debug-element"

# 2. 表单输入与按键 (Form Inputs & Keyboard)
input "测试管理员" to "label:姓名"
keyboard "Enter"
input "upload_file.pdf" to "role:file"
upload "./fixtures/invoice_001.pdf"

# 3. 异步接口等待与截图 (Async API Waiting & Screenshots)
wait_api "*/api/users/*/orders" 10s 200ms
screenshot
? wait 500ms

# 4. 前端脚本执行与参数解构 (Script Execution)
execute_script "console.log(title)" title="着色测试"

# 5. 变量声明、宏调用及内置时间变量 (Variables & Macros)
$my_var = "测试发票_1"
$math_var = 1 + 2 - 3 * 4
$date_today = $today
$date_offset = $date+3d
$date_now = $now
$param_macro = $1
macro my_custom_macro $my_var "参数二"

# 6. 定位修饰符与特殊修饰词 (Locator Modifiers & Directions)
tap "role:button[提交]" near "附件上传"
tap "label:删除" left "role:cell"
tap "label:编辑" right "testid:item-row"
hover "css:.tooltip" top "role:button"
tap "xpath://div" bottom "role:header"
tap "role:link" nth=first
tap "role:link" nth=last
tap "role:link" nth=3

# 7. 全套断言指令 (All Assertion Directives)
assert_exists "已提交审核" 5s
assert_not_exists "css:.error-msg" 3s
assert_text_equal "pending_review" "pending_review"
assert_title_exists "发票审核详情页"
assert_url "http://127.0.0.1:61775/invoice/list"

# 8. HTTP 网络请求方法与内置函数 (HTTP API & Builtins)
$res_get = do_get "http://127.0.0.1/api/data"
$res_post = do_post "http://127.0.0.1/api/submit"
$res_put = do_put "http://127.0.0.1/api/update"
$res_delete = do_delete "http://127.0.0.1/api/remove"

$url_val = CURRENT_URL
$match_val = URL_MATCH "/invoice/:id"
$param_val = URL_PARAM "status"

# 9. 不同类型的字符串表示 (String Literal Formats)
$str_single = '单引号字符串'
$str_double = "双引号中的 \${$my_var} 变量和 \\n 转义符"
$str_triple = """
  多行三引号字符串
  支持包含各种引号 " '
  以及嵌入变量：\${$my_var}
"""
`;

// App 状态管理
let categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
let currentPresetId = "antigravity-dark";

// DOM 元素引用
const presetsContainer = document.getElementById("presets-container");
const categoriesContainer = document.getElementById("categories-container");
const dslInput = document.getElementById("dsl-input");
const dslPreviewCode = document.getElementById("dsl-preview-code");
const lineNumbersPre = document.getElementById("line-numbers-pre");
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const btnAddCategory = document.getElementById("btn-add-category");
const btnResetPreview = document.getElementById("btn-reset-preview");

// 弹窗元素
const addCategoryModal = document.getElementById("add-category-modal");
const modalBtnClose = document.getElementById("modal-btn-close");
const modalBtnCancel = document.getElementById("modal-btn-cancel");
const modalBtnSave = document.getElementById("modal-btn-save");

// 导出框
const cssExportOutput = document.getElementById("css-export-output");
const vscodeExportOutput = document.getElementById("vscode-export-output");

// 初始化页面
function init() {
  // 1. 设置示例代码
  dslInput.value = SAMPLE_DSL;

  // 2. 渲染主题预设按钮
  renderPresets();

  // 3. 应用 GitHub Dark 预设作为默认
  applyPreset("github-dark");

  // 4. 绑定基础事件监听
  setupEventListeners();

  // 5. 首次渲染
  renderCategories();
  updateHighlighting();
  updateExports();
}

// 渲染主题预设按钮
function renderPresets() {
  presetsContainer.innerHTML = PRESETS.map(preset => `
    <button class="preset-btn ${preset.id === currentPresetId ? 'active' : ''}" data-id="${preset.id}">
      <span>${preset.name}</span>
      <div class="preset-colors">
        <span style="background-color: ${preset.colors.bgApp}"></span>
        <span style="background-color: ${preset.colors.command}"></span>
        <span style="background-color: ${preset.colors.string}"></span>
      </div>
    </button>
  `).join('');

  // 绑定预设点击事件
  presetsContainer.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      applyPreset(id);
    });
  });
}

// 应用主题预设
function applyPreset(presetId) {
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset) return;

  currentPresetId = presetId;
  
  // 切换深浅色主题 CSS 类
  if (preset.isDark) {
    document.body.classList.remove("light-theme");
  } else {
    document.body.classList.add("light-theme");
  }

  // 改变全局 App 主题 CSS 变量
  const root = document.documentElement;
  root.style.setProperty('--bg-app', preset.colors.bgApp);
  root.style.setProperty('--bg-card', preset.colors.bgCard);
  root.style.setProperty('--bg-input', preset.colors.bgInput);
  root.style.setProperty('--border-color', preset.colors.border);
  root.style.setProperty('--text-main', preset.colors.textMain);
  root.style.setProperty('--text-muted', preset.colors.textMuted);

  // 更新所有匹配到的 categories 颜色
  categories.forEach(cat => {
    if (preset.colors[cat.id]) {
      cat.color = preset.colors[cat.id];
    }
  });

  // 更新 UI 按钮激活状态
  presetsContainer.querySelectorAll(".preset-btn").forEach(btn => {
    if (btn.getAttribute("data-id") === presetId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  renderCategories();
  updateHighlighting();
  updateExports();
}

// 动态创建并插入 CSS 着色类
function injectDynamicCSSStyles() {
  let styleTag = document.getElementById("dynamic-highlight-styles");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "dynamic-highlight-styles";
    document.head.appendChild(styleTag);
  }

  const cssRules = categories.map(cat => `
    .token-${cat.id} {
      color: ${cat.color} !important;
      ${cat.bgEnable ? `background-color: ${cat.bg} !important; border-radius: 3px; padding: 0 2px;` : ''}
      font-weight: ${cat.bold ? 'bold' : 'normal'} !important;
      font-style: ${cat.italic ? 'italic' : 'normal'} !important;
      text-decoration: ${cat.underline ? 'underline' : 'none'} !important;
    }
  `).join('\n');

  styleTag.textContent = cssRules;
}

// 渲染词法分类配置面板
function renderCategories() {
  categoriesContainer.innerHTML = categories.map(cat => {
    // 判断是否为自定义类别（系统内置类别不支持删除）
    const isCustom = !DEFAULT_CATEGORIES.some(d => d.id === cat.id);
    const deleteButton = isCustom 
      ? `<button class="btn-danger-link btn-delete-cat" data-id="${cat.id}">删除分类</button>` 
      : '';

    return `
      <div class="category-item" id="cat-card-${cat.id}">
        <div class="cat-header">
          <div class="cat-title-wrap">
            <span class="cat-name">${cat.name}</span>
            <span class="cat-id">id: ${cat.id}</span>
          </div>
          ${deleteButton}
        </div>

        <div class="cat-controls">
          <!-- 前景色 -->
          <div class="color-picker-wrapper">
            <span>前景色:</span>
            <input type="color" class="color-input-styled cat-color-picker" data-id="${cat.id}" data-type="color" value="${cat.color}">
          </div>

          <!-- 背景色 -->
          <div class="bg-picker-row">
            <div class="color-picker-wrapper">
              <span>背景色:</span>
              <input type="color" class="color-input-styled cat-color-picker" data-id="${cat.id}" data-type="bg" value="${cat.bg}" ${!cat.bgEnable ? 'disabled' : ''}>
            </div>
            <label class="bg-check-label">
              <input type="checkbox" class="cat-bg-enable" data-id="${cat.id}" ${cat.bgEnable ? 'checked' : ''}> 启用
            </label>
          </div>

          <!-- 文字样式切换 -->
          <div class="style-toggles">
            <button class="style-toggle-btn cat-style-toggle ${cat.bold ? 'active' : ''}" data-id="${cat.id}" data-style="bold" title="加粗">B</button>
            <button class="style-toggle-btn cat-style-toggle ${cat.italic ? 'active' : ''}" data-id="${cat.id}" data-style="italic" title="斜体">I</button>
            <button class="style-toggle-btn cat-style-toggle ${cat.underline ? 'active' : ''}" data-id="${cat.id}" data-style="underline" title="下划线">U</button>
          </div>
        </div>

        <!-- 匹配规则展示和修改 -->
        <div class="cat-rule-summary">
          <div class="rule-type-label">
            匹配类型: <span>${cat.ruleType === 'regex' ? '正则表达式' : '关键字列表'}</span>
          </div>
          <textarea class="rule-values-textarea cat-rule-input" data-id="${cat.id}" placeholder="输入匹配规则...">${cat.ruleValue}</textarea>
        </div>
      </div>
    `;
  }).join('');

  // 绑定颜色及样式编辑事件
  categoriesContainer.querySelectorAll(".cat-color-picker").forEach(picker => {
    picker.addEventListener("input", (e) => {
      const id = picker.getAttribute("data-id");
      const type = picker.getAttribute("data-type");
      const value = e.target.value;
      const cat = categories.find(c => c.id === id);
      if (cat) {
        if (type === 'color') cat.color = value;
        if (type === 'bg') cat.bg = value;
        updateHighlighting();
        updateExports();
      }
    });
  });

  categoriesContainer.querySelectorAll(".cat-bg-enable").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const id = cb.getAttribute("data-id");
      const checked = e.target.checked;
      const cat = categories.find(c => c.id === id);
      if (cat) {
        cat.bgEnable = checked;
        // 联动颜色选择器禁用状态
        const bgPicker = categoriesContainer.querySelector(`.cat-color-picker[data-id="${id}"][data-type="bg"]`);
        if (bgPicker) bgPicker.disabled = !checked;
        updateHighlighting();
        updateExports();
      }
    });
  });

  categoriesContainer.querySelectorAll(".cat-style-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const styleType = btn.getAttribute("data-style");
      const cat = categories.find(c => c.id === id);
      if (cat) {
        cat[styleType] = !cat[styleType];
        btn.classList.toggle("active", cat[styleType]);
        updateHighlighting();
        updateExports();
      }
    });
  });

  categoriesContainer.querySelectorAll(".cat-rule-input").forEach(textarea => {
    textarea.addEventListener("input", (e) => {
      const id = textarea.getAttribute("data-id");
      const value = e.target.value;
      const cat = categories.find(c => c.id === id);
      if (cat) {
        cat.ruleValue = value;
        updateHighlighting();
        updateExports();
      }
    });
  });

  // 删除自定义分类按钮事件
  categoriesContainer.querySelectorAll(".btn-delete-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (confirm(`确定要删除分类 "${id}" 吗？这无法撤销。`)) {
        categories = categories.filter(c => c.id !== id);
        renderCategories();
        updateHighlighting();
        updateExports();
      }
    });
  });
}

// 核心词法解析高亮逻辑
function tokenizeLine(text, activeCategories) {
  let line = text;
  const tokens = [];

  while (line.length > 0) {
    let earliestMatch = null;
    let earliestIndex = Infinity;
    let matchLength = 0;
    let matchingCat = null;

    for (const cat of activeCategories) {
      let regex;
      if (cat.ruleType === 'keywords') {
        // 将关键字组装为正则 word 匹配，对特殊字符进行转义
        const escapedWords = cat.ruleValue
          .split(',')
          .map(w => w.trim())
          .filter(w => w.length > 0)
          .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        
        if (escapedWords.length === 0) continue;
        regex = new RegExp('\\b(' + escapedWords.join('|') + ')\\b');
      } else {
        try {
          regex = new RegExp(cat.ruleValue);
        } catch (e) {
          continue; // 跳过编写错误的正则表达式
        }
      }

      const match = line.match(regex);
      if (match && match.index !== undefined) {
        if (match.index < earliestIndex) {
          earliestIndex = match.index;
          matchLength = match[0].length;
          earliestMatch = match[0];
          matchingCat = cat;
        } else if (match.index === earliestIndex && match[0].length > matchLength) {
          // 如果在相同位置匹配，选择匹配长度最长的一个（贪婪匹配）
          matchLength = match[0].length;
          earliestMatch = match[0];
          matchingCat = cat;
        }
      }
    }

    // 将最早匹配出来的词素切割为 token，前面未匹配的部分作为 default 渲染
    if (earliestMatch !== null) {
      if (earliestIndex > 0) {
        tokens.push({
          text: line.slice(0, earliestIndex),
          catId: 'default'
        });
      }
      tokens.push({
        text: earliestMatch,
        catId: matchingCat.id
      });
      line = line.slice(earliestIndex + matchLength);
    } else {
      tokens.push({
        text: line,
        catId: 'default'
      });
      break;
    }
  }

  return tokens;
}

// 安全转义 HTML 标记，防止注入和渲染错误
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 针对字符串进行子 Token 解析，用于支持双/三引号中变量 ${$var} 以及转义符的嵌套着色
function highlightStringInner(text, categoriesMap) {
  let startQuote = '';
  let endQuote = '';
  let inner = '';
  
  if (text.startsWith('"""') && text.endsWith('"""') && text.length >= 6) {
    startQuote = '"""';
    endQuote = '"""';
    inner = text.slice(3, -3);
  } else if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    startQuote = text[0];
    endQuote = text[text.length - 1];
    inner = text.slice(1, -1);
  } else {
    return escapeHtml(text);
  }

  const highlightVars = (startQuote === '"' || startQuote === '"""');
  const highlightEscapes = (startQuote === '"' || startQuote === "'");

  let line = inner;
  let resultHtml = "";

  const varCat = categoriesMap['variable'];
  const escCat = categoriesMap['escapes'];

  const varStyleClass = varCat ? `token-${varCat.id}` : '';
  const escStyleClass = escCat ? `token-${escCat.id}` : '';

  while (line.length > 0) {
    const escRegex = /\\./;
    const varRegex = /\\\$?\{\$[a-zA-Z_]\w*(?:\.\w*)*\}|\$\{\$[a-zA-Z_]\w*(?:\.\w*)*\}|\$[a-zA-Z_]\w*(?:\.\w*)*|\\\$?\{\w+\}/;

    const escMatch = line.match(escRegex);
    const varMatch = line.match(varRegex);

    let earliestMatch = null;
    let earliestIndex = Infinity;
    let matchType = '';

    if (highlightEscapes && escMatch && escMatch.index !== undefined && escMatch.index < earliestIndex) {
      earliestIndex = escMatch.index;
      earliestMatch = escMatch[0];
      matchType = 'esc';
    }
    if (highlightVars && varMatch && varMatch.index !== undefined && varMatch.index < earliestIndex) {
      earliestIndex = varMatch.index;
      earliestMatch = varMatch[0];
      matchType = 'var';
    }

    if (earliestMatch !== null) {
      if (earliestIndex > 0) {
        resultHtml += escapeHtml(line.slice(0, earliestIndex));
      }
      if (matchType === 'var') {
        resultHtml += `<span class="${varStyleClass}">${escapeHtml(earliestMatch)}</span>`;
      } else {
        resultHtml += `<span class="${escStyleClass}">${escapeHtml(earliestMatch)}</span>`;
      }
      line = line.slice(earliestIndex + earliestMatch.length);
    } else {
      resultHtml += escapeHtml(line);
      break;
    }
  }

  const strCat = categoriesMap['string'];
  const strStyleClass = strCat ? `token-${strCat.id}` : 'token-string';

  return `<span class="${strStyleClass}">${escapeHtml(startQuote)}${resultHtml}${escapeHtml(endQuote)}</span>`;
}

// 刷新右侧高亮渲染预览
function updateHighlighting() {
  // 注入最新样式
  injectDynamicCSSStyles();

  const source = dslInput.value;
  const lines = source.split('\n');
  
  // 1. 同步渲染行号
  const lineCount = lines.length || 1;
  let numbersHtml = "";
  for (let i = 1; i <= lineCount; i++) {
    numbersHtml += `<div>${i}</div>`;
  }
  lineNumbersPre.innerHTML = numbersHtml;

  // 2. 将 categories 列表映射为键值对 Map，方便在 highlightStringInner 中检索样式
  const categoriesMap = Object.fromEntries(categories.map(c => [c.id, c]));

  // 3. 解析并渲染高亮
  let previewHtml = "";
  lines.forEach(lineText => {
    if (lineText.trim() === "") {
      previewHtml += "\n";
      return;
    }

    const tokens = tokenizeLine(lineText, categories);
    let lineHtml = "";
    tokens.forEach(t => {
      if (t.catId === 'string') {
        lineHtml += highlightStringInner(t.text, categoriesMap);
      } else if (t.catId === 'default') {
        lineHtml += escapeHtml(t.text);
      } else {
        const escaped = escapeHtml(t.text);
        lineHtml += `<span class="token-${t.catId}">${escaped}</span>`;
      }
    });
    previewHtml += lineHtml + "\n";
  });

  // 去除最后一个冗余的换行
  if (previewHtml.endsWith('\n')) {
    previewHtml = previewHtml.slice(0, -1);
  }
  dslPreviewCode.innerHTML = previewHtml;
}

// 更新并生成导出文本（CSS 变量、VSCode json）
function updateExports() {
  // 1. 生成 CSS 变量
  let cssText = `/* ResumeWright DSL Color Theme CSS Variables */\n:root {\n`;
  categories.forEach(cat => {
    cssText += `  --rw-color-${cat.id}: ${cat.color};\n`;
    if (cat.bgEnable) {
      cssText += `  --rw-bg-${cat.id}: ${cat.bg};\n`;
    }
  });
  cssText += `}\n\n/* Theme classes */\n`;
  categories.forEach(cat => {
    cssText += `.token-${cat.id} {\n  color: var(--rw-color-${cat.id});\n`;
    if (cat.bgEnable) {
      cssText += `  background-color: var(--rw-bg-${cat.id});\n`;
    }
    if (cat.bold) cssText += `  font-weight: bold;\n`;
    if (cat.italic) cssText += `  font-style: italic;\n`;
    if (cat.underline) cssText += `  text-decoration: underline;\n`;
    cssText += `}\n`;
  });
  cssExportOutput.value = cssText;

  // 2. 生成 VS Code 定制 Token Snippet
  const vsCodeRules = [];
  categories.forEach(cat => {
    if (cat.scope) {
      const settings = {
        foreground: cat.color
      };
      
      const styles = [];
      if (cat.bold) styles.push("bold");
      if (cat.italic) styles.push("italic");
      if (cat.underline) styles.push("underline");
      
      if (styles.length > 0) {
        settings.fontStyle = styles.join(" ");
      }

      vsCodeRules.push({
        scope: cat.scope,
        settings: settings
      });
    }
  });

  const vsCodeJson = {
    "editor.tokenColorCustomizations": {
      "textMateRules": vsCodeRules
    }
  };
  vscodeExportOutput.value = JSON.stringify(vsCodeJson, null, 2);
}

// 弹出提示框信息
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast-msg";
  toast.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>
    ${message}
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "fade-out-toast 0.3s ease-in forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

// 绑定所有的 DOM 交互事件
function setupEventListeners() {
  // DSL 输入实时监听
  dslInput.addEventListener("input", updateHighlighting);
  // 同步滚动条
  dslInput.addEventListener("scroll", () => {
    lineNumbersPre.scrollTop = dslInput.scrollTop;
  });

  // 恢复样本代码
  btnResetPreview.addEventListener("click", () => {
    dslInput.value = SAMPLE_DSL;
    updateHighlighting();
    showToast("已重置为系统默认 DSL 演示源码");
  });

  // 深色/浅色全局一键切换按钮（简易切换）
  btnThemeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-theme");
    const root = document.documentElement;
    if (isLight) {
      root.style.setProperty('--bg-app', '#f4f6f9');
      root.style.setProperty('--bg-card', 'rgba(255, 255, 255, 0.85)');
      root.style.setProperty('--bg-input', '#ffffff');
      root.style.setProperty('--border-color', 'rgba(209, 213, 219, 0.8)');
      root.style.setProperty('--text-main', '#1f2937');
      root.style.setProperty('--text-muted', '#6b7280');
    } else {
      root.style.setProperty('--bg-app', '#0d1117');
      root.style.setProperty('--bg-card', 'rgba(22, 27, 34, 0.75)');
      root.style.setProperty('--bg-input', '#090d13');
      root.style.setProperty('--border-color', 'rgba(48, 54, 61, 0.8)');
      root.style.setProperty('--text-main', '#e6edf3');
      root.style.setProperty('--text-muted', '#8b949e');
    }
    showToast(`全局 UI 风格已切换`);
  });

  // 选项卡 (Tabs) 切换控制
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // 激活 Tab 按钮样式
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // 激活 Tab Panel 展示
      const tabId = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");
    });
  });

  // 复制代码按钮
  document.querySelectorAll(".btn-copy").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const textarea = document.getElementById(targetId);
      textarea.select();
      document.execCommand("copy");
      showToast("代码已成功复制到剪贴板！");
    });
  });

  // 新建分类模态窗逻辑
  btnAddCategory.addEventListener("click", () => {
    addCategoryModal.classList.add("active");
  });

  const closeModal = () => {
    addCategoryModal.classList.remove("active");
    // 清空模态窗输入
    document.getElementById("new-cat-id").value = "";
    document.getElementById("new-cat-name").value = "";
    document.getElementById("new-cat-scope").value = "";
    document.getElementById("new-cat-rule-val").value = "";
    document.getElementById("new-cat-bg-enable").checked = false;
  };

  modalBtnClose.addEventListener("click", closeModal);
  modalBtnCancel.addEventListener("click", closeModal);

  modalBtnSave.addEventListener("click", () => {
    const id = document.getElementById("new-cat-id").value.trim();
    const name = document.getElementById("new-cat-name").value.trim();
    const scope = document.getElementById("new-cat-scope").value.trim();
    const ruleType = document.querySelector("input[name='new-cat-rule-type']:checked").value;
    const ruleValue = document.getElementById("new-cat-rule-val").value.trim();
    const color = document.getElementById("new-cat-color").value;
    const bg = document.getElementById("new-cat-bg").value;
    const bgEnable = document.getElementById("new-cat-bg-enable").checked;

    if (!id || !name || !ruleValue) {
      alert("请填写标识符、显示名称和匹配规则！");
      return;
    }

    if (!/^[a-zA-Z_]\w*$/.test(id)) {
      alert("分类标识符必须为英文字母或下划线组成的合法变量名！");
      return;
    }

    if (categories.some(cat => cat.id === id)) {
      alert("该标识符分类已存在，请输入唯一的 ID！");
      return;
    }

    // 插入到首部，提高优先级以保证优先匹配
    categories.unshift({
      id,
      name,
      color,
      bg,
      bgEnable,
      bold: false,
      italic: false,
      underline: false,
      scope: scope || `source.resumewright.${id}`,
      ruleType,
      ruleValue
    });

    closeModal();
    renderCategories();
    updateHighlighting();
    updateExports();
    showToast(`新语法分类 "${name}" 创建并匹配成功`);
  });

  // JSON 配置导出
  document.getElementById("btn-export-json").addEventListener("click", () => {
    const exportData = {
      presetId: currentPresetId,
      categories: categories
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `resumewright-theme-${currentPresetId || 'custom'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("JSON 方案下载已启动");
  });

  // JSON 配置导入
  const triggerImport = document.getElementById("btn-trigger-import");
  const fileImportJson = document.getElementById("file-import-json");

  triggerImport.addEventListener("click", () => {
    fileImportJson.click();
  });

  fileImportJson.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.categories || !Array.isArray(imported.categories)) {
          throw new Error("不是合法的 ResumeWright 主题配置文件（缺少 categories 节点）");
        }
        
        categories = imported.categories;
        renderCategories();
        
        if (imported.presetId) {
          // 如果包含 Preset 信息则重新应用 Preset 样式
          currentPresetId = imported.presetId;
          const matchedPreset = PRESETS.find(p => p.id === currentPresetId);
          if (matchedPreset) {
            applyPreset(currentPresetId);
          } else {
            updateHighlighting();
            updateExports();
          }
        } else {
          updateHighlighting();
          updateExports();
        }
        
        showToast("已成功导入外部主题方案！");
      } catch (err) {
        alert("导入失败: " + err.message);
      }
    };
    reader.readAsText(file);
    // 重置 input 以允许重复上传同名文件
    fileImportJson.value = "";
  });
}

// 页面加载完成后启动
window.addEventListener("DOMContentLoaded", init);
