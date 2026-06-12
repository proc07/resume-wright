// ============================================================
// dsl.types.ts — DSL 脚本解析结果类型定义
// ============================================================

/** 所有 DSL 支持的命令 */
export type DslCommandName =
  | 'open'
  | 'tap'
  | 'input'
  | 'keyboard'
  | 'hover'
  | 'scroll_to'
  | 'screenshot'
  | 'wait'
  | 'check'
  | 'upload'
  | 'execute_script'
  | 'assert_exists'
  | 'assert_not_exists'
  | 'assert_text_equal'
  | 'assert_title_exists'
  | 'assert_url'
  | 'do_get'
  | 'do_post'
  | 'do_put'
  | 'do_delete'
  | 'macro'
  | 'inspect';

/** 变量赋值来源 */
export type AssignSource =
  | 'current_url'
  | 'url_match'
  | 'url_param'
  | 'locator'         // $var = "selector" — 从元素文本提取
  | 'var_ref'         // $var = $other.field — 变量引用
  | 'http'            // $var = do_get/post/put/delete "url"
  | 'execute_script'  // $var = execute_script """..."""
  | 'literal';        // $var = "value" — 直接赋值字面量

/** 解析后的 DSL 语句 */
export interface DslInstruction {
  /** 是否非阻塞（? 前缀） */
  optional: boolean;

  /** 命令名称（null 表示这是变量赋值语句） */
  command: DslCommandName | null;

  /** 变量名（仅当 command === null 时有值） */
  assignTarget?: string;

  /** 赋值来源（仅当 command === null 时有值） */
  assignSource?: AssignSource;

  /** 命令参数列表 */
  args: string[];

  /** 多行块内容（execute_script / do_post body 等） */
  block?: string;

  /** 原始行（调试用） */
  raw: string;

  /** 在 script 中的行号（从 1 开始） */
  lineNumber?: number;
}

/** 解析后的完整 DSL 脚本 */
export type DslScript = DslInstruction[];

/** 元素定位修饰符 */
export interface LocatorModifier {
  /** 索引：0 / -1 / null */
  index?: number;
  /** 最后一个标志 */
  last?: boolean;
  /** DOM 标签过滤 */
  tag?: string;
}

/** 解析后的元素定位信息 */
export interface ParsedLocator {
  type:
    | 'text'           // 默认文字匹配（exact）
    | 'text_contains'  // *xxx* 包含匹配
    | 'text_or'        // A|B OR 匹配
    | 'label'          // label: 前缀
    | 'placeholder'    // placeholder: 前缀
    | 'role'           // role:button[xxx]
    | 'testid'         // testid: 前缀
    | 'title'          // title: 前缀
    | 'alt'            // alt: 前缀
    | 'xpath'          // // 开头
    | 'css'            // . 或 # 开头
    | 'alias';         // @ 开头（elements.csv 别名）

  value: string;       // 提取的核心值

  /** role 类型时的 name 参数 */
  roleName?: string;

  modifier?: LocatorModifier;

  /** 原始字符串（调试用） */
  raw: string;
}
