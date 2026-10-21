/* Сказка · проводник. Vanilla JS, без сборки. */
'use strict';

/* ================= константы ================= */
const PARK = { lat: 55.771505, lon: 37.434665, name: 'Парк «Сказка»', addr: 'ул. Крылатская, 18' };
const RADIUS_M = 700;
const OPEN_H = 10, CLOSE_H = 22;           // по данным сайта (пт–вс); в будни уточняйте
const DAYS_AHEAD = 60, FORECAST_DAYS = 16;
// ПРЕДПОЛОЖЕНИЕ: осенние каникулы (точные даты школ уточнить) — в эти дни будни считаем «почти выходными»
const BREAKS = [['2026-10-24', '2026-11-01']];
const isBreak = ds => BREAKS.some(([a, b]) => ds >= a && ds <= b);
const HOLIDAYS = { '2026-11-04': 'День народного единства', '2026-12-31': 'Новый год', '2027-01-01': 'Новый год', '2027-01-02': 'Каникулы', '2027-01-03': 'Каникулы' };
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const TYPE_RU = { extreme: 'Экстрим', kids: 'Детям', family: 'Семейный', interactive: 'Интерактив', zone: 'Зона' };
const TYPE_EMOJI = { extreme: '🎢', kids: '🎠', family: '🎡', interactive: '👻', zone: '🦖' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const longDate = d => `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ATT = window.ATTRACTIONS || [];

/* ================= состояние (localStorage) ================= */
const store = {
  get() { try { return JSON.parse(localStorage.getItem('skazka.state')) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem('skazka.state', JSON.stringify(v)); } catch { /* приватный режим */ } }
};
const defaults = () => ({ coins: 0, xp: 0, checkins: [], done: {}, family: [{ name: 'Малыш', h: 110 }, { name: 'Взрослый', h: 175 }], mood: 'mix', reports: [], demo: false, rewards: {} });
let S = Object.assign(defaults(), store.get());
const save = () => store.set(S);

const UI = { dateStr: null, hour: 12, user: null, forecast: null, climate: null, days: [], map: null };

/* ================= погода ================= */
const WX = c => {
  if (c === 0) return { i: '☀️', t: 'ясно', k: 'clear' };
  if (c === 1) return { i: '🌤️', t: 'малооблачно', k: 'clear' };
  if (c === 2) return { i: '⛅', t: 'переменная облачность', k: 'partly' };
  if (c === 3) return { i: '☁️', t: 'пасмурно', k: 'cloud' };
  if (c === 45 || c === 48) return { i: '🌫️', t: 'туман', k: 'fog' };
  if (c >= 51 && c <= 57) return { i: '🌦️', t: 'морось', k: 'rain' };
  if (c >= 61 && c <= 67) return { i: '🌧️', t: 'дождь', k: 'rain' };
  if (c >= 71 && c <= 77) return { i: '❄️', t: 'снег', k: 'snow' };
  if (c >= 80 && c <= 82) return { i: '🌧️', t: 'ливень', k: 'rain' };
  if (c === 85 || c === 86) return { i: '🌨️', t: 'снегопад', k: 'snow' };
  if (c >= 95) return { i: '⛈️', t: 'гроза', k: 'storm' };
  return { i: '☁️', t: 'облачно', k: 'cloud' };
};

async function loadForecast() {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${PARK.lat}&longitude=${PARK.lon}` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weathercode,wind_speed_10m` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum` +
    `&forecast_days=${FORECAST_DAYS}&timezone=Europe%2FMoscow&wind_speed_unit=ms`;
  const r = await fetch(u); if (!r.ok) throw new Error('forecast ' + r.status);
  return r.json();
}
async function loadClimate() {
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${PARK.lat}&longitude=${PARK.lon}` +
    `&start_date=2015-01-01&end_date=2025-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=Europe%2FMoscow`;
  const r = await fetch(u); if (!r.ok) throw new Error('climate ' + r.status);
  return r.json();
}

/* климат: ±3 дня вокруг даты за 2015–2025 */
function climateFor(date) {
  const C = UI.climate; if (!C) return null;
  const tgt = Date.UTC(2001, date.getMonth(), date.getDate());
  let n = 0, tmax = 0, tmin = 0, rain = 0, snow = 0;
  const T = C.daily.time;
  for (let i = 0; i < T.length; i++) {
    const m = +T[i].slice(5, 7), d = +T[i].slice(8, 10);
    const diff = Math.abs((Date.UTC(2001, m - 1, d) - tgt) / 864e5);
    if (diff > 3 && diff < 362) continue;
    const a = C.daily.temperature_2m_max[i], b = C.daily.temperature_2m_min[i];
    if (a == null || b == null) continue;
    n++; tmax += a; tmin += b;
    if ((C.daily.precipitation_sum[i] || 0) >= 1) rain++;
    if ((C.daily.snowfall_sum[i] || 0) >= 0.5) snow++;
  }
  if (!n) return null;
  return { tmax: tmax / n, tmin: tmin / n, pr: Math.round(100 * rain / n), snowShare: snow / Math.max(rain, 1) };
}

function buildDays() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  const F = UI.forecast;
  const first = F ? parseDate(F.daily.time[0]) : today;
  for (let k = 0; k < DAYS_AHEAD; k++) {
    const date = addDays(first, k), ds = fmtDate(date);
    let day;
    if (F && k < FORECAST_DAYS) {
      const dc = F.daily.weathercode[k];
      day = { ds, date, src: 'forecast', idx: k, code: dc, tmax: F.daily.temperature_2m_max[k], tmin: F.daily.temperature_2m_min[k], pr: F.daily.precipitation_probability_max[k] ?? 0, mm: F.daily.precipitation_sum[k] || 0 };
    } else {
      const c = climateFor(date) || { tmax: 8, tmin: 2, pr: 40, snowShare: 0 };
      const snowy = c.tmax < 1 || (c.tmax < 4 && c.snowShare > .5);
      const code = c.pr >= 55 ? (snowy ? 73 : 63) : c.pr >= 35 ? (snowy ? 71 : 3) : c.pr >= 20 ? 2 : 1;
      day = { ds, date, src: 'climate', idx: k, code, tmax: c.tmax, tmin: c.tmin, pr: c.pr, mm: 0 };
    }
    day.hol = HOLIDAYS[ds] || null;
    days.push(day);
  }
  days.forEach(d => { d.hours = hoursFor(d); d.bestH = bestOf(d.hours); d.q = dayQ(d); });
  return days;
}

/* погода конкретного часа */
function wxAt(day, h) {
  if (day.src === 'forecast' && UI.forecast) {
    const i = day.idx * 24 + h, H = UI.forecast.hourly;
    return { t: H.temperature_2m[i], p: H.precipitation_probability[i] ?? 0, mm: H.precipitation[i] || 0, code: H.weathercode[i], wind: H.wind_speed_10m[i] || 0 };
  }
  const bell = Math.sin(Math.PI * clamp((h - 6) / 14, 0, 1));
  const t = day.tmin + (day.tmax - day.tmin) * bell;
  return { t, p: day.pr, mm: 0, code: day.code, wind: 3 };
}

/* восход/закат по широте (приблизительно) */
function sunTimes(date) {
  const start = new Date(date.getFullYear(), 0, 0), doy = Math.floor((date - start) / 864e5);
  const decl = 0.409 * Math.sin(2 * Math.PI * (doy - 81) / 365);
  const lat = PARK.lat * Math.PI / 180;
  const ha = Math.acos(clamp(-Math.tan(lat) * Math.tan(decl), -1, 1)) * 12 / Math.PI;
  const noon = 12 + (45 - PARK.lon) / 15;
  return { rise: noon - ha, set: noon + ha };
}
const isDay = (date, h) => { const s = sunTimes(date); return h + .5 > s.rise && h + .5 < s.set; };

/* ================= модель загрузки парка ================= */
const hourCurve = (h, weekend) => {
  const g = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  // будни в школьное время: тихо до обеда, второй пик после уроков
  return weekend ? 0.15 + 0.85 * g(14.5, 2.6) + 0.30 * g(19, 1.6) : 0.08 + 0.52 * g(14.8, 2.3) + 0.30 * g(17.6, 1.7);
};
function dayFactor(date, hol) {
  const w = date.getDay();
  let f = w === 6 || w === 0 ? 1 : w === 5 ? .78 : .48;
  if (hol) f = Math.max(f, .95);
  if (isBreak(fmtDate(date)) && w >= 1 && w <= 5) f = Math.max(f, .82);
  const m = date.getMonth(), dd = date.getDate();
  if (m === 11 && dd >= 21) f = Math.max(f, .9);            // перед Новым годом
  if (m === 0 && dd <= 8) f = Math.max(f, .95);
  return f;
}
function weatherFactor(w, date, h) {
  let f = 1;
  const k = WX(w.code).k;
  f *= 1 - 0.5 * clamp(w.p / 100, 0, 1) * (k === 'rain' || k === 'storm' || k === 'snow' ? 1 : .6);
  if (w.mm > 1) f *= .8;
  if (w.t < -10) f *= .5; else if (w.t < 0) f *= .7; else if (w.t < 8) f *= .85; else if (w.t > 30) f *= .85;
  else if (w.t >= 16 && w.t <= 26 && (k === 'clear' || k === 'partly')) f *= 1.12;
  if (!isDay(date, h)) f *= .9;
  return f;
}
function reportBoost(ds, h) {
  const r = S.reports.filter(x => x.ds === ds && Math.abs(x.h - h) <= 1);
  if (!r.length) return 0;
  return clamp(r.reduce((a, x) => a + x.min, 0) / r.length / 60 * 100 - 40, -15, 25) * .5;
}
function loadAt(day, h) {
  const weekend = [0, 6].includes(day.date.getDay()) || !!day.hol || isBreak(day.ds);
  const season = [10, 11, 0, 1, 2].includes(day.date.getMonth()) ? .85 : 1;
  const raw = hourCurve(h, weekend) * dayFactor(day.date, day.hol) * weatherFactor(wxAt(day, h), day.date, h) * season;
  return clamp(Math.round(raw * 100 + reportBoost(day.ds, h)), 4, 100);
}
function hoursFor(day) {
  const out = [];
  for (let h = OPEN_H; h < CLOSE_H; h++) out.push({ h, load: loadAt(day, h) });
  return out;
}
// «лучшее время» ищем в дневные часы (10–18), а не под закрытие
const bestOf = hs => hs.filter(x => x.h <= 18).reduce((a, b) => (b.load < a.load ? b : a));
const dayQ = d => { const hs = d.hours.filter(x => x.h >= 11 && x.h <= 17); return qLevel(hs.reduce((a, x) => a + x.load, 0) / hs.length); };
const qLevel = l => (l < 25 ? 1 : l < 50 ? 2 : l < 75 ? 3 : 4);
const qName = l => ['', 'тихо', 'комфортно', 'людно', 'очереди'][qLevel(l)];
const waitMin = (load, pop) => clamp(Math.round(load * 0.55 * pop * (pop > 1.2 ? 1.1 : 1) / 5) * 5, 0, 90);
const coinMult = load => (load < 25 ? 3 : load < 50 ? 2 : load < 75 ? 1.5 : 1);
/* ---- модель по аттракционам ---- */
// пик спроса зависит от типа: малыши — до обеда, экстрим — ближе к вечеру
const TYPE_PEAK = { extreme: [16, 2.8], kids: [12.5, 2.6], family: [14.5, 2.8], interactive: [14, 3], zone: [13.5, 3] };
const isWet = k => ['rain', 'storm', 'snow'].includes(k);
function attLoad(a, day, h) {
  const base = day.hours.find(x => x.h === h)?.load ?? loadAt(day, h);
  const [c, w] = TYPE_PEAK[a.type] || TYPE_PEAK.family;
  let f = 0.75 + 0.5 * Math.exp(-((h - c) ** 2) / (2 * w * w));
  if (isWet(WX(wxAt(day, h).code).k)) f *= a.type === 'interactive' ? 1.35 : a.type === 'extreme' ? .85 : 1;   // в дождь идут под крышу
  return clamp(Math.round(base * f), 3, 100);
}
const dayConf = day => day.src === 'forecast' ? (day.idx <= 2 ? { n: 'высокая', s: 5 } : day.idx <= 9 ? { n: 'средняя', s: 10 } : { n: 'невысокая', s: 15 }) : { n: 'ориентир', s: 25 };
function waitFor(a, day, h) {
  let m = attLoad(a, day, h) * 0.55 * a.pop * (a.pop > 1.2 ? 1.1 : 1);
  const near = S.reports.filter(r => r.id === a.id && Math.abs(r.h - h) <= 1);
  const same = near.filter(r => r.ds === day.ds), hist = near.filter(r => r.ds !== day.ds && parseDate(r.ds).getDay() === day.date.getDay());
  const avg = l => l.reduce((s, r) => s + r.min, 0) / l.length;
  if (same.length) m += .6 * (avg(same) - m); else if (hist.length) m += .3 * (avg(hist) - m);   // ваши отметки уточняют модель
  return clamp(Math.round(m / 5) * 5, 0, 100);
}
const waitRange = (a, day, h) => { const w = waitFor(a, day, h), s = dayConf(day).s; return [Math.max(0, w - s), w + s]; };
// типовые ограничения эксплуатации (ПРЕДПОЛОЖЕНИЕ, уточняйте в парке)
function closedReason(a, w) {
  const k = WX(w.code).k;
  if (k === 'storm') return 'гроза';
  if (a.type === 'extreme' && w.wind >= 15) return 'сильный ветер';
  if (a.type === 'extreme' && w.t < -15) return 'мороз';
  return '';
}
function bestHourFor(a, day) {
  let best = null;
  for (let h = OPEN_H; h <= 19; h++) { const l = attLoad(a, day, h); if (!best || l < best.l) best = { h, l }; }
  return best;
}
const selDay = () => UI.days.find(d => d.ds === UI.dateStr) || UI.days[0];

/* ================= сцена: динамическая картинка ================= */
const Scene = (() => {
  const cv = $('#sceneFx'), ctx = cv.getContext('2d');
  let kind = 'clear', night = false, parts = [], W = 0, H = 0, raf = 0;
  const resize = () => { W = cv.width = cv.clientWidth * devicePixelRatio; H = cv.height = cv.clientHeight * devicePixelRatio; seed(); };
  const seed = () => {
    const n = kind === 'rain' ? 220 : kind === 'storm' ? 320 : kind === 'snow' ? 140 : night ? 90 : 0;
    parts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, v: .6 + Math.random(), r: Math.random() }));
  };
  const tick = t => {
    ctx.clearRect(0, 0, W, H);
    const dpr = devicePixelRatio;
    if (kind === 'rain' || kind === 'storm') {
      ctx.strokeStyle = 'rgba(190,220,255,.55)'; ctx.lineWidth = 1.4 * dpr; ctx.beginPath();
      for (const p of parts) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 4 * dpr, p.y + 16 * dpr * p.v); p.y += 16 * dpr * p.v; p.x -= 3 * dpr * p.v; if (p.y > H) { p.y = -20; p.x = Math.random() * (W + 80 * dpr); } }
      ctx.stroke();
      if (kind === 'storm' && Math.random() < .004) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, 0, W, H); }
    } else if (kind === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.88)';
      for (const p of parts) { ctx.beginPath(); ctx.arc(p.x, p.y, (1.5 + p.r * 2.5) * dpr, 0, 7); ctx.fill(); p.y += 1.1 * dpr * p.v; p.x += Math.sin(t / 900 + p.r * 9) * .6 * dpr; if (p.y > H) { p.y = -8; p.x = Math.random() * W; } }
    } else if (night) {
      for (const p of parts) { ctx.fillStyle = `rgba(255,255,255,${.35 + .5 * Math.abs(Math.sin(t / 700 + p.r * 20))})`; ctx.fillRect(p.x, p.y * .6, (1 + p.r * 1.6) * dpr, (1 + p.r * 1.6) * dpr); }
    }
    raf = requestAnimationFrame(tick);
  };
  addEventListener('resize', resize);
  const photo = ATT.find(a => a.name === 'Колесо Обозрения') || ATT[0];
  if (photo) $('#scenePhoto').style.backgroundImage = `url("${photo.img}")`;
  resize(); raf = requestAnimationFrame(tick);

  return {
    set(code, hour, date, tempC) {
      const k = WX(code).k;
      const dayNow = isDay(date, hour);
      kind = k === 'rain' || k === 'storm' || k === 'snow' ? k : 'clear';
      night = !dayNow;
      seed();
      const photoEl = $('#scenePhoto'), sky = $('#sceneSky'), sun = $('#sceneSun'), cl = $('#sceneClouds');
      const gray = { clear: 0, partly: .25, cloud: .55, fog: .5, rain: .7, snow: .55, storm: .85 }[k];
      photoEl.style.filter = `saturate(${1 - gray * .55}) brightness(${night ? .45 : 1 - gray * .28}) ${k === 'fog' ? 'blur(2px)' : ''}`;
      sky.style.background = night ? 'linear-gradient(#0e1038cc,#1c1b5acc)' :
        k === 'clear' ? 'linear-gradient(#ffd98a55,#ffffff00)' :
        k === 'storm' ? 'linear-gradient(#4a4a68,#7a7f98)' :
        k === 'rain' ? 'linear-gradient(#8d98b0,#b4bccd)' : k === 'snow' ? 'linear-gradient(#aab6cf,#dfe6f2)' : 'linear-gradient(#c3c9d6,#e3e6ee)';
      sun.className = 'sun' + (night ? ' moon on' : (k === 'clear' || k === 'partly') ? ' on' : '');
      cl.style.opacity = night ? .25 : ({ clear: 0, partly: .75, cloud: 1, fog: .6, rain: 1, snow: 1, storm: 1 }[k]);
      cl.style.setProperty('--c', k === 'storm' ? 'rgba(60,60,85,.9)' : k === 'rain' ? 'rgba(120,130,150,.85)' : 'rgba(255,255,255,.8)');
      $('#sceneClouds').style.setProperty('--c', k === 'storm' ? 'rgba(60,60,85,.9)' : k === 'rain' ? 'rgba(120,130,150,.85)' : night ? 'rgba(150,160,210,.5)' : 'rgba(255,255,255,.8)');
    }
  };
})();

/* ================= отрисовка: hero ================= */
function renderHero() {
  const day = selDay(), h = UI.hour, w = wxAt(day, h), W = WX(w.code), L = day.hours.find(x => x.h === h)?.load ?? 40;
  $('#heroWhen').textContent = `${longDate(day.date)} · ${pad(h)}:00`;
  const rainy = ['rain', 'storm', 'snow'].includes(W.k);
  $('#heroTitle').textContent = `${W.i} ${Math.round(w.t)}°, ${W.t}` + (rainy ? `: ${W.k === 'snow' ? 'снег' : 'дождь'} в ${pad(h)}:00` : '');
  const bestH = day.bestH;
  $('#heroSub').textContent = day.src === 'forecast'
    ? `В парке будет ${qName(L)}. Самое спокойное время дня — ${pad(bestH.h)}:00.`
    : `Это климатический ориентир, до даты ещё далеко. Обычно в такой день: ${Math.round(day.tmin)}…${Math.round(day.tmax)}°, осадки в ${day.pr}% дней.`;
  const m = coinMult(L);
  $('#heroChips').innerHTML = [
    `<span class="chip">🌡️ <b>${Math.round(w.t)}°</b> ощущается спокойно</span>`.replace('ощущается спокойно', 'в ' + pad(h) + ':00'),
    `<span class="chip">☔ осадки <b>${Math.round(w.p)}%</b></span>`,
    `<span class="chip">💨 ветер <b>${Math.round(w.wind)} м/с</b></span>`,
    `<span class="chip q${qLevel(L)}">👥 загрузка <b>${qName(L)}</b> · ожидание ~${waitMin(L, 1.3)} мин</span>`,
    `<span class="chip">💰 монеты <b>×${m}</b></span>`
  ].join('');
  Scene.set(w.code, h, day.date, w.t);
  say(autoLine());
}

/* ================= Кот Баюн ================= */
let sayTimer;
function say(text) {
  const b = $('#bubble'); b.textContent = text;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
}
function autoLine() {
  const day = selDay(), h = UI.hour, w = wxAt(day, h), W = WX(w.code);
  const L = day.hours.find(x => x.h === h)?.load ?? 40;
  if (UI.user && UI.user.dist <= RADIUS_M) return `Мяу! Вы уже в Сказке. Сейчас ${qName(L)}, монеты ×${coinMult(L)} — самое время отметиться на аттракционе.`;
  if (['rain', 'storm'].includes(W.k)) return `В ${pad(h)}:00 дождь (${Math.round(w.p)}%). Могу собрать «сухой» маршрут: лабиринты и дома — нажмите «А если дождь?».`;
  if (W.k === 'snow') return 'Снежок! Оденьтесь потеплее: колесо обозрения и хаски в снегу — отдельная сказка.';
  if (L < 25) return `В ${pad(h)}:00 тихо — очередей почти нет, а монеты ×${coinMult(L)}. Отличное окно!`;
  if (L >= 75) return `В ${pad(h)}:00 людно (ожидание у хитов ~${waitMin(L, 1.5)} мин). Сдвиньте визит на ${pad(day.bestH.h)}:00 — получите ×${coinMult(day.bestH.load)} монет.`;
  return `${W.t[0].toUpperCase() + W.t.slice(1)}, ${Math.round(w.t)}°. Лучшее время — ${pad(day.bestH.h)}:00. Крутите ползунок: покажу, как меняется погода и очереди.`;
}
function answer(q) {
  const day = selDay(), minH = Math.min(...S.family.map(f => f.h));
  const by = (arr, f) => arr.filter(f);
  const names = arr => arr.slice(0, 4).map(a => a.name.replace(/[«»]/g, '')).join(', ');
  const quiet = day.hours.filter(x => qLevel(x.load) <= 2).map(x => pad(x.h) + ':00');
  if (q === 'when') return say(`${longDate(day.date)}: лучше всего в ${pad(day.bestH.h)}:00 (${qName(day.bestH.load)}, монеты ×${coinMult(day.bestH.load)}). ${quiet.length ? 'Комфортные окна: ' + quiet.slice(0, 5).join(', ') + '.' : 'В этот день тихих окон мало — попробуйте будни.'}`);
  if (q === 'rain') {
    const dry = by(ATT, a => a.type === 'interactive').map(a => a.name);
    S.mood = 'calm'; renderRoute(true);
    return say(`В дождь выбирайте интерактив: ${names(ATT.filter(a => a.type === 'interactive'))}. Уточняйте на месте, что закрыто. Дождь ещё и разгружает парк — монет больше!`);
  }
  if (q === 'kids') return say(`С ростом ${minH} см доступно ${by(ATT, a => minH >= a.hmin && minH <= a.hmax && ['kids', 'family', 'zone'].includes(a.type)).length} спокойных мест: ${names(by(ATT, a => minH >= a.hmin && ['kids', 'family'].includes(a.type)))}.`);
  if (q === 'thrill') {
    const ex = by(ATT, a => a.type === 'extreme' && minH >= a.hmin);
    return say(ex.length ? `По вашему минимальному росту доступны: ${names(ex.sort((a, b) => b.pop - a.pop))}. Лучше — утром, пока тихо.` : `Для экстрима нужен рост от 105 см (Звездопад, Ракета), от 120 см — большинство, от 140 — Смерч и Галактика. Пока посмотрите на колесо обозрения!`);
  }
  if (q === 'quiet') return say(`Тихие места — зоны с животными и динозаврами: ${names(ATT.filter(a => a.type === 'zone'))}. В ${pad(day.bestH.h)}:00 везде спокойно.`);
}
$('#ask').addEventListener('click', e => { const q = e.target.dataset?.q; if (q) answer(q); });

/* ================= календарь ================= */
function renderCalendar() {
  const cal = $('#calendar'); cal.innerHTML = '';
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(d => cal.insertAdjacentHTML('beforeend', `<div class="cal-dow">${d}</div>`));
  const first = UI.days[0], lead = (first.date.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) cal.insertAdjacentHTML('beforeend', '<div class="cal-day empty"></div>');
  UI.days.forEach(d => {
    const W = WX(d.code);
    const el = document.createElement('button');
    el.className = `cal-day q${d.q} ${d.src === 'climate' ? 'clim' : ''} ${d.ds === UI.dateStr ? 'sel' : ''}`;
    el.dataset.ds = d.ds;
    el.setAttribute('aria-label', `${longDate(d.date)}, ${W.t}, ${Math.round(d.tmax)} градусов, загрузка ${qName(d.bestH.load)}`);
    el.innerHTML = `${d.hol ? '<span class="hol" title="' + esc(d.hol) + '">🎉</span>' : ''}<span class="n">${d.date.getDate()}${d.date.getDate() === 1 || d === first ? ' <small>' + MONTHS[d.date.getMonth()].slice(0, 3) + '</small>' : ''}</span><span class="ic">${W.i}</span><span class="t">${Math.round(d.tmax)}°/${Math.round(d.tmin)}°</span><span class="r">☔${Math.round(d.pr)}%</span>`;
    el.addEventListener('click', () => selectDay(d.ds));
    cal.appendChild(el);
  });
}
function selectDay(ds) {
  UI.dateStr = ds;
  $$('.cal-day').forEach(e => e.classList.toggle('sel', e.dataset.ds === ds));
  renderDetail(); renderHero(); renderRoute(); renderCheckinNow(); renderCatalog();
}

function renderDetail() {
  const d = selDay();
  $('#ddTitle').textContent = longDate(d.date) + (d.hol ? ` · ${d.hol}` : '');
  const tag = $('#ddSrc'); tag.textContent = d.src === 'forecast' ? 'Прогноз по часам' : 'Климат за 11 лет, не прогноз'; tag.className = 'tag ' + (d.src === 'forecast' ? 'fc' : 'cl');
  const b = d.bestH, wb = wxAt(d, b.h);
  $('#ddBest').innerHTML = `⭐ Лучшее время — <b>${pad(b.h)}:00</b>: ${WX(wb.code).i} ${Math.round(wb.t)}°, ${qName(b.load)}, монеты <b>×${coinMult(b.load)}</b>.` +
    (d.src === 'climate' ? ' Часовой прогноз появится за 16 дней до даты.' : '') + ` <span class="fineprint">Точность оценки очереди: ${dayConf(d).n} (±${dayConf(d).s} мин).${isBreak(d.ds) ? ' Возможны каникулы (предположение) — людей больше.' : ''}</span>`;
  $('#hours').innerHTML = d.hours.map(x => {
    const w = wxAt(d, x.h), W = WX(w.code);
    return `<button class="hr q${qLevel(x.load)} ${x.h === UI.hour ? 'sel' : ''} ${x.h === b.h ? 'best' : ''}" data-h="${x.h}" aria-label="${pad(x.h)}:00, ${W.t}, ${qName(x.load)}">
      <div class="h">${pad(x.h)}:00</div><div class="ic">${W.i}</div><div class="t">${Math.round(w.t)}°</div><div class="p">☔ ${Math.round(w.p)}%</div>
      <div class="bar"><i style="width:${x.load}%"></i></div><div class="m">${qName(x.load)} · хиты ~${waitMin(x.load, 1.3)} мин</div><div class="x">💰 ×${coinMult(x.load)}</div></button>`;
  }).join('');
}
$('#hours').addEventListener('click', e => { const b = e.target.closest('.hr'); if (b) setHour(+b.dataset.h); });
function setHour(h) {
  scheduleCatalog();
  UI.hour = clamp(h, OPEN_H, CLOSE_H - 1);
  $('#hourSlider').value = UI.hour; $('#hourLabel').textContent = pad(UI.hour) + ':00';
  $$('.hr').forEach(e => e.classList.toggle('sel', +e.dataset.h === UI.hour));
  renderHero(); renderCheckinNow();
}
$('#hourSlider').addEventListener('input', e => setHour(+e.target.value));

/* ================= семья и маршрут ================= */
function renderFamily() {
  $('#familyList').innerHTML = S.family.map((f, i) => `<span class="member">${f.h < 140 ? '🧒' : '🧑'} ${esc(f.name)} · ${f.h} см <button data-i="${i}" aria-label="Убрать ${esc(f.name)}">×</button></span>`).join('') || '<span class="fineprint">Добавьте хотя бы одного человека.</span>';
  $('#fMood').value = S.mood;
}
$('#familyList').addEventListener('click', e => { const i = e.target.dataset?.i; if (i == null) return; S.family.splice(+i, 1); save(); renderFamily(); renderRoute(); renderCatalog(); });
$('#familyForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#fName').value.trim(), h = +$('#fHeight').value;
  if (!name || !h) return;
  S.family.push({ name, h }); save(); e.target.reset(); renderFamily(); renderRoute(); renderCatalog();
});
$('#fMood').addEventListener('change', e => { S.mood = e.target.value; save(); renderRoute(); });

function buildRoute() {
  const day = selDay();
  if (!S.family.length) return { stops: [], pool: 0 };
  const minH = Math.min(...S.family.map(f => f.h)), maxH = Math.max(...S.family.map(f => f.h));
  const okFor = a => minH >= a.hmin && maxH <= a.hmax + 40;       // у взрослых запас
  const moodW = { mix: { extreme: 1, kids: 1, family: 1, interactive: 1, zone: 1 }, thrill: { extreme: 2.2, kids: .3, family: .8, interactive: 1, zone: .6 }, calm: { extreme: .1, kids: 1.8, family: 1.4, interactive: 1.2, zone: 1.2 }, animals: { extreme: .4, kids: .8, family: .7, interactive: .8, zone: 2.6 } }[S.mood];
  const rainy = day.hours.some(x => ['rain', 'storm', 'snow'].includes(WX(wxAt(day, x.h).code).k)) && day.pr >= 55;
  let pool = ATT.filter(okFor).filter(a => a.name !== 'ТИР' && a.name !== 'Верёвочный парк');
  if (!pool.length) return { stops: [], pool: 0, minH };
  const score = a => a.pop * moodW[a.type] * (rainy && a.type === 'interactive' ? 1.8 : 1) * (0.85 + (a.id * 7 % 10) / 33);
  const slots = day.hours.filter(x => x.h !== 13 && x.h < 21);     // 13:00 — обед
  const n = clamp(Math.round(slots.length * .62), 6, 8);
  const top = pool.sort((a, b) => score(b) - score(a)).slice(0, n);
  // самые популярные — первыми выбирают свой самый тихий час (с учётом типа аттракциона)
  const free = [...slots], stops = [];
  [...top].sort((a, b) => b.pop - a.pop).forEach(a => {
    free.sort((x, y) => attLoad(a, day, x.h) - attLoad(a, day, y.h));
    const s = free.shift(); stops.push({ h: s.h, load: s.load, a });
  });
  stops.sort((a, b) => a.h - b.h);
  return { stops, pool: pool.length, minH, rainy };
}
function renderRoute(fromCat) {
  const R = buildRoute(), day = selDay();
  const sum = $('#routeSummary'), list = $('#routeList');
  if (!R.stops.length) { sum.innerHTML = 'Для такого роста подходящих аттракционов не нашлось — проверьте рост участников.'; list.innerHTML = ''; return; }
  const total = R.stops.reduce((s, x) => s + 20 * coinMult(x.load), 0), wait = R.stops.reduce((s, x) => s + waitFor(x.a, day, x.h), 0);
  sum.innerHTML = `<b>${longDate(day.date)}</b> · подходит ${R.pool} мест для роста от ${R.minH} см. В маршруте ${R.stops.length} остановок, суммарное ожидание ~${wait} мин, потенциал до <b>${Math.round(total)} 💰</b>.` +
    (R.rainy ? ' ☔ Ожидается дождь — подтянул интерактив.' : '');
  let html = '';
  R.stops.forEach((s, i) => {
    if (i && R.stops[i - 1].h < 13 && s.h > 13) html += `<li class="break">🍽️ 13:00 — обед (кафе «Базилик», «Блинная», фуд-корты)</li>`;
    const w = wxAt(day, s.h), a = s.a;
    html += `<li class="stop"><img loading="lazy" referrerpolicy="no-referrer" src="${a.img}" alt="${esc(a.name)}">
      <div class="stop-body"><div class="stop-time"><b>${pad(s.h)}:00</b> ${WX(w.code).i} ${Math.round(w.t)}° · ${TYPE_EMOJI[a.type]} ${TYPE_RU[a.type]}</div>
      <h4>${esc(a.name)}</h4><p>${esc(a.desc)}</p>
      <div class="badges"><span class="badge">рост ${a.hmin ? 'от ' + a.hmin : 'любой'}${a.hmax < 250 ? ' до ' + a.hmax : ''} см</span><span class="badge">ожидание ~${waitFor(a, day, s.h)} мин</span><span class="badge ${coinMult(s.load) > 1.5 ? 'gold' : ''}">💰 ×${coinMult(s.load)} (${qName(s.load)})</span></div></div></li>`;
  });
  list.innerHTML = html;
  if (fromCat) say(`Собрал сухой маршрут: смотрите блок «Мой маршрут» — подтянул интерактив.`);
}

/* ================= каталог аттракционов ================= */
const CAT = { who: 'family', h: 120, type: 'all', q: '', sort: 'hit', only: true };
let catRaf = 0;
const scheduleCatalog = () => { cancelAnimationFrame(catRaf); catRaf = requestAnimationFrame(() => renderCatalog(true)); };
function catHeights() {
  if (CAT.who === 'family') return S.family.length ? S.family.map(f => f.h) : [CAT.h];
  if (CAT.who === 'custom') return [CAT.h];
  const m = S.family[+CAT.who]; return [m ? m.h : CAT.h];
}
// подходит ли аттракцион по росту: у взрослых запас сверху, у детей — строгое ограничение
function fit(a, heights) {
  const low = Math.min(...heights);
  if (low < a.hmin) return { ok: false, why: `ещё ${a.hmin - low} см до минимума`, kind: 'short' };
  if (heights.every(x => x > a.hmax)) return { ok: false, why: `выше максимума (${a.hmax} см)`, kind: 'tall' };
  const over = heights.filter(x => x > a.hmax).length;
  return { ok: true, why: over ? `${over} чел. выше ${a.hmax} см — смотрят со стороны` : 'подходит', kind: over ? 'partial' : 'ok' };
}
function renderCatalogControls() {
  const sel = $('#catWho'), cur = CAT.who;
  sel.innerHTML = `<option value="family">Вся семья${S.family.length ? ' (' + Math.min(...S.family.map(f => f.h)) + '–' + Math.max(...S.family.map(f => f.h)) + ' см)' : ''}</option>` +
    S.family.map((f, i) => `<option value="${i}">${esc(f.name)} · ${f.h} см</option>`).join('') + '<option value="custom">Свой рост…</option>';
  sel.value = [...sel.options].some(o => o.value === String(cur)) ? cur : 'family'; CAT.who = sel.value;
  $('#catH').closest('.field').style.display = CAT.who === 'custom' ? '' : 'none';
}
function renderCatalog(soft) {
  if (!UI.days.length) return;
  if (!soft) renderCatalogControls();
  const day = selDay(), h = UI.hour, hs = catHeights(), conf = dayConf(day), w = wxAt(day, h);
  let list = ATT.map(a => ({ a, f: fit(a, hs), wait: waitFor(a, day, h), best: bestHourFor(a, day), closed: closedReason(a, w) }));
  if (CAT.type !== 'all') list = list.filter(x => x.a.type === CAT.type);
  if (CAT.q) list = list.filter(x => x.a.name.toLowerCase().includes(CAT.q.toLowerCase()));
  const total = list.length;
  if (CAT.only) list = list.filter(x => x.f.ok);
  const sorters = { hit: (x, y) => y.a.pop - x.a.pop, wait: (x, y) => x.wait - y.wait, height: (x, y) => x.a.hmin - y.a.hmin, name: (x, y) => x.a.name.localeCompare(y.a.name, 'ru') };
  list.sort(sorters[CAT.sort]);
  const okCount = ATT.filter(a => fit(a, hs).ok).length;
  $('#catCount').innerHTML = `Показано <b>${list.length}</b> из ${total}${CAT.only ? ' (неподходящие по росту скрыты)' : ''}. Всего подходит по росту: <b>${okCount}</b> из ${ATT.length}. Ожидание — на ${longDate(day.date)}, ${pad(h)}:00 (точность: ${conf.n}).`;
  $('#catGrid').innerHTML = list.map(({ a, f, wait, best, closed }) => {
    const L = attLoad(a, day, h), r = waitRange(a, day, h);
    return `<article class="ac ${f.ok ? '' : 'no'}">
      <div class="ac-img"><img loading="lazy" referrerpolicy="no-referrer" src="${a.img}" alt="${esc(a.name)}"><span class="ac-type">${TYPE_EMOJI[a.type]} ${TYPE_RU[a.type]}</span></div>
      <div class="ac-body">
        <h4>${esc(a.name)}</h4>
        <div class="ac-fit ${f.kind}">${f.kind === 'ok' ? '✅' : f.kind === 'partial' ? '👀' : '⛔'} ${f.ok ? 'Подходит' : 'Не подходит'} · ${esc(f.why)}</div>
        <p>${esc(a.desc)}</p>
        <div class="badges">
          <span class="badge">рост ${a.hmin ? 'от ' + a.hmin : 'любой'}${a.hmax < 250 ? ' до ' + a.hmax : ''} см</span>
          ${a.priceFrom ? `<span class="badge">от ${a.priceFrom} ₽</span>` : ''}
          <span class="badge w q${qLevel(L)}" title="Диапазон ${r[0]}–${r[1]} мин">⏱ ~${wait} мин</span>
          <span class="badge">лучше в ${pad(best.h)}:00 (~${waitFor(a, day, best.h)} мин)</span>
          ${closed ? `<span class="badge warn">⚠ может не работать: ${closed}</span>` : ''}
        </div>
        <button class="btn small ghost" data-ci="${a.id}">Отметиться</button>
      </div></article>`;
  }).join('') || '<p class="fineprint">Ничего не найдено — уберите фильтры или измените рост.</p>';
}
function initCatalog() {
  CAT.h = Math.min(...S.family.map(f => f.h), 120);
  $('#catH').value = CAT.h;
  $('#catWho').addEventListener('change', e => { CAT.who = e.target.value; renderCatalog(); });
  $('#catH').addEventListener('input', e => { CAT.h = clamp(+e.target.value || 0, 0, 220); renderCatalog(true); });
  $$('.hchips button').forEach(b => b.addEventListener('click', () => { CAT.who = 'custom'; CAT.h = +b.dataset.h; $('#catH').value = CAT.h; renderCatalog(); }));
  $('#catTypes').addEventListener('click', e => { const t = e.target.dataset?.t; if (!t) return; CAT.type = t; $$('#catTypes button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); renderCatalog(true); });
  $('#catQ').addEventListener('input', e => { CAT.q = e.target.value.trim(); renderCatalog(true); });
  $('#catSort').addEventListener('change', e => { CAT.sort = e.target.value; renderCatalog(true); });
  $('#catOnly').addEventListener('change', e => { CAT.only = e.target.checked; renderCatalog(true); });
  $('#catGrid').addEventListener('click', e => {
    const id = e.target.dataset?.ci; if (!id) return;
    $('#ciPick').value = id; renderCheckinNow(); $('#quest').scrollIntoView({ behavior: 'smooth' }); toast('Аттракцион выбран — нажмите «Я здесь!»');
  });
}

/* ================= карта и геолокация ================= */
function haversine(a, b, c, d) { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(c - a), dLo = r(d - b); const x = Math.sin(dLa / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function initMap() {
  if (!window.L) { $('#leaflet').innerHTML = '<p style="padding:20px">Карта не загрузилась (нет доступа к cdnjs).</p>'; return; }
  const map = L.map('leaflet', { scrollWheelZoom: false }).setView([PARK.lat, PARK.lon], 16);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Imagery' });
  sat.addTo(map);
  L.control.layers({ 'Спутник': sat, 'Схема': osm }, null, { collapsed: false }).addTo(map);
  L.circle([PARK.lat, PARK.lon], { radius: RADIUS_M, color: '#f5b83d', weight: 2, fillOpacity: .08 }).addTo(map);
  const icon = L.divIcon({ html: '<div style="font-size:34px;filter:drop-shadow(0 2px 4px #0008)">🎡</div>', className: '', iconSize: [34, 34], iconAnchor: [17, 30] });
  L.marker([PARK.lat, PARK.lon], { icon }).addTo(map).bindPopup(`<b>${PARK.name}</b><br>${PARK.addr}`).openPopup();
  UI.map = map;
}
function updateGis() {
  const to = `${PARK.lon}%2C${PARK.lat}`;
  $('#gis').href = `https://2gis.ru/moscow?m=${to}%2F16`;
  $('#gisRoute').href = UI.user
    ? `https://2gis.ru/moscow/directions/points/${UI.user.lon}%2C${UI.user.lat}%7C${to}`
    : `https://2gis.ru/moscow/directions/points/%7C${to}`;
}
function onPosition(p) {
  const { latitude: lat, longitude: lon, accuracy } = p.coords;
  const dist = haversine(lat, lon, PARK.lat, PARK.lon);
  UI.user = { lat, lon, dist, accuracy };
  const km = dist / 1000, inPark = dist <= RADIUS_M;
  $('#geoStatus').innerHTML = inPark
    ? `✅ Вы в парке (в ${Math.round(dist)} м от центра). Можно отмечаться на аттракционах!`
    : `До парка <b>${km < 10 ? km.toFixed(1) : Math.round(km)} км</b>. Пешком ~${Math.round(km / 4.8 * 60)} мин, на авто ~${Math.max(5, Math.round(km / 24 * 60))} мин (оценка без пробок).`;
  if (UI.map) {
    if (UI.userMarker) UI.userMarker.setLatLng([lat, lon]); else UI.userMarker = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1 }).addTo(UI.map).bindPopup('Вы здесь');
    if (!inPark) UI.map.fitBounds([[lat, lon], [PARK.lat, PARK.lon]], { padding: [40, 40], maxZoom: 16 });
  }
  updateGis(); renderCheckinNow(); say(autoLine());
}
$('#geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { $('#geoStatus').textContent = 'Браузер не поддерживает геолокацию.'; return; }
  $('#geoStatus').textContent = 'Определяю положение…';
  if (UI.watch) navigator.geolocation.clearWatch(UI.watch);
  UI.watch = navigator.geolocation.watchPosition(onPosition, err => {
    $('#geoStatus').textContent = err.code === 1 ? 'Доступ к геолокации запрещён. Разрешите его в браузере или включите демо-режим ниже.' : 'Не удалось определить положение. Попробуйте ещё раз или включите демо-режим.';
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
});
$('#radiusLbl').textContent = RADIUS_M;

/* ================= квесты, монеты, уровни ================= */
const LEVELS = [
  { xp: 0, name: 'Путник', e: '🥾' }, { xp: 150, name: 'Следопыт', e: '🧭' }, { xp: 400, name: 'Богатырь', e: '🛡️' },
  { xp: 800, name: 'Царевич', e: '👑' }, { xp: 1500, name: 'Хранитель Сказки', e: '🔮' }
];
const levelOf = xp => { let i = 0; LEVELS.forEach((l, k) => { if (xp >= l.xp) i = k; }); return i; };
const typeCount = (t, list = S.checkins) => new Set(list.filter(c => ATT.find(a => a.id === c.id)?.type === t).map(c => c.id)).size;
const CHALLENGES = [
  { id: 'first', e: '✨', name: 'Первая сказка', d: 'Отметьтесь на любом аттракционе', goal: 1, val: () => S.checkins.length, coins: 30 },
  { id: 'kids3', e: '🎠', name: 'Малышам — карусельный круг', d: '3 детских аттракциона', goal: 3, val: () => typeCount('kids'), coins: 60 },
  { id: 'ext2', e: '🎢', name: 'Адреналиновая семья', d: '2 экстремальных аттракциона', goal: 2, val: () => typeCount('extreme'), coins: 80 },
  { id: 'zoo3', e: '🦙', name: 'Друзья животных', d: '3 тематических зоны (альпаки, страусы, хаски…)', goal: 3, val: () => typeCount('zone'), coins: 90 },
  { id: 'dino', e: '🦖', name: 'Дино-экспедиция', d: 'Дино парк и Дино сафари', goal: 2, val: () => ['Дино парк', 'Дино сафари'].filter(n => S.checkins.some(c => ATT.find(a => a.id === c.id)?.name === n)).length, coins: 100 },
  { id: 'fear', e: '👻', name: 'Смелые сердца', d: '2 интерактива (лабиринты, Дом Страха)', goal: 2, val: () => typeCount('interactive'), coins: 70 },
  { id: 'early', e: '🌅', name: 'Ранняя пташка', d: 'Отметка до 11:00', goal: 1, val: () => S.checkins.filter(c => c.h < 11).length, coins: 50 },
  { id: 'anti', e: '🤫', name: 'Антиочередь', d: '3 отметки в «тихие» часы (загрузка ниже 35%)', goal: 3, val: () => S.checkins.filter(c => c.load < 35).length, coins: 120 },
  { id: 'rain', e: '☔', name: 'Дождь не помеха', d: 'Отметка в дождь или снег', goal: 1, val: () => S.checkins.filter(c => ['rain', 'storm', 'snow'].includes(c.wk)).length, coins: 80 },
  { id: 'all', e: '🌈', name: 'Весь день в Сказке', d: 'Отметки в 3 разных частях дня', goal: 3, val: () => new Set(S.checkins.map(c => c.h < 13 ? 'a' : c.h < 17 ? 'b' : 'c')).size, coins: 100 }
];
const REWARDS = [
  { id: 'tea', e: '🍵', name: 'Горячий чай в подарок', cost: 120, code: 'BAYUN-TEA' },
  { id: 'photo', e: '📸', name: 'Скидка 10% на фото-зону', cost: 200, code: 'BAYUN-FOTO' },
  { id: 'ride', e: '🎟️', name: 'Бонусный билет на карусель', cost: 350, code: 'BAYUN-RIDE' },
  { id: 'cat', e: '🐈', name: 'Значок «Друг Кота Баюна»', cost: 500, code: 'BAYUN-BADGE' }
];
function toast(msg, gold) { const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (gold ? ' gold' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 3200); }

function renderQuest() {
  const li = levelOf(S.xp), cur = LEVELS[li], nxt = LEVELS[li + 1];
  const pct = nxt ? Math.round((S.xp - cur.xp) / (nxt.xp - cur.xp) * 100) : 100;
  $('#levelCard').innerHTML = `<div class="lv-badge">${cur.e}</div><div><div class="lv-name">${cur.name}</div><div class="lv-bar"><i style="width:${pct}%"></i></div><small>${nxt ? `${S.xp} / ${nxt.xp} опыта до «${nxt.name}»` : 'Максимальный уровень!'}</small></div><div class="lv-coins">💰 ${S.coins}</div>`;
  $('#coinsTop').textContent = S.coins;
  $('#challenges').innerHTML = CHALLENGES.map(c => {
    const v = Math.min(c.val(), c.goal), done = !!S.done[c.id];
    return `<div class="chl ${done ? 'done' : ''}"><div class="e">${done ? '✅' : c.e}</div><div><b>${c.name}</b><small>${c.d}</small><div class="mini"><i style="width:${v / c.goal * 100}%"></i></div></div><div class="pr">${v}/${c.goal}<br>+${c.coins} 💰</div></div>`;
  }).join('');
  $('#rewards').innerHTML = REWARDS.map(r => S.rewards[r.id]
    ? `<div class="rw owned"><span>${r.e} ${r.name}</span><code>${r.code}</code></div>`
    : `<div class="rw"><span>${r.e} ${r.name}</span><button class="btn" data-r="${r.id}" ${S.coins < r.cost ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>${r.cost} 💰</button></div>`).join('');
  $('#demoMode').checked = S.demo;
}
$('#rewards').addEventListener('click', e => {
  const id = e.target.dataset?.r; const r = REWARDS.find(x => x.id === id);
  if (!r || S.coins < r.cost) return;
  S.coins -= r.cost; S.rewards[id] = 1; save(); renderQuest(); toast(`Награда получена: ${r.name}`, true); say('Мур! Теперь вы — друг Кота Баюна.');
});
$('#demoMode').addEventListener('change', e => { S.demo = e.target.checked; save(); renderCheckinNow(); });
$('#resetBtn').addEventListener('click', () => { if (confirm('Сбросить монеты, уровень и отметки?')) { S = defaults(); save(); renderAll(); toast('Прогресс сброшен'); } });

function fillCheckinPick() {
  const groups = Object.keys(TYPE_RU);
  $('#ciPick').innerHTML = groups.map(g => `<optgroup label="${TYPE_RU[g]}">${ATT.filter(a => a.type === g).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</optgroup>`).join('');
}
function checkinTime() {
  if (S.demo) return { day: selDay(), h: UI.hour };
  const now = new Date(), ds = fmtDate(now), d = UI.days.find(x => x.ds === ds) || UI.days[0];
  return { day: d, h: clamp(now.getHours(), OPEN_H, CLOSE_H - 1) };
}
function renderCheckinNow() {
  if (!UI.days.length) return;
  const { day, h } = checkinTime(), L = day.hours.find(x => x.h === h)?.load ?? 50, a = ATT.find(x => x.id === +$('#ciPick').value);
  const where = S.demo ? 'демо: выбранное время' : UI.user ? (UI.user.dist <= RADIUS_M ? 'вы в парке ✅' : `вы в ${(UI.user.dist / 1000).toFixed(1)} км от парка`) : 'положение не определено';
  $('#ciNow').innerHTML = `Сейчас (${where}): <b>${qName(L)}</b>, ожидание ~${a ? waitFor(a, day, h) : '—'} мин. За отметку: <b class="x">+${Math.round(20 * coinMult(L))} 💰</b> (×${coinMult(L)} за ${qName(L)} час).`;
}
$('#ciPick').addEventListener('change', renderCheckinNow);
$('#ciBtn').addEventListener('click', () => {
  const a = ATT.find(x => x.id === +$('#ciPick').value); if (!a) return;
  if (!S.demo) {
    if (!UI.user) { toast('Сначала определите положение (блок «Карта») или включите демо-режим'); return; }
    if (UI.user.dist > RADIUS_M) { toast(`Вы в ${(UI.user.dist / 1000).toFixed(1)} км от парка. Отметка работает в радиусе ${RADIUS_M} м`); return; }
  }
  const { day, h } = checkinTime(), L = day.hours.find(x => x.h === h)?.load ?? 50;
  if (S.checkins.some(c => c.id === a.id && c.ds === day.ds)) { toast('На этом аттракционе вы сегодня уже отмечались'); return; }
  const mult = coinMult(L), base = 20 + (a.type === 'extreme' ? 10 : 0), gain = Math.round(base * mult);
  const wk = WX(wxAt(day, h).code).k;
  S.checkins.push({ id: a.id, ds: day.ds, h, load: L, wk, ts: Date.now() });
  S.coins += gain; S.xp += Math.round(gain * 1.2);
  const before = levelOf(S.xp - Math.round(gain * 1.2));
  let msg = `+${gain} 💰 за «${a.name}»` + (mult > 1 ? ` (×${mult}, ${qName(L)})` : '');
  CHALLENGES.forEach(c => { if (!S.done[c.id] && c.val() >= c.goal) { S.done[c.id] = Date.now(); S.coins += c.coins; S.xp += c.coins; msg += ` · 🏆 «${c.name}» +${c.coins}`; } });
  save(); renderQuest(); renderCheckinNow(); toast(msg, true);
  const nl = levelOf(S.xp);
  say(nl > before ? `Мррр! Новый уровень — ${LEVELS[nl].name}! 🎉` : mult >= 2 ? `Умно! Пришли в «${qName(L)}» час — монет ×${mult}.` : `Отметил «${a.name}». ${L >= 75 ? 'Людно — в следующий раз приходите пораньше, монет будет больше.' : 'Так держать!'}`);
});
$('#repBtn').addEventListener('click', () => {
  const m = +$('#repMin').value, a = ATT.find(x => x.id === +$('#ciPick').value);
  if (isNaN(m) || $('#repMin').value === '') { toast('Введите, сколько минут стоите'); return; }
  if (!S.demo && (!UI.user || UI.user.dist > RADIUS_M)) { toast('Сообщать об очереди можно из парка (или в демо-режиме)'); return; }
  const { day, h } = checkinTime();
  S.reports.push({ id: a.id, ds: day.ds, h, min: m }); S.coins += 10; save();
  day.hours = hoursFor(day); day.bestH = bestOf(day.hours); day.q = dayQ(day);
  $('#repMin').value = ''; renderAll(); toast(`Спасибо! Очередь на «${a.name}» учтена · +10 💰`, true);
});

/* ================= запуск ================= */
function renderAll() {
  if (!UI.days.length) return;
  renderCalendar(); renderDetail(); renderHero(); renderFamily(); renderRoute(); renderQuest(); renderCheckinNow(); renderCatalog();
}

async function boot() {
  fillCheckinPick(); initCatalog(); updateGis(); initMap(); renderFamily(); renderQuest();
  try {
    const [f, c] = await Promise.allSettled([loadForecast(), loadClimate()]);
    UI.forecast = f.status === 'fulfilled' ? f.value : null;
    UI.climate = c.status === 'fulfilled' ? c.value : null;
    if (!UI.forecast) {
      $('#heroTitle').textContent = 'Не удалось получить погоду';
      $('#heroSub').textContent = 'Проверьте интернет и обновите страницу. Показываю климатический ориентир.';
    }
  } catch (e) { console.error(e); }
  UI.days = buildDays();
  UI.dateStr = UI.days[0].ds;
  const now = new Date();
  UI.hour = clamp(now.getHours() + 1, OPEN_H, CLOSE_H - 1);
  $('#hourSlider').value = UI.hour; $('#hourLabel').textContent = pad(UI.hour) + ':00';
  renderAll();
  if (!UI.climate) toast('Климатические данные недоступны — даль считаю по сезонным средним');
}
$('#hourSlider').addEventListener('input', () => {});
boot();
