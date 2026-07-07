const $ = (id) => document.getElementById(id);

const incomeInput = $('incomeInput');
const hoursInput = $('hoursInput');
const calcBtn = $('calcBtn');
const errorMsg = $('errorMsg');
const results = $('results');
const statPerMinute = $('statPerMinute');
const statIncome = $('statIncome');
const statMinutes = $('statMinutes');

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}
function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}
function fmtNumber(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}
function fmtMoney(n) {
  if (n >= 1000) return `$${fmtNumber(n)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function animateCount(el, target, formatter, duration = 700) {
  const startTime = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter(target * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(tick);
}

function calculate() {
  clearError();

  const income = parseFloat(incomeInput.value);
  const hours = parseFloat(hoursInput.value);

  if (!income || income <= 0) return showError('Укажи доход за месяц больше нуля.');
  if (!hours || hours <= 0) return showError('Укажи часы просмотра за месяц больше нуля.');

  const minutes = hours * 60;
  const perMinute = income / minutes;

  animateCount(statPerMinute, perMinute, (v) => (v < 1 ? `$${v.toFixed(3)}` : fmtMoney(v)));
  animateCount(statIncome, income, (v) => fmtMoney(v));
  animateCount(statMinutes, minutes, (v) => fmtNumber(v));

  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

calcBtn.addEventListener('click', calculate);
[incomeInput, hoursInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') calculate();
  });
});
