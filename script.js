const WORKER_URL = 'https://1minuteyt-proxy.multoretik.workers.dev';

// ---------- state ----------
let selectedRpm = 0.7;
let selectedRegion = 'ru';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

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
const truncatedNote = $('truncatedNote');

// ---------- UI wiring ----------
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
channelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runAnalysis();
});

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

function animateCount(el, target, formatter, duration = 900) {
  const startTime = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = target * eased;
    el.textContent = formatter(value);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(tick);
}

// ---------- main flow ----------
async function runAnalysis() {
  clearError();
  results.hidden = true;

  const channel = channelInput.value.trim();
  if (!channel) return showError('Укажи ссылку на канал, @handle или ID.');

  analyzeBtn.disabled = true;
  progressCard.hidden = false;
  setProgress(15, 'Читаем страницу канала…');

  try {
    const res = await fetch(`${WORKER_URL}/api/analyze?channel=${encodeURIComponent(channel)}`);
    setProgress(80, 'Считаем доход…');
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Не получилось проанализировать канал.');
    }

    let effectiveRpm = selectedRpm;
    let rpmLabel = `$${selectedRpm.toFixed(2)} / 1000 просмотров (оценка, ${
      selectedRegion === 'ru' ? 'Россия/СНГ' : selectedRegion === 'en' ? 'англоязычная аудитория' : 'своё значение'
    })`;
    let totalRevenue;

    if (realIncomeToggle.checked && realIncome.value && parseFloat(realIncome.value) > 0) {
      totalRevenue = parseFloat(realIncome.value);
      rpmLabel = 'твой реальный доход за месяц';
    } else {
      totalRevenue = (data.lastMonth.views / 1000) * effectiveRpm;
    }

    const revenuePerMinute = data.lastMonth.minutes > 0 ? totalRevenue / data.lastMonth.minutes : 0;

    renderResults({ ...data, rpmLabel, totalRevenue, revenuePerMinute });

    setProgress(100, 'Готово');
    setTimeout(() => (progressCard.hidden = true), 400);
  } catch (err) {
    progressCard.hidden = true;
    showError(err.message || 'Что-то пошло не так. Проверь ссылку и попробуй ещё раз.');
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResults(data) {
  const { channel, lastMonth, rpmLabel, totalRevenue, revenuePerMinute } = data;

  $('chThumb').src = channel.avatar || '';
  $('chTitle').textContent = channel.title || '—';
  $('chSubs').textContent = channel.subscribers || '—';
  $('chLifetimeViews').textContent = channel.lifetimeViews ? `${channel.lifetimeViews} просмотров за всё время` : '—';
  $('chJoined').textContent = channel.joined || '';

  animateCount($('statViews'), lastMonth.views, (v) => fmtNumber(v));
  animateCount($('statVideos'), lastMonth.videoCount, (v) => fmtNumber(v));

  const minutes = lastMonth.minutes;
  const hours = minutes / 60;
  $('statDuration').textContent = hours >= 1 ? `${fmtNumber(hours)} ч` : `${fmtNumber(minutes)} мин`;

  $('statRpm').textContent = rpmLabel;

  animateCount($('statRevenue'), totalRevenue, (v) => fmtMoney(v));
  animateCount($('statPerMinute'), revenuePerMinute, (v) => (v < 1 ? `$${v.toFixed(3)}` : fmtMoney(v)));

  truncatedNote.hidden = !lastMonth.truncated;

  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
