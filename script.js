// ---------- state ----------
let selectedRpm = 0.7;
let selectedRegion = 'ru';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const apiKeyInput = $('apiKey');
const saveKeyBox = $('saveKey');
const toggleKeyVisibility = $('toggleKeyVisibility');
const toggleHelp = $('toggleHelp');
const helpBox = $('helpBox');
const channelInput = $('channelInput');
const regionPills = $('regionPills');
const customRpmRow = $('customRpmRow');
const customRpm = $('customRpm');
const customRpmValue = $('customRpmValue');
const realIncomeToggle = $('realIncomeToggle');
const realIncomeRow = $('realIncomeRow');
const realIncome = $('realIncome');
const analyzeBtn = $('analyzeBtn');
const errorMsg = $('errorMsg');
const progressCard = $('progressCard');
const progressText = $('progressText');
const progressFill = $('progressFill');
const results = $('results');

// ---------- restore saved key ----------
const storedKey = localStorage.getItem('yt_api_key');
if (storedKey) {
  apiKeyInput.value = storedKey;
  saveKeyBox.checked = true;
}

// ---------- UI wiring ----------
toggleHelp.addEventListener('click', () => {
  helpBox.hidden = !helpBox.hidden;
});

toggleKeyVisibility.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

regionPills.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  [...regionPills.children].forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  selectedRegion = btn.dataset.region;
  if (selectedRegion === 'custom') {
    customRpmRow.hidden = false;
    selectedRpm = parseFloat(customRpm.value);
  } else {
    customRpmRow.hidden = true;
    selectedRpm = parseFloat(btn.dataset.rpm);
  }
});

customRpm.addEventListener('input', () => {
  customRpmValue.textContent = `$${parseFloat(customRpm.value).toFixed(1)}`;
  selectedRpm = parseFloat(customRpm.value);
});

realIncomeToggle.addEventListener('change', () => {
  realIncomeRow.hidden = !realIncomeToggle.checked;
});

analyzeBtn.addEventListener('click', runAnalysis);

// ---------- helpers ----------
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}
function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}
function setProgress(pct, text) {
  progressFill.style.width = `${pct}%`;
  if (text) progressText.textContent = text;
}
function fmtNumber(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}
function fmtMoney(n) {
  if (n >= 1000) return `$${fmtNumber(n)}`;
  return `$${n.toFixed(2)}`;
}
function parseISODuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || 0, 10);
  const min = parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  return h * 3600 + min * 60 + s;
}

function animateCount(el, target, formatter, duration = 900) {
  const start = 0;
  const startTime = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = start + (target - start) * eased;
    el.textContent = formatter(value);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(tick);
}

// ---------- channel input parsing ----------
function parseChannelInput(raw) {
  const value = raw.trim();
  if (!value) return null;

  // raw channel ID
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(value)) {
    return { type: 'id', value };
  }

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return { type: 'search', value };

    if (parts[0].startsWith('@')) return { type: 'handle', value: parts[0].slice(1) };
    if (parts[0] === 'channel' && parts[1]) return { type: 'id', value: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { type: 'search', value: parts[1] };
    if (parts[0] === 'user' && parts[1]) return { type: 'username', value: parts[1] };
    return { type: 'search', value: parts[0] };
  } catch {
    // not a URL — treat as handle or plain search term
    if (value.startsWith('@')) return { type: 'handle', value: value.slice(1) };
    return { type: 'search', value };
  }
}

// ---------- YouTube API ----------
const API = 'https://www.googleapis.com/youtube/v3';

async function apiGet(path, params) {
  const url = new URL(`${API}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || 'unknown';
    const message = data?.error?.message || 'Ошибка запроса к YouTube API';
    const err = new Error(message);
    err.reason = reason;
    throw err;
  }
  return data;
}

async function resolveChannel(apiKey, parsed) {
  const base = { key: apiKey, part: 'snippet,statistics,contentDetails' };

  if (parsed.type === 'id') {
    const data = await apiGet('channels', { ...base, id: parsed.value });
    if (data.items?.length) return data.items[0];
  }
  if (parsed.type === 'handle') {
    const data = await apiGet('channels', { ...base, forHandle: parsed.value });
    if (data.items?.length) return data.items[0];
  }
  if (parsed.type === 'username') {
    const data = await apiGet('channels', { ...base, forUsername: parsed.value });
    if (data.items?.length) return data.items[0];
  }

  // fallback: search by term, then resolve full channel resource
  const searchTerm = parsed.value;
  const searchData = await apiGet('search', {
    key: apiKey,
    part: 'snippet',
    type: 'channel',
    q: searchTerm,
    maxResults: 1,
  });
  const channelId = searchData.items?.[0]?.snippet?.channelId || searchData.items?.[0]?.id?.channelId;
  if (!channelId) throw new Error('Канал не найден. Проверь ссылку или @handle.');
  const data = await apiGet('channels', { ...base, id: channelId });
  if (data.items?.length) return data.items[0];
  throw new Error('Канал не найден.');
}

async function fetchAllVideos(apiKey, uploadsPlaylistId, onProgress) {
  const videos = [];
  let pageToken = '';
  let page = 0;
  const MAX_PAGES = 400; // safety cap (~20,000 videos)

  do {
    const data = await apiGet('playlistItems', {
      key: apiKey,
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    const ids = (data.items || [])
      .map((it) => it.contentDetails?.videoId)
      .filter(Boolean);

    if (ids.length) {
      const detailData = await apiGet('videos', {
        key: apiKey,
        part: 'contentDetails,snippet',
        id: ids.join(','),
      });
      for (const v of detailData.items || []) {
        videos.push({
          id: v.id,
          durationSec: parseISODuration(v.contentDetails.duration),
          publishedAt: v.snippet?.publishedAt,
        });
      }
    }

    pageToken = data.nextPageToken || '';
    page += 1;
    onProgress(videos.length, pageToken ? null : videos.length);
  } while (pageToken && page < MAX_PAGES);

  return videos;
}

// ---------- main flow ----------
async function runAnalysis() {
  clearError();
  results.hidden = true;

  const apiKey = apiKeyInput.value.trim();
  const parsed = parseChannelInput(channelInput.value);

  if (!apiKey) return showError('Укажи API-ключ YouTube Data API v3.');
  if (!parsed) return showError('Укажи ссылку на канал, @handle или ID.');

  if (saveKeyBox.checked) localStorage.setItem('yt_api_key', apiKey);
  else localStorage.removeItem('yt_api_key');

  analyzeBtn.disabled = true;
  progressCard.hidden = false;
  setProgress(5, 'Ищем канал…');

  try {
    const channel = await resolveChannel(apiKey, parsed);
    const uploadsId = channel.contentDetails.relatedPlaylists.uploads;
    const totalViews = parseInt(channel.statistics.viewCount || 0, 10);
    const videoCount = parseInt(channel.statistics.videoCount || 0, 10);
    const subCount = channel.statistics.hiddenSubscriberCount
      ? null
      : parseInt(channel.statistics.subscriberCount || 0, 10);

    setProgress(15, `Загружаем видео (0 из ~${fmtNumber(videoCount)})…`);

    const videos = await fetchAllVideos(apiKey, uploadsId, (loaded) => {
      const pct = Math.min(95, 15 + (loaded / Math.max(videoCount, 1)) * 80);
      setProgress(pct, `Загружено видео: ${fmtNumber(loaded)} из ~${fmtNumber(videoCount)}`);
    });

    setProgress(97, 'Считаем доход…');

    const totalSeconds = videos.reduce((sum, v) => sum + v.durationSec, 0);
    const totalMinutes = totalSeconds / 60;

    // effective RPM: calibrate from user's real income over last 30 days, if provided
    let effectiveRpm = selectedRpm;
    let rpmLabel = `$${selectedRpm.toFixed(2)} / 1000 просмотров (оценка, ${selectedRegion === 'ru' ? 'Россия/СНГ' : selectedRegion === 'en' ? 'англоязычная аудитория' : 'своё значение'})`;

    if (realIncomeToggle.checked && realIncome.value) {
      const income = parseFloat(realIncome.value);
      const now = Date.now();
      const monthAgo = now - 30 * 24 * 3600 * 1000;
      const recentVideoIds = videos.filter((v) => v.publishedAt && new Date(v.publishedAt).getTime() >= monthAgo);

      if (recentVideoIds.length && income > 0) {
        // fetch fresh view counts just for recent videos to calibrate RPM
        const idChunks = [];
        for (let i = 0; i < recentVideoIds.length; i += 50) idChunks.push(recentVideoIds.slice(i, i + 50));
        let recentViews = 0;
        for (const chunk of idChunks) {
          const data = await apiGet('videos', { key: apiKey, part: 'statistics', id: chunk.map((v) => v.id).join(',') });
          recentViews += (data.items || []).reduce((s, v) => s + parseInt(v.statistics.viewCount || 0, 10), 0);
        }
        if (recentViews > 0) {
          effectiveRpm = income / (recentViews / 1000);
          rpmLabel = `$${effectiveRpm.toFixed(2)} / 1000 просмотров (рассчитан по твоему доходу за 30 дней)`;
        }
      } else if (income > 0) {
        rpmLabel = `$${selectedRpm.toFixed(2)} / 1000 просмотров (не нашли видео за 30 дней — использована оценка по региону)`;
      }
    }

    const totalRevenue = (totalViews / 1000) * effectiveRpm;
    const revenuePerMinute = totalMinutes > 0 ? totalRevenue / totalMinutes : 0;

    renderResults({
      channel,
      totalViews,
      videoCount,
      subCount,
      totalMinutes,
      rpmLabel,
      totalRevenue,
      revenuePerMinute,
    });

    setProgress(100, 'Готово');
    setTimeout(() => (progressCard.hidden = true), 500);
  } catch (err) {
    progressCard.hidden = true;
    if (err.reason === 'quotaExceeded') {
      showError('Дневная квота твоего API-ключа исчерпана. Попробуй завтра или создай новый ключ.');
    } else if (err.reason === 'keyInvalid' || err.reason === 'badRequest') {
      showError('Похоже, API-ключ неверный или не активирован для YouTube Data API v3.');
    } else {
      showError(err.message || 'Что-то пошло не так. Проверь ключ и ссылку на канал.');
    }
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResults(data) {
  const { channel, totalViews, videoCount, subCount, totalMinutes, rpmLabel, totalRevenue, revenuePerMinute } = data;

  $('chThumb').src = channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url || '';
  $('chTitle').textContent = channel.snippet.title;
  $('chSubs').textContent = subCount !== null ? `${fmtNumber(subCount)} подписчиков` : 'Подписчики скрыты';

  animateCount($('statViews'), totalViews, (v) => fmtNumber(v));
  animateCount($('statVideos'), videoCount, (v) => fmtNumber(v));

  const hours = totalMinutes / 60;
  $('statDuration').textContent = hours >= 1 ? `${fmtNumber(hours)} ч` : `${fmtNumber(totalMinutes)} мин`;

  $('statRpm').textContent = rpmLabel;

  animateCount($('statRevenue'), totalRevenue, (v) => fmtMoney(v));
  animateCount($('statPerMinute'), revenuePerMinute, (v) => (v < 1 ? `$${v.toFixed(3)}` : fmtMoney(v)));

  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
