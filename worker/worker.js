const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const COOKIE = 'PREF=hl=en&gl=US; SOCS=CAI';
const MAX_PAGES = 15; // safety cap: ~450 recent videos is enough to cover a month for virtually any channel

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function resolveVideosUrl(input) {
  const v = input.trim();
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(v)) return `https://www.youtube.com/channel/${v}/videos`;
  if (v.startsWith('@')) return `https://www.youtube.com/${v}/videos`;
  try {
    const u = new URL(v.startsWith('http') ? v : `https://${v}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0].startsWith('@')) return `https://www.youtube.com/${parts[0]}/videos`;
    if (parts[0] === 'channel' && parts[1]) return `https://www.youtube.com/channel/${parts[1]}/videos`;
    if (parts[0] === 'c' && parts[1]) return `https://www.youtube.com/c/${parts[1]}/videos`;
    if (parts[0] === 'user' && parts[1]) return `https://www.youtube.com/user/${parts[1]}/videos`;
    return `https://www.youtube.com/${parts[0]}/videos`;
  } catch {
    return `https://www.youtube.com/@${v}/videos`;
  }
}

function extractJsonAfter(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function parseDurationText(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

function parseViewCount(t) {
  if (!t || !/view/i.test(t)) return null;
  const cleaned = t.replace(/,/g, '');
  const m = cleaned.match(/([\d.]+)\s*([KMB]?)\s*views?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') n *= 1e3;
  else if (suffix === 'M') n *= 1e6;
  else if (suffix === 'B') n *= 1e9;
  return Math.round(n);
}

function parseRelativeDays(t) {
  if (!t) return null;
  const m = t.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = { second: 0, minute: 0, hour: 0, day: 1, week: 7, month: 30.5, year: 365 };
  return n * (mult[unit] ?? 0);
}

function extractVideosFromContents(contents) {
  const videos = [];
  let continuationToken = null;
  for (const item of contents || []) {
    const lv = item.richItemRenderer?.content?.lockupViewModel;
    if (lv) {
      const meta = lv.metadata?.lockupMetadataViewModel;
      const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = rows[0]?.metadataParts || [];
      const viewText = parts[0]?.text?.content;
      const publishedText = parts[1]?.text?.content;
      let durationText = null;
      const overlays = lv.contentImage?.thumbnailViewModel?.overlays || [];
      for (const ov of overlays) {
        for (const b of ov.thumbnailBottomOverlayViewModel?.badges || []) {
          if (b.thumbnailBadgeViewModel?.text) durationText = b.thumbnailBadgeViewModel.text;
        }
      }
      const viewCount = parseViewCount(viewText);
      const daysAgo = parseRelativeDays(publishedText);
      if (viewCount !== null && daysAgo !== null) {
        videos.push({
          id: lv.contentId,
          title: meta?.title?.content || '',
          viewCount,
          daysAgo,
          durationSec: parseDurationText(durationText),
        });
      }
      continue;
    }
    if (item.continuationItemRenderer) {
      continuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
    }
  }
  return { videos, continuationToken };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: COOKIE },
  });
  return { status: res.status, html: await res.text() };
}

async function fetchContinuation(apiKey, clientVersion, token) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: COOKIE },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
      continuation: token,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const appended = (data.onResponseReceivedActions || []).find((a) => a.appendContinuationItemsAction)
    ?.appendContinuationItemsAction;
  return appended ? appended.continuationItems : null;
}

async function analyzeChannel(input) {
  const videosUrl = resolveVideosUrl(input);
  if (!videosUrl) throw new HttpError(400, 'Не удалось разобрать ссылку на канал.');

  const { status, html } = await fetchHtml(videosUrl);
  if (status === 404 || /This channel does not exist/i.test(html)) {
    throw new HttpError(404, 'Канал не найден. Проверь ссылку, @handle или ID.');
  }
  if (status !== 200) {
    throw new HttpError(502, `YouTube ответил статусом ${status}. Попробуй ещё раз чуть позже.`);
  }

  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

  const dataStr = extractJsonAfter(html, 'var ytInitialData');
  if (!dataStr) throw new HttpError(502, 'Не получилось прочитать данные канала (возможно, YouTube изменил разметку).');
  const initialData = JSON.parse(dataStr);

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];

  const tabs = initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find((t) => t.tabRenderer?.title === 'Videos');
  const richContents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents;
  if (!richContents) throw new HttpError(502, 'На канале не нашлось вкладки с видео (возможно, она скрыта или это не обычный канал).');

  let { videos, continuationToken } = extractVideosFromContents(richContents);
  let pages = 1;
  let truncated = false;

  while (continuationToken && pages < MAX_PAGES) {
    const oldestSoFar = videos[videos.length - 1];
    if (oldestSoFar && oldestSoFar.daysAgo > 31) break; // already past last month
    if (!apiKey || !clientVersion) break;
    const items = await fetchContinuation(apiKey, clientVersion, continuationToken);
    if (!items) break;
    const next = extractVideosFromContents(items);
    videos = videos.concat(next.videos);
    continuationToken = next.continuationToken;
    pages += 1;
  }
  if (continuationToken && videos[videos.length - 1]?.daysAgo <= 31) truncated = true;

  const lastMonth = videos.filter((v) => v.daysAgo <= 31);
  const viewsLastMonth = lastMonth.reduce((s, v) => s + v.viewCount, 0);
  const secondsLastMonth = lastMonth.reduce((s, v) => s + (v.durationSec || 0), 0);
  const videosWithDuration = lastMonth.filter((v) => v.durationSec !== null).length;

  // channel identity + lifetime stats from the About page
  let subscribers = null;
  let lifetimeViews = null;
  let joined = null;
  try {
    const aboutUrl = videosUrl.replace(/\/videos$/, '/about');
    const { html: aboutHtml } = await fetchHtml(aboutUrl);
    subscribers = aboutHtml.match(/"subscriberCountText":"([^"]+)"/)?.[1] || null;
    lifetimeViews = aboutHtml.match(/"viewCountText":"([\d,]+) views"/)?.[1] || null;
    joined = aboutHtml.match(/"joinedDateText":\{"content":"([^"]+)"/)?.[1] || null;
  } catch {
    // best-effort only
  }

  return {
    channel: {
      title: ogTitle || null,
      avatar: ogImage || null,
      url: canonicalMatch || videosUrl.replace(/\/videos$/, ''),
      subscribers,
      lifetimeViews,
      joined,
    },
    lastMonth: {
      videoCount: lastMonth.length,
      viewsWithKnownDuration: videosWithDuration,
      views: viewsLastMonth,
      seconds: secondsLastMonth,
      minutes: secondsLastMonth / 60,
      truncated,
    },
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    if (url.pathname !== '/api/analyze') return json({ error: 'Not found' }, 404);

    const channel = url.searchParams.get('channel');
    if (!channel) return json({ error: 'Параметр channel обязателен.' }, 400);

    try {
      const result = await analyzeChannel(channel);
      return json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Внутренняя ошибка при анализе канала.';
      return json({ error: message }, status);
    }
  },
};
