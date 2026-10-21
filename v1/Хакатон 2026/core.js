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
const defaults = () => ({
  coins: 0, xp: 0, checkins: [], family: [{ name: 'Малыш', h: 110 }, { name: 'Взрослый', h: 175 }],
  reports: [], demo: true, rewards: {}, quest: {}, chapters: {}, likes: {}, plays: {}, playDay: {}, repairVotes: {}, voteDay: {},
  subs: {}, ops: {}, ideas: [], ideaVotes: {}, seenStatus: {}, badges: {}, op: false, game: null, gameBest: 0
});
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

