/* world.js — «мир парка»: статусы аттракционов, рейтинг любимых, голоса за ремонт, отметки */
'use strict';

const rnd = seed => { let x = (Math.imul(seed, 2654435761) >>> 0) || 1; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const byName = n => ATT.find(a => a.name === n);
const todayStr = () => fmtDate(new Date());

/* ---------- статусы ---------- */
// ДЕМО: плановые ремонты. В боевой версии статус и причину присылает оператор парка (экран «Режим оператора»).
const REPAIRS = [
  ['Шейкер', 'Замена гидроцилиндра привода', 7],
  ['Паук', 'Плановое техническое обслуживание', 3],
  ['Кракен', 'Диагностика системы фиксации пассажиров', 12],
  ['Путь дракона', 'Замена колёс вагонеток', 20],
  ['Дом Страха', 'Обновление декораций и света', 5],
  ['Верёвочный парк', 'Осмотр страховочных тросов', 9]
];
const REPAIR = {};
REPAIRS.forEach(([n, reason, d]) => { const a = byName(n); if (a) REPAIR[a.id] = { reason, eta: addDays(new Date(new Date().setHours(0, 0, 0, 0)), d) }; });
const REPAIR_GOAL = 150;
const ST = {
  ok: { k: 'ok', cls: 'ok', label: 'Работает', dot: '🟢' },
  repair: { k: 'repair', cls: 'bad', label: 'Ремонт', dot: '🔴' },
  service: { k: 'service', cls: 'bad', label: 'Тех. обслуживание', dot: '🔴' },
  weather: { k: 'weather', cls: 'warn', label: 'Погода', dot: '🟡' }
};
const etaText = d => (d instanceof Date ? `вернётся ${d.getDate()} ${MONTHS[d.getMonth()]}` : d || '');

function statusOf(a, day = selDay(), h = UI.hour) {
  const ov = S.ops[a.id];
  if (ov && ov.status !== 'auto') {
    if (ov.status === 'ok') return { ...ST.ok, reason: '', eta: '' };
    return { ...(ST[ov.status] || ST.repair), reason: ov.reason || 'Причину уточняет оператор', eta: ov.eta ? 'вернётся ' + ov.eta.split('-').reverse().slice(0, 2).join('.') : 'срок уточняется', op: true };
  }
  const rep = REPAIR[a.id];
  if (rep && day && day.date < rep.eta) return { ...ST.repair, reason: rep.reason, eta: etaText(rep.eta) };
  if (a.type !== 'interactive' && day) {
    const w = wxAt(day, h), why = closedReason(a, w);
    if (why === 'гроза') return { ...ST.weather, label: 'Гроза', reason: 'Гроза: открытые аттракционы останавливают до её окончания', eta: 'после грозы' };
    if (why === 'сильный ветер') return { ...ST.weather, label: 'Ветер', reason: `Сильный ветер (${Math.round(w.wind)} м/с): высотные аттракционы останавливают`, eta: 'когда ветер стихнет' };
    if (why === 'мороз') return { ...ST.weather, label: 'Мороз', reason: 'Сильный мороз: часть техники не запускают', eta: 'при потеплении' };
  }
  return { ...ST.ok, reason: '', eta: '' };
}
const isOpen = (a, day, h) => statusOf(a, day, h).k === 'ok';
const statusCounts = (day, h) => { const c = { ok: 0, warn: 0, bad: 0 }; ATT.forEach(a => c[statusOf(a, day, h).cls]++); return c; };

/* ---------- сообщество: игры, сердечки, голоса за ремонт ---------- */
// ДЕМО: стартовые значения смоделированы, чтобы рейтинг не был пустым; ваши действия добавляются сверху.
const SEED = {};
ATT.forEach(a => {
  const r = rnd(a.id * 77 + 5);
  SEED[a.id] = {
    plays: Math.round(220 * a.pop * (0.55 + r() * 0.95)),
    likes: Math.round(40 * a.pop * (0.5 + r())),
    checks: Math.round(120 * a.pop * (0.5 + r())),
    rv: REPAIR[a.id] ? Math.round(25 + r() * 105) : 0
  };
});
const myChecks = a => S.checkins.filter(c => c.id === a.id).length;
const playsOf = a => SEED[a.id].plays + (S.plays[a.id] || 0);
const likesOf = a => SEED[a.id].likes + (S.likes[a.id] ? 1 : 0);
const checksOf = a => SEED[a.id].checks + myChecks(a);
const loveScore = a => playsOf(a) + likesOf(a) * 6 + checksOf(a) * 2;
const repairVotes = a => SEED[a.id].rv + (S.repairVotes[a.id] || 0);

/* ---------- награды, уровни ---------- */
const LEVELS = [
  { xp: 0, name: 'Путник', e: '🥾' }, { xp: 150, name: 'Следопыт', e: '🧭' }, { xp: 400, name: 'Богатырь', e: '🛡️' },
  { xp: 800, name: 'Царевич', e: '👑' }, { xp: 1500, name: 'Хранитель Сказки', e: '🔮' }
];
const levelOf = xp => { let i = 0; LEVELS.forEach((l, k) => { if (xp >= l.xp) i = k; }); return i; };
function reward(coins, xp = coins) {
  const before = levelOf(S.xp);
  S.coins += coins; S.xp += xp; save();
  const after = levelOf(S.xp);
  renderTop();
  if (after > before) { toast(`Новый уровень: ${LEVELS[after].e} ${LEVELS[after].name}!`, true); say(`Мррр! Теперь вы — ${LEVELS[after].name}! 🎉`); }
}

/* ---------- действия ---------- */
function toggleLike(a) {
  const on = !S.likes[a.id];
  if (on) { S.likes[a.id] = 1; save(); reward(2, 2); toast(`❤ «${a.name}» — в любимых (+2 💰)`); } else { delete S.likes[a.id]; save(); toast('Убрано из любимых'); }
  refreshAfterWorld();
}
function toggleSub(a) {
  if (S.subs[a.id]) { delete S.subs[a.id]; toast('Уведомление отключено'); } else {
    S.subs[a.id] = 1; S.seenStatus[a.id] = statusOf(a).k; toast(`🔔 Сообщу, когда «${a.name}» заработает`);
  }
  save(); refreshAfterWorld();
}
function voteRepair(a, boost) {
  if (boost) {
    if (S.coins < 20) { toast('Не хватает монет: нужно 20 💰'); return; }
    S.coins -= 20; S.repairVotes[a.id] = (S.repairVotes[a.id] || 0) + 5; save(); renderTop(); toast(`+5 голосов за ремонт «${a.name}»`, true);
  } else {
    if (S.voteDay[a.id] === todayStr()) { toast('Сегодняшний голос за этот аттракцион уже отдан — приходите завтра или добавьте +5 за монеты'); return; }
    S.voteDay[a.id] = todayStr(); S.repairVotes[a.id] = (S.repairVotes[a.id] || 0) + 1; save(); reward(2, 2); toast(`Голос за ремонт «${a.name}» принят (+2 💰)`);
  }
  if (repairVotes(a) >= REPAIR_GOAL && !S.badges['fix' + a.id]) { S.badges['fix' + a.id] = 1; save(); toast(`🎯 Цель достигнута: заявка на ремонт «${a.name}» ушла оператору`, true); say(`Ура! Набрали ${REPAIR_GOAL} голосов: парк увидит, что «${a.name}» ждут.`); }
  refreshAfterWorld();
}
function recordPlay(a, score) {
  S.plays[a.id] = (S.plays[a.id] || 0) + 1;
  const t = todayStr(); if (S.playDay.d !== t) S.playDay = { d: t, n: 0 };
  S.playDay.n++;
  let got = 0;
  if (S.playDay.n <= 5) { got = Math.min(8, 2 + Math.round(score / 40)); reward(got, got); } else save();
  refreshAfterWorld();
  return got;
}
function applyOp(id, status, reason, eta) {
  const a = ATT.find(x => x.id === id), prev = statusOf(a);
  if (status === 'auto') delete S.ops[id]; else S.ops[id] = { status, reason, eta };
  save();
  const cur = statusOf(a);
  if (S.subs[id] && prev.k !== 'ok' && cur.k === 'ok') { toast(`🔔 «${a.name}» снова работает!`, true); say(`Мур! «${a.name}» заработал — вы просили сообщить.`); }
  S.seenStatus[id] = cur.k; save(); refreshAfterWorld(); renderOp();
}
function checkSubscriptions() {
  ATT.filter(a => S.subs[a.id]).forEach(a => {
    const cur = statusOf(a).k;
    if (S.seenStatus[a.id] && S.seenStatus[a.id] !== 'ok' && cur === 'ok') toast(`🔔 «${a.name}» снова работает!`, true);
    S.seenStatus[a.id] = cur;
  });
  save();
}

/* ---------- отметка в парке ---------- */
function checkinTime() {
  if (S.demo) return { day: selDay(), h: UI.hour };
  const now = new Date(), d = UI.days.find(x => x.ds === fmtDate(now)) || UI.days[0];
  return { day: d, h: clamp(now.getHours(), OPEN_H, CLOSE_H - 1) };
}
function doCheckin(a) {
  const { day, h } = checkinTime();
  const st = statusOf(a, day, h);
  if (st.k !== 'ok') return { ok: false, msg: `«${a.name}» сейчас не работает: ${st.reason}. ${st.eta ? st.eta[0].toUpperCase() + st.eta.slice(1) + '.' : ''}`, st };
  if (!S.demo) {
    if (!UI.user) return { ok: false, msg: 'Сначала определите положение (кнопка «Где я?» на карте) или включите демо-режим.' };
    if (UI.user.src && UI.user.src !== 'gps') return { ok: false, msg: 'Для отметки нужно точное положение: разрешите геолокацию в браузере или включите демо-режим.' };
    if (UI.user.dist > RADIUS_M) return { ok: false, msg: `Вы в ${(UI.user.dist / 1000).toFixed(1)} км от парка. Отметка работает в радиусе ${RADIUS_M} м.` };
  }
  if (S.checkins.some(c => c.id === a.id && c.ds === day.ds)) return { ok: false, msg: 'Сегодня вы здесь уже отмечались.' };
  const L = day.hours.find(x => x.h === h)?.load ?? 50, mult = coinMult(L);
  const gain = Math.round((20 + (a.type === 'extreme' ? 10 : 0)) * mult);
  S.checkins.push({ id: a.id, ds: day.ds, h, load: L, wk: WX(wxAt(day, h).code).k, ts: Date.now() });
  reward(gain, Math.round(gain * 1.2));
  return { ok: true, gain, mult, L };
}
function refreshAfterWorld() {
  const qm = typeof questProgress === 'function' ? questProgress() : '';
  if (qm) toast(qm.replace(/^ · /, ''), true);
  renderTop(); typeof renderRepair === 'function' && renderRepair(); renderStatusStrip && renderStatusStrip(); drawMap && drawMap();
  if (typeof renderRides === 'function') renderRides(true);
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof renderChapters === 'function') renderChapters();
  if (typeof refreshSheet === 'function') refreshSheet();
  if (typeof renderOp === 'function' && !$('#s-op').hidden) renderOp();
}
