# OpenLango

开源模块化语言学习 harness —— **Models are replaceable. Learning state is persistent.**

不做"套壳聊天"：定级、防破甲、内容门控、学习状态全部在 harness 代码层，模型只是可插拔的能力位。

## 架构（四层）

```
┌──────────────────────────────────────────────┐
│ L3 Harness 管控层                             │
│  Instruction Boundary：结构化 system prompt    │
│  输入分类器（劫持拦截/场景扮演放行/间接注入扫描）│
│  system prompt 版本化管理                      │
├──────────────────────────────────────────────┤
│ L2 Learner State & Policy                     │
│  五维等级向量 θ{reading,listening,speaking,    │
│  vocab,grammar} + CEFR 映射 + 防抖升降级       │
│  定级由文字模块驱动，语音难度跟随               │
├──────────────────────────────────────────────┤
│ L1 功能层：Coach / Article / Basic            │
├──────────────────────────────────────────────┤
│ L0 Provider 抽象：llm/asr/tts/realtime/search/ │
│  evaluator 六接口，YAML 配置驱动               │
└──────────────────────────────────────────────┘
```

- **Coach**：按等级对话，场景自选；M1 文本，M2 接语音（cascade / realtime 双管线）
- **Article**：RSS 抓热点做 topic 信号 → 按等级生成英文文章（事实链与成文分离，附原文链接）
- **Basic**：固定语法清单（102 条 A1-B2）+ FSRS 词汇调度，弱项作死练-测

## 快速开始

```bash
pnpm install
cp .env.example .env         # 填一个 OpenAI 兼容 key（DeepSeek/Qwen/GLM/OpenAI 均可）
pnpm db:push                 # 建库 data/openlango.db
pnpm test
pnpm web:dev                 # http://localhost:3000
```

换模型只改 [config/openlango.config.yaml](config/openlango.config.yaml)，零代码改动。

### Docker 一键部署

```bash
cp .env.example .env   # 填好 key
docker compose up -d   # 端口 3000；data/config/.env 以卷挂载持久化
```

> Dockerfile 按标准 pnpm + Next standalone 模板编写；作者本机无 docker 未实机构建验证，问题欢迎 issue/PR。
> 容器内通过 `OPENLANGO_ROOT=/app` 定位配置与数据库。

### 配置示例（三套，`config/examples/`）

| 文件 | 组合 | 适用 |
| --- | --- | --- |
| `all-api.yaml` | 硅基流动 ASR（免费）+ 云 LLM + Edge TTS | 开箱最顺，几分钱/小时 |
| `all-local.yaml` | Ollama + 本地 whisper 服务 + Edge TTS | 零 API 费（TTS 需联网） |
| `mixed.yaml` | 云 LLM/TTS + 本地 whisper | 在意语音不出本机 |

用法：复制为 `config/openlango.config.yaml`，key 进 `.env`，重启生效。

### Anki 导出

设置页 → 「⬇ 下载 Anki 牌组 (.apkg)」：导出 `OpenLango::词汇`（FSRS 学习集内）与 `OpenLango::语法`（A1-B2 清单 + 原创例句）双牌组，现代 Anki 导入时自动升级 schema。

## 成本策略（丰俭由人）

| 路径      | 组合                                            | 约计      |
| ------- | --------------------------------------------- | ------- |
| API 便宜档 | Groq Whisper-turbo + deepseek-chat + edge-tts | 几分钱/小时  |
| 全本地档    | FunASR/SenseVoice + Ollama(qwen3) + CosyVoice | 零 API 费 |
| 高配档     | OpenAI Realtime STS                           | 按量      |

judge/纠错用最便宜档，对话用中档，文章生成可高档——能力位分开路由。

### ASR 单价参考（人民币/小时，2026-09 调研，以官方页为准）

均为 OpenAI `/audio/transcriptions` 兼容端点，改 config 即接入：

| 服务 | baseURL | model | 价格 |
| --- | --- | --- | --- |
| 硅基流动·电信星辰 | `https://api.siliconflow.cn/v1` | `TeleAI/SenseVoiceSmall` | **免费** |
| MiMo ASR | — | — | 0.5 |
| hy3asr（腾讯 MaaS 混元） | `https://tokenhub.tencentmaas.com/v1` | `hy-asr-3.0-preview`（需加 `path: wand/asrproxy/sync_transcribe`） | 0.45 |
| 智谱 GLM-ASR | `https://open.bigmodel.cn/api/paas/v4` | `glm-asr` | 0.72 |
| Qwen ASR 3（流式 1.18） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-asr-flash` | 0.79 |
| Groq Whisper-turbo | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` | 免费档（限速） |

TTS：Edge 免费音色（msedge 驱动，无需 key）；国内可换硅基流动 `/audio/speech`（CosyVoice 系，openai-speech 驱动）。

## 语义数据（待审核）

词汇/语法知识库不是 AI 现编：来源、合并方法、已知缺口、抽查指南见  
[docs/semantic-data-review.md](docs/semantic-data-review.md)。  
运行时 LLM 只做映射、判题、按级生成，禁止发明知识点或自行定级。

## 路线图

- **M0 骨架** ✅：六 Provider 接口冻结、guard 规则层、prompt 版本化、DB schema、语义数据（vocab 5027 词 / grammar 102 条，待审核见 docs/semantic-data-review.md）
- **M1 文字闭环** ✅：placement 五维定级（ELO 自适应）→ LevelManager（EWMA+滞回防抖）→ Article 管线（RSS 信号→按级生成→新词/语法提取→理解题）→ Basic（FSRS 词汇复习 + 弱项语法练测）→ 文本 Coach（场景生成/对话/纠错 judge）。验收：81/81 单测全绿（含 30 会话进步用户仿真、滞回防抖、间接注入过滤、劫持零 LLM 调用），离线闭环实测通过；填入 `.env` 后 Article/Coach 即可用真实模型
- **M2 语音** ✅（cascade）：VoiceEvent 统一事件抽象 + cascade 编排（ASR→guard→流式 LLM→**分句流式 TTS**→judge/metrics）+ Coach 语音模式（客户端 VAD 自动断句、播放队列、**说话即打断 barge-in**、每步耗时展示）。ASR = OpenAI transcriptions 兼容（Groq 免费档 / 本地 whisper）；TTS = msedge 免费音色（无需 key）或 openai-speech 兼容端点。**需在 .env 填 `OPENLANGO_ASR_API_KEY`（console.groq.com 免费领取）后体验语音**
- **M3 完善** ✅：输出层 **role-consistency judge**（漂移检测→下轮 system prompt 加固，异步审计不挡对话）+ **错误台账**（judge 纠错自动映射固定语法点→Basic 复习优先级提升、答对销账）+ 信号漂移触发**再校准标记**（dashboard 轻提示、placement 后清除，全程无评分打扰）
- **M4 发布** ✅：Docker Compose（standalone）+ Anki apkg 导出 + 三套示例配置 + GitHub 撞名检查（openlango 可用，0 冲突）；S2S 经论证移出（可观测性/成本，国内候选 GLM-Realtime-Flash 0.18 元/分钟，留 M5 决策）

License: [Apache-2.0](https://github.com/iqingyoung/openlango?tab=Apache-2.0-1-ov-file)

