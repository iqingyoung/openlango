/**
 * Guard 规则层（确定性代码，LLM 只是能力不是策略执行者）。
 * 分层：词法模式 → classify() 只分类 → decideGuardAction() 只定策略（未来换分类器不碰策略）。
 * 分流原则：
 *  - 指令覆盖/提示词探测/解除约束 → block（coach）/ flag（article/basic，内容仍进 XML 隔离区）
 *  - 场景角色扮演请求（"请扮演面试官"/"我想练值机"）→ allow，属 Coach 核心功能
 *  - 敏感人设词（黑客/坏人…）：identity integrity ≠ content safety —— 扮演请求不因人设词升级为
 *    劫持（练 "hacker" 对话是正当学习），有害内容由核心策略第 5 条与下游模型红线兜底
 *  - 教学引用（"「你是一个老师」用英语怎么说"）→ allow，零误伤红线
 *  - 外部内容（新闻正文）→ scanExternalContent，命中即 flag（间接注入）
 */

export type GuardMode = 'coach' | 'article' | 'basic';

export type GuardCategory =
  | 'identity_hijack'
  | 'scenario_roleplay'
  | 'instruction_override'
  | 'prompt_probe'
  | 'jailbreak'
  | 'teaching_reference'
  | 'benign';

export type GuardAction = 'allow' | 'block' | 'flag';

export interface GuardVerdict {
  action: GuardAction;
  category: GuardCategory;
  matched: string[];
}

/** 指令覆盖/提示词探测/越狱：无条件进入拦截集合 */
const OVERRIDE_PATTERNS: RegExp[] = [
  /忽略[^。]{0,8}(指令|设定|设置|规则|提示|约束)/,
  /无视[^。]{0,8}(指令|规则|约束|设定)/,
  /不要遵守|别遵守|不听(你的)?(指令|规则)/,
  /忘(记|掉)(你的|之前的|上面|以前的?|所有|全部)?的?(设定|角色|指令|规则|人设)/,
  /重置(你的)?(身份|角色|人设)|更换角色|替换角色/,
  /越狱|破解(你的)?(限制|规则|约束)/,
  /把你的?(系统提示词|系统指令|初始指令|提示词)/,
  /你的(系统提示词|系统指令|初始设定)(是什么|给我|发我|输出|打印)/,
  /\bignore (all |any |the )?(previous|prior|above|earlier|all) ?(previous |prior |above |earlier )?(instructions?|prompts?|rules?)/i,
  /\bdisregard (all |any |the )?(previous|prior|above|earlier) (instructions?|prompts?|rules?)/i,
  /\bforget (all |your |everything about your )?(instructions?|rules?|training|prompt)/i,
  /\b(reveal|repeat|print|show|output) (your |the )?(system prompt|instructions?)\b/i,
  /\bsystem prompt\b/i,
  /\bdeveloper (message|mode)\b/i,
  /\bjailbreak\b/i,
];

/** 角色指派：第二人称改派或 impersonal 场景请求 */
const ROLE_ASSIGN_PATTERNS: RegExp[] = [
  /你(给我)?(来)?(扮演|假装|充当|变成|化身|改为|换成)/,
  /假装(你是|成|自己是?)/,
  /(请|帮我|给我)(你)?(扮演|假装|充当|模拟)/,
  /(扮演|充当)(一个|一位|个|一位作为)/,
  /你不再(是|当|做)|你不再是我的|不要再(当|做|扮演)/,
  /(从现在开始|现在开始|从此|接下来|以后|after this)[^。!?.]{0,8}你是/,
  /你(不是|别是)(我的)?(英语)?(教练|老师|助手|assistant)/,
  /\bpretend (to be|you are|that you are|you're)\b/i,
  /^\s*act as\b/i,
  /\byou (are|'re) now\b/i,
  /\bfrom now on,? (you|you're|your)\b/i,
  /我想(练|练习|玩|模拟)|想练一下|帮我练|let'?s (practice|roleplay)|i want to practice/i,
];

/** 否定/脱离标记：角色指派句内出现 → 系统身份劫持而非场景扮演 */
const NEGATION_MARKERS: RegExp[] = [
  /不再|别再|不再是|不要当|不当(教练|老师)|忘掉你的|抛弃你的/,
  /\bno longer\b/i,
  /\bnot an? (ai|assistant|coach|teacher|bot)\b/i,
  /\bforget (you are|yourself|being)\b/i,
  /\binstead of (being|being an?)\b/i,
];

/** 解除约束标记：角色指派句内出现 → 真劫持（要的不是扮演，是脱缰） */
const CONSTRAINT_REMOVAL_PATTERNS: RegExp[] = [
  /没有(任何)?(限制|规则|约束)|不受(任何)?(限制|约束)|无视一切规则/,
  /\b(no|without) (rules|restrictions|limits|filters?)\b/i,
];

/** 敏感人设词（content safety 维度）：记录进 matched 供策略/可观测使用，不改变分类 */
const HARMFUL_PERSONA_PATTERNS: RegExp[] = [
  /坏人|杀手|恐怖|犯罪|诈骗|色情/,
  /\bevil|criminal|villain|hacker|terrorist\b/i,
];

/** 引用语法：仅证明"有引用"，单独出现不构成教学豁免（防引号包越狱指令绕过） */
const QUOTE_PATTERNS: RegExp[] = [
  /「[^」]{1,60}」|『[^』]{1,60}』|“[^”]{1,60}”/,
  /"([^"\\]{1,80})"/,
  /(')([^'\\]{1,80})\1/,
];

/** 教学意图：求翻译/求说法/求释义（中英文） */
const QUERY_INTENT_PATTERNS: RegExp[] = [
  /(怎么|如何)(说|讲|拼|读|翻译|表达)|翻译成英语|英语(怎么|如何)说|用英语(怎么|如何)/,
  /是什么意思|什么意思|什么含义|怎么用|举个例子/,
  /\bhow (do|would|can) (you|I|we|one) say\b/i,
  /\bhow (do|to|would) (you )?(say|spell|pronounce|write)\b/i,
  /\bwhat does ["'「“]?[^"'」”]{1,60}["'」”]? ?mean\b/i,
  /\bwhat'?s (the )?(meaning of|english for)\b/i,
  /\btranslate (this |it |that )?(to|into) english\b/i,
];

/** 教学引用判定（零误伤红线）：必须有教学意图；意图+引用/短句才算。
 * 纯引号包住的越狱指令（无意图）不再被豁免 —— 修复引号无条件绕过漏洞。 */
function isTeachingReference(text: string): boolean {
  const hasIntent = matchAll(text, QUERY_INTENT_PATTERNS).length > 0;
  if (!hasIntent) return false;
  const hasQuote = matchAll(text, QUOTE_PATTERNS).length > 0;
  return hasQuote || text.length < 80;
}

function matchAll(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** 词法分类器：只回答"输入属于哪类"，不决定动作 */
function classify(text: string): GuardCategory {
  if (matchAll(text, OVERRIDE_PATTERNS).length > 0) {
    // 教学引用优先级最高：求翻译/求释义句里的攻击指令不算攻击；纯引号包裹不算豁免
    return isTeachingReference(text) ? 'teaching_reference' : 'instruction_override';
  }
  if (matchAll(text, ROLE_ASSIGN_PATTERNS).length > 0) {
    if (isTeachingReference(text)) return 'teaching_reference';
    if (matchAll(text, NEGATION_MARKERS).length > 0) return 'identity_hijack';
    if (matchAll(text, CONSTRAINT_REMOVAL_PATTERNS).length > 0) return 'identity_hijack';
    // 敏感人设词不升级为劫持：扮演≠脱缰，有害内容由核心策略兜底
    return 'scenario_roleplay';
  }
  if (isTeachingReference(text)) return 'teaching_reference';
  return 'benign';
}

/** 策略决策：分类 × 模式 → 动作（coach 硬拦，article/basic 降级 flag 隔离） */
export function decideGuardAction(category: GuardCategory, mode: GuardMode): GuardAction {
  switch (category) {
    case 'instruction_override':
    case 'identity_hijack':
      return mode === 'coach' ? 'block' : 'flag';
    case 'scenario_roleplay':
    case 'teaching_reference':
    case 'benign':
      return 'allow';
    default:
      return 'flag';
  }
}

/**
 * 用户输入分流。coach 模式下劫持/覆盖类返回 block（配合固定模板回应，不破坏人设）；
 * article/basic 模式返回 flag（内容仍会进 <user_content> 隔离区，策略层不执行它）。
 */
export function classifyInput(text: string, mode: GuardMode): GuardVerdict {
  const category = classify(text);
  const action = decideGuardAction(category, mode);
  const matched =
    category === 'benign'
      ? []
      : matchAll(text, [
          ...OVERRIDE_PATTERNS,
          ...ROLE_ASSIGN_PATTERNS,
          ...CONSTRAINT_REMOVAL_PATTERNS,
          ...QUERY_INTENT_PATTERNS,
          ...QUOTE_PATTERNS,
          ...HARMFUL_PERSONA_PATTERNS,
        ]);
  return { action, category, matched };
}

/** 外部内容（新闻正文等）间接注入扫描：命中即 flag，交由调用方决定呈现方式 */
export function scanExternalContent(text: string): GuardVerdict {
  const matched = matchAll(text, [...OVERRIDE_PATTERNS, ...ROLE_ASSIGN_PATTERNS]);
  if (matched.length > 0) {
    return { action: 'flag', category: 'instruction_override', matched };
  }
  return { action: 'allow', category: 'benign', matched: [] };
}
