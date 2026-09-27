/**
 * Guard 规则层（确定性代码，LLM 只是能力不是策略执行者）。
 * 分流原则（M0 规则版，后续可挂廉价分类器，接口不变）：
 *  - 系统身份劫持/指令覆盖/提示词探测/越狱 → block（coach）/ flag（article/basic，内容仍进 XML 隔离区）
 *  - 场景角色扮演请求（"请扮演面试官"/"我想练值机"）→ allow，属 Coach 核心功能，交给场景生成器
 *  - 教学引用（"「你是一个老师」用英语怎么说"）→ allow，零误伤红线
 *  - 恶意人设/解除约束标记（"扮演坏人/没有任何限制"）→ 劫持
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

/** 恶意人设/解除约束：场景扮演请求里的越界内容 → 劫持 */
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /坏人|杀手|黑客|恐怖|犯罪|诈骗|色情/,
  /\bevil|criminal|villain|hacker|terrorist|dan\b/i,
  /没有(任何)?(限制|规则|约束)|不受(任何)?(限制|约束)|无视一切规则/,
  /\b(no|without) (rules|restrictions|limits|filter)\b/i,
];

/** 教学引用：引号包裹 + 求翻译/求说法 → 零误伤放行 */
const TEACHING_REFERENCE_PATTERNS: RegExp[] = [
  /「[^」]{1,60}」|『[^』]{1,60}』|“[^”]{1,60}”/,
  /"([^"\\]{1,80})"/,
  /(')([^'\\]{1,80})\1/,
  /(怎么|如何)(说|讲|拼|读|翻译|表达)|翻译成英语|英语(怎么|如何)说|用英语(怎么|如何)/,
  /\bhow (do|would|can) (you|I|we|one) say\b/i,
  /\bhow (do|to|would) (you )?(say|spell|pronounce|write)\b/i,
  /\bwhat does ["'「“]?[^"'」”]{1,60}["'」”]? ?mean\b/i,
  /\btranslate (this |it |that )?(to|into) english\b/i,
];

function matchAll(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function classify(text: string): GuardCategory {
  const teaching = matchAll(text, TEACHING_REFERENCE_PATTERNS);
  if (matchAll(text, OVERRIDE_PATTERNS).length > 0) {
    // 教学引用优先级最高："ignore previous instructions" 出现在引号/求翻译句里不算攻击
    if (teaching.length > 0) return 'teaching_reference';
    return 'instruction_override';
  }
  const roleHits = matchAll(text, ROLE_ASSIGN_PATTERNS);
  if (roleHits.length > 0) {
    if (teaching.length > 0) return 'teaching_reference';
    if (matchAll(text, NEGATION_MARKERS).length > 0) return 'identity_hijack';
    if (matchAll(text, SUSPICIOUS_PATTERNS).length > 0) return 'identity_hijack';
    return 'scenario_roleplay';
  }
  if (teaching.length > 0) return 'teaching_reference';
  return 'benign';
}

/**
 * 用户输入分流。coach 模式下劫持/覆盖类返回 block（配合固定模板回应，不破坏人设）；
 * article/basic 模式返回 flag（内容仍会进 <user_content> 隔离区，策略层不执行它）。
 */
export function classifyInput(text: string, mode: GuardMode): GuardVerdict {
  const category = classify(text);
  const matched =
    category === 'benign'
      ? []
      : matchAll(text, [...OVERRIDE_PATTERNS, ...ROLE_ASSIGN_PATTERNS, ...SUSPICIOUS_PATTERNS]);
  switch (category) {
    case 'instruction_override':
    case 'identity_hijack':
      return { action: mode === 'coach' ? 'block' : 'flag', category, matched };
    case 'scenario_roleplay':
    case 'teaching_reference':
    case 'benign':
      return { action: 'allow', category, matched };
    default:
      return { action: 'flag', category, matched };
  }
}

/** 外部内容（新闻正文等）间接注入扫描：命中即 flag，交由调用方决定呈现方式 */
export function scanExternalContent(text: string): GuardVerdict {
  const matched = matchAll(text, [...OVERRIDE_PATTERNS, ...ROLE_ASSIGN_PATTERNS]);
  if (matched.length > 0) {
    return { action: 'flag', category: 'instruction_override', matched };
  }
  return { action: 'allow', category: 'benign', matched: [] };
}
