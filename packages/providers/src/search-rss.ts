/**
 * 新闻搜索（免 key）。engine:
 *  - 'bing' | 'google'：关键词搜索 RSS（需对应站点可达）
 *  - 'hn'：Hacker News Algolia 全文搜索（关键词搜索，技术向）
 *  - 'npr'：NPR 最新要闻（非关键词搜索，作 topic 信号兜底）
 *  - 'auto'（默认）：按 bing → google → hn → npr 顺序，取第一个成功者
 */
import type { DriverConfig, SearchItem, SearchProvider } from '@openlango/core';

export interface RssSearchConfig {
  driver: 'rss';
  engine?: 'auto' | 'bing' | 'google' | 'hn' | 'npr';
  hl?: string; // 默认 en-US
  [key: string]: unknown;
}

const FRESHNESS_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]!.trim()) : '';
}

function cdata(block: string, tag: string): string {
  const raw = pick(block, tag);
  return raw;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) OpenLango/0.0.1' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}

async function searchBing(query: string, when: string | undefined): Promise<SearchItem[]> {
  const whenToken = when === 'day' ? 'when:1d' : when === 'week' ? 'when:7d' : when === 'month' ? 'when:1m' : '';
  const q = encodeURIComponent(whenToken ? `${query} ${whenToken}` : query);
  const xml = await fetchText(
    `https://www.bing.com/news/search?q=${q}&setmkt=en-US&setlang=en&format=RSS`,
  );
  const blocks = xml.split('<item>').slice(1);
  if (blocks.length === 0) throw new Error('bing: no items');
  return blocks.slice(0, 10).map((block) => ({
    title: stripHtml(cdata(block, 'title')),
    url: pick(block, 'link'),
    snippet: stripHtml(pick(block, 'description')).slice(0, 500),
    publishedAt: pick(block, 'pubDate'),
  }));
}

async function searchGoogle(query: string, when: string | undefined): Promise<SearchItem[]> {
  const whenToken = when === 'day' ? 'when:1d' : when === 'week' ? 'when:7d' : when === 'month' ? 'when:1m' : '';
  const q = encodeURIComponent(whenToken ? `${query} ${whenToken}` : query);
  const xml = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  const blocks = xml.split('<item>').slice(1);
  if (blocks.length === 0) throw new Error('google: no items');
  return blocks.slice(0, 10).map((block) => ({
    title: stripHtml(cdata(block, 'title')),
    url: pick(block, 'link'),
    snippet: stripHtml(pick(block, 'description')).slice(0, 500),
    publishedAt: pick(block, 'pubDate'),
    source: block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim(),
  }));
}

async function searchHn(query: string, when: string | undefined): Promise<SearchItem[]> {
  const days = when ? FRESHNESS_DAYS[when] ?? 7 : 30;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}`;
  const text = await fetchText(url);
  const data = JSON.parse(text) as {
    hits: Array<{ title?: string; url?: string; story_text?: string; created_at?: string; points?: number; objectID?: string }>;
  };
  const hits = data.hits.filter((h) => h.title);
  if (hits.length === 0) throw new Error('hn: no hits');
  return hits.map((h) => ({
    title: h.title!,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID ?? ''}`,
    snippet: (h.story_text ? stripHtml(h.story_text) : h.title!).slice(0, 500),
    publishedAt: h.created_at,
    source: 'hacker-news',
  }));
}

async function searchNpr(): Promise<SearchItem[]> {
  const xml = await fetchText('https://feeds.npr.org/1001/rss.xml');
  const blocks = xml.split('<item>').slice(1);
  if (blocks.length === 0) throw new Error('npr: no items');
  return blocks.slice(0, 10).map((block) => ({
    title: stripHtml(cdata(block, 'title')),
    url: pick(block, 'link'),
    snippet: stripHtml(pick(block, 'description')).slice(0, 500),
    publishedAt: pick(block, 'pubDate'),
    source: 'npr-latest',
  }));
}

export function createRssSearch(raw: DriverConfig): SearchProvider {
  const cfg = raw as unknown as RssSearchConfig;
  const engine = cfg.engine ?? 'auto';

  const chain: Array<{ name: string; run: (q: string, w: string | undefined) => Promise<SearchItem[]> }> =
    engine === 'auto'
      ? [
          { name: 'bing', run: searchBing },
          { name: 'google', run: searchGoogle },
          { name: 'hn', run: searchHn },
          { name: 'npr', run: () => searchNpr() },
        ]
      : engine === 'npr'
        ? [{ name: 'npr', run: () => searchNpr() }]
        : engine === 'hn'
          ? [{ name: 'hn', run: searchHn }]
          : engine === 'google'
            ? [{ name: 'google', run: searchGoogle }]
            : [{ name: 'bing', run: searchBing }];

  return {
    driver: 'rss',

    async search(query, opts): Promise<SearchItem[]> {
      const when = opts?.freshness;
      const errors: string[] = [];
      for (const e of chain) {
        try {
          const items = await e.run(query, when);
          if (items.length > 0) return items.slice(0, opts?.limit ?? items.length);
          errors.push(`${e.name}: empty`);
        } catch (err) {
          // 国内无代理环境 google/bing 常超时：engine 可在 config 固定为 hn/npr 等可直连源
          errors.push(`${e.name}: ${(err as Error).message.slice(0, 80)}`);
        }
      }
      throw new Error(
        `all engines failed [${errors.join('; ')}] — 国内网络建议 config 里 engine 固定为 'hn' 或 'npr'`,
      );
    },
  };
}
