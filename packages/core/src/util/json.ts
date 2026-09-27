/**
 * 宽松 JSON 提取：容忍 ```json 围栏与前后杂文；
 * 输出被 max_tokens 截断时做渐进修复（收尾引号/括号 + 回退到上一个完整元素）。
 */

/** 补全未闭合的字符串与括号栈（string-aware） */
function closeOpen(text: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inString) out += '"';
  // 去掉悬空的逗号/冒号尾巴
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === '{' ? '}' : ']';
  }
  return out;
}

/** 截断 JSON 渐进修复：从尾部向前回退到上一个完整元素逐次尝试 */
function repairTruncated(t: string): unknown | undefined {
  let cur = t;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      return JSON.parse(closeOpen(cur));
    } catch {
      // 回退：砍掉最后一个元素（, 之前的一段）
      const lastComma = Math.max(cur.lastIndexOf(','), cur.lastIndexOf('{'), cur.lastIndexOf('['));
      if (lastComma <= 0) return undefined;
      cur = cur.slice(0, lastComma);
    }
  }
  return undefined;
}

export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1) throw new Error('no json object found');
  if (end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      // 落入截断修复
    }
  }
  const repaired = repairTruncated(t.slice(start));
  if (repaired !== undefined) return repaired;
  throw new Error('no json object found');
}
