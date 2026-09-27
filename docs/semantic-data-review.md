# 语义数据审核文档

M0 交付的两份语义数据文件，供人工审核。**红线：运行时 LLM 只在既有条目上做映射、判题、按级生成，不发明知识点、不自行定级。**

## 一、`packages/core/src/data/vocab.json`（5027 词）

字段：`word`（小写词元）/ `cefr`（A1-C2）/ `band`（1-5 频段）/ `source`（出处）。

### 来源与合并方法

| 来源 | 角色 | 授权 |
|---|---|---|
| NGSL 1.2（New General Service List，Browne/Culligan/Phillips） | 主干词元（约 2860 词元），band 由 SFI 频段折算（1-500→1，501-1000→2，1001-1500→3，1501-2000→4，>2000→5；补充词（星期/月份/数词，rank 0）→1） | CC BY-SA 4.0（经 InternetEnzyme/textmeter-ngsl 转载整理版，原文 newgeneralservicelist.com） |
| Oxford 5000（OALD 词表抓取版，tyypgzl/Oxford-5000-words） | 交叉核对 CEFR 等级；Oxford-only 词补收 | 词条级事实（词+等级）；OUP 版权，**商用分发前需核对授权** |
| NGSL-only 词（73 个） | cefr 由 band 推断（band1→A1 … band5→C1），source 为 `ngsl-1.2` | 同上 |

source 取值：
- `ngsl-1.2+oxford-5000`（2786）：双源交叉，cefr 以 Oxford 标注为准，band 取 NGSL 频段与 Oxford 等级较早档
- `oxford-5000`（2168）：仅 Oxford，band 由 cefr 折算
- `ngsl-1.2`（73）：仅 NGSL，cefr 由频段推断（审核重点，量小）

### 已知口径与缺口

1. 词元化：NGSL 提供 form→headword 映射，已归并到词元（如 web site/web sites → website），**变体形式不在表内**；M1 做 learned_set 匹配时需先做 lemmatize（查表时将目标词还原词元再匹配）。
2. Oxford 抓取版缺个别词（如 kindergarten），属源数据缺口，不是合并遗漏。
3. band 语义：1≈A1 档 … 5≈C1 档，用于"文章词汇 ∩ 等级±1 频段 − learned_set"的新词筛选。
4. 抽查建议：`the`（A1/band1）、`abandon`（B2/band4）、`website`（band5）、`coffee`（A1）；再随机抽 20 词对 OALD 页面核对等级。

## 二、`packages/core/src/data/grammar.json`（102 条）

字段：`id`（g001-g102）/ `name` / `zh` / `cefr`（A1×28，A2×28，B1×24，B2×22）/ `formula`（结构公式）/ `examples`（2 句）/ `source`。

### 出处口径

source 统一为 `cefr-consensus`，含义：**分级归属取以下公开教学大纲的共识，未打包任何版权原文**——

- Cambridge English Grammar Profile（在线检索，仅参考分级归属）
- British Council LearnEnglish 语法分级目录
- Murphy《English Grammar in Use》单元体系（仅参考目录结构）
- GSE（Global Scale of English）语法分级表

`formula` 为结构公式改写，`examples` 全部为原创例句。

### 审核建议

1. 每级抽 5 条对照 Cambridge EGP 在线检索核对分级是否一致。
2. 重点核对争议归属：`question tags`（A2）、`should have + V3`（B1）、`cleft sentences`（B2）、`hedging`（B2）——不同大纲有 ±1 级差异。
3. 缺口：B2 以上（C1：inversion、subjunctive 等）未收录，属规划内（先 A1-B2，C1 清单 M5+）。

## 三、维护规则

1. 两份文件任何改动必须走审核 + 重跑 `pnpm test`（data.test.ts 有规模/去重/结构断言）。
2. 新增条目必须带 source；禁止让 LLM 批量生成等级标注后直接入库。
3. 版权红线：剑桥 EGP 原文描述、Oxford 词典释义一律不入库。
