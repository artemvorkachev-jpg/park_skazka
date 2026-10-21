/* screens.js — карта, «Статус», «Топ», «Когда», оператор */
'use strict';

/* ================= игровая карта парка (схема) ================= */
const ZONES = [
  { name: 'Площадь чудес', types: ['family'], cx: 500, cy: 440, sp: 34, c: '#f5b83d' },
  { name: 'Страна малышей', types: ['kids'], cx: 185, cy: 540, sp: 34, c: '#ef6f9e' },
  { name: 'Вихревая гора', types: ['extreme'], cx: 790, cy: 240, sp: 34, c: '#ef6f5e' },
  { name: 'Терем Бабы Яги', types: ['interactive'], cx: 195, cy: 235, sp: 38, c: '#9b6bff' },
  { name: 'Звериная поляна и Динолэнд', types: ['zone'], cx: 500, cy: 170, sp: 40, c: '#2fb5a7' }
];
const GATE = { x: 500, y: 690 };
const NODE_POS = {};
ZONES.forEach(z => {
  ATT.filter(a => z.types.includes(a.type)).forEach((a, i) => {
    const ang = i * 2.399963, r = z.sp * Math.sqrt(i + 0.6);
    NODE_POS[a.id] = { x: Math.round(z.cx + r * Math.cos(ang)), y: Math.round(z.cy + r * Math.sin(ang)), z };
  });
});
const STC = { ok: '#4be3a0', warn: '#ffc857', bad: '#ff6b6b' };
function mapBackdrop() {
  const r = rnd(42); let trees = '';
  for (let i = 0; i < 90; i++) { const x = r() * 1000, y = r() * 720, s = 6 + r() * 12; trees += `<circle cx="${x | 0}" cy="${y | 0}" r="${s | 0}" fill="rgba(60,120,100,${(.08 + r() * .14).toFixed(2)})"/>`; }
  let stars = ''; for (let i = 0; i < 40; i++) stars += `<circle cx="${(r() * 1000) | 0}" cy="${(r() * 720) | 0}" r="${(.6 + r() * 1.3).toFixed(1)}" fill="rgba(255,255,255,${(.2 + r() * .4).toFixed(2)})"/>`;
  const paths = ZONES.map(z => `<path d="M${GATE.x} ${GATE.y} Q${(GATE.x + z.cx) / 2 + (z.cx < 500 ? -60 : 60)} ${(GATE.y + z.cy) / 2} ${z.cx} ${z.cy}" stroke="rgba(245,184,61,.22)" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="2 18"/>`).join('');
  const blobs = ZONES.map(z => `<ellipse cx="${z.cx}" cy="${z.cy}" rx="${z.sp * 4.6}" ry="${z.sp * 3.6}" fill="${z.c}" opacity=".1"/><text x="${z.cx}" y="${Math.max(34, z.cy - z.sp * 4.2)}" text-anchor="middle" class="zname" fill="${z.c}">${z.name}</text>`).join('');
  return `<defs><radialGradient id="mg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#2a2760"/><stop offset="1" stop-color="#0f0d2b"/></radialGradient></defs><rect width="1000" height="720" fill="url(#mg)" rx="24"/>${stars}${trees}${paths}${blobs}` +
    `<g transform="translate(${GATE.x},${GATE.y})"><rect x="-46" y="-18" width="92" height="34" rx="12" fill="#f5b83d"/><text y="6" text-anchor="middle" class="gate">ВХОД</text></g>`;
}
function drawMap() {
  const svg = $('#fmap'); if (!svg || !UI.days.length) return;
  const day = selDay(), h = UI.hour;
  const topLoved = new Set([...ATT].sort((a, b) => loveScore(b) - loveScore(a)).slice(0, 8).map(a => a.id));
  let g = '';
  ATT.forEach(a => {
    const p = NODE_POS[a.id]; if (!p) return;
    const st = statusOf(a, day, h), fav = topLoved.has(a.id);
    g += `<g class="node ${st.cls}" data-id="${a.id}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(a.name)}: ${st.label}">
      <title>${esc(a.name)} — ${st.label}${st.reason ? ': ' + esc(st.reason) : ''}</title>
      ${fav ? '<circle r="20" fill="none" stroke="#f5b83d" stroke-width="2" stroke-dasharray="3 4" class="spin"/>' : ''}
      <circle r="15" fill="${STC[st.cls]}" stroke="#fff" stroke-width="2.5"/>
      <text class="ne" y="5" text-anchor="middle">${TYPE_EMOJI[a.type]}</text>
      ${st.cls === 'bad' ? '<text class="nx" y="-18" text-anchor="middle">🔧</text>' : ''}
    </g>`;
  });
  svg.innerHTML = mapBackdrop() + g;
}
$('#fmap').addEventListener('click', e => { const n = e.target.closest('.node'); if (n) openRide(+n.dataset.id); });
$('#fmap').addEventListener('keydown', e => { if (e.key === 'Enter') { const n = e.target.closest('.node'); if (n) openRide(+n.dataset.id); } });

/* ================= «Статус»: каталог ================= */
const CAT = { who: 'family', h: 120, type: 'all', q: '', sort: 'hit', only: true, status: 'all' };
function catHeights() {
  if (CAT.who === 'family') return S.family.length ? S.family.map(f => f.h) : [CAT.h];
  if (CAT.who === 'custom') return [CAT.h];
  const m = S.family[+CAT.who]; return [m ? m.h : CAT.h];
}
function fit(a, heights) {
  const low = Math.min(...heights);
  if (low < a.hmin) return { ok: false, why: `ещё ${a.hmin - low} см до минимума`, kind: 'short' };
  if (heights.every(x => x > a.hmax)) return { ok: false, why: `выше максимума (${a.hmax} см)`, kind: 'tall' };
  const over = heights.filter(x => x > a.hmax).length;
  return { ok: true, why: over ? `${over} чел. выше ${a.hmax} см — смотрят со стороны` : 'подходит по росту', kind: over ? 'partial' : 'ok' };
}
function renderCatalogControls() {
  const sel = $('#catWho'), cur = CAT.who;
  sel.innerHTML = `<option value="family">Вся семья${S.family.length ? ' (' + Math.min(...S.family.map(f => f.h)) + '–' + Math.max(...S.family.map(f => f.h)) + ' см)' : ''}</option>` +
    S.family.map((f, i) => `<option value="${i}">${esc(f.name)} · ${f.h} см</option>`).join('') + '<option value="custom">Свой рост…</option>';
  sel.value = [...sel.options].some(o => o.value === String(cur)) ? cur : 'family'; CAT.who = sel.value;
  $('#catHWrap').style.display = CAT.who === 'custom' ? '' : 'none';
}
function renderRides(soft) {
  if (!UI.days.length) return;
  if (!soft) renderCatalogControls();
  const day = selDay(), h = UI.hour, hs = catHeights(), conf = dayConf(day);
  let list = ATT.map(a => ({ a, f: fit(a, hs), st: statusOf(a, day, h), wait: waitFor(a, day, h), best: bestHourFor(a, day) }));
  if (CAT.type !== 'all') list = list.filter(x => x.a.type === CAT.type);
  if (CAT.status !== 'all') list = list.filter(x => x.st.cls === CAT.status);
  if (CAT.q) list = list.filter(x => x.a.name.toLowerCase().includes(CAT.q.toLowerCase()));
  const total = list.length;
  if (CAT.only) list = list.filter(x => x.f.ok);
  const sorters = { hit: (x, y) => y.a.pop - x.a.pop, love: (x, y) => loveScore(y.a) - loveScore(x.a), wait: (x, y) => x.wait - y.wait, height: (x, y) => x.a.hmin - y.a.hmin, name: (x, y) => x.a.name.localeCompare(y.a.name, 'ru') };
  list.sort(sorters[CAT.sort]);
  $('#catCount').innerHTML = `Показано <b>${list.length}</b> из ${total}. На ${longDate(day.date)}, ${pad(h)}:00 · точность очередей: ${conf.n}.`;
  $('#catGrid').innerHTML = list.map(({ a, f, st, wait, best }) => {
    const L = attLoad(a, day, h);
    return `<article class="ac st-${st.cls} ${f.ok ? '' : 'no'}" data-open="${a.id}" tabindex="0">
      <div class="ac-img"><img loading="lazy" referrerpolicy="no-referrer" src="${a.img}" alt="${esc(a.name)}"><span class="ac-type">${TYPE_EMOJI[a.type]} ${TYPE_RU[a.type]}</span><span class="ribbon ${st.cls}">${st.dot} ${st.label}</span></div>
      <div class="ac-body"><h4>${esc(a.name)} ${S.likes[a.id] ? '<span title="В любимых">❤</span>' : ''}</h4>
        ${st.reason ? `<p class="why">${esc(st.reason)}<br><b>${esc(st.eta)}</b></p>` : `<div class="ac-fit ${f.kind}">${f.kind === 'ok' ? '✅' : f.kind === 'partial' ? '👀' : '⛔'} ${esc(f.why)}</div>`}
        <div class="badges"><span class="badge">рост ${a.hmin ? 'от ' + a.hmin : 'любой'}${a.hmax < 250 ? ' до ' + a.hmax : ''} см</span>
        ${st.cls === 'ok' ? `<span class="badge w q${qLevel(L)}">⏱ ~${wait} мин</span><span class="badge">лучше в ${pad(best.h)}:00</span>` : ''}
        <span class="badge">❤ ${likesOf(a)}</span></div></div></article>`;
  }).join('') || '<p class="fineprint">Ничего не найдено — уберите фильтры или измените рост.</p>';
}
function initCatalog() {
  CAT.h = Math.min(...S.family.map(f => f.h), 120); $('#catH').value = CAT.h;
  $('#catWho').addEventListener('change', e => { CAT.who = e.target.value; renderRides(); });
  $('#catH').addEventListener('input', e => { CAT.h = clamp(+e.target.value || 0, 0, 220); renderRides(true); });
  $$('.hchips button').forEach(b => b.addEventListener('click', () => { CAT.who = 'custom'; CAT.h = +b.dataset.h; $('#catH').value = CAT.h; renderRides(); }));
  $('#catTypes').addEventListener('click', e => { const t = e.target.dataset?.t; if (!t) return; CAT.type = t; $$('#catTypes button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); renderRides(true); });
  $('#catStatus').addEventListener('click', e => { const t = e.target.dataset?.s; if (!t) return; CAT.status = t; $$('#catStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === t)); renderRides(true); });
  $('#catQ').addEventListener('input', e => { CAT.q = e.target.value.trim(); renderRides(true); });
  $('#catSort').addEventListener('change', e => { CAT.sort = e.target.value; renderRides(true); });
  $('#catOnly').addEventListener('change', e => { CAT.only = e.target.checked; renderRides(true); });
  $('#catGrid').addEventListener('click', e => { const c = e.target.closest('[data-open]'); if (c) openRide(+c.dataset.open); });
  $('#catGrid').addEventListener('keydown', e => { if (e.key === 'Enter') { const c = e.target.closest('[data-open]'); if (c) openRide(+c.dataset.open); } });
}

/* ================= «Топ» ================= */
function renderBoard() {
  const day = selDay(), h = UI.hour;
  const list = [...ATT].sort((a, b) => loveScore(b) - loveScore(a)).slice(0, 10), max = loveScore(list[0]);
  $('#board').innerHTML = list.map((a, i) => {
    const st = statusOf(a, day, h);
    return `<li data-open="${a.id}" tabindex="0"><span class="medal">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <div class="bl"><b>${esc(a.name)} ${st.cls !== 'ok' ? `<span class="mini-st ${st.cls}">${st.label}</span>` : ''}</b>
      <div class="bar"><i style="width:${Math.round(loveScore(a) / max * 100)}%"></i></div>
      <small>🎮 ${playsOf(a)} игр · ❤ ${likesOf(a)} · ✔ ${checksOf(a)} отметок</small></div></li>`;
  }).join('');
}
function renderRepair() {
  const day = selDay(), h = UI.hour;
  const list = ATT.map(a => ({ a, st: statusOf(a, day, h) })).filter(x => x.st.cls === 'bad').sort((x, y) => repairVotes(y.a) - repairVotes(x.a));
  $('#repairList').innerHTML = list.map(({ a, st }) => {
    const v = repairVotes(a), pct = Math.min(100, Math.round(v / REPAIR_GOAL * 100)), done = v >= REPAIR_GOAL;
    return `<div class="rp" data-id="${a.id}"><div class="rp-top"><img referrerpolicy="no-referrer" src="${a.img}" alt=""><div><b>${esc(a.name)}</b><small>🔧 ${esc(st.reason)} · ${esc(st.eta)}</small></div></div>
      <div class="bar gold"><i style="width:${pct}%"></i></div>
      <div class="rp-row"><span>${done ? '✅ Заявка передана оператору' : `${v} из ${REPAIR_GOAL} голосов`}</span>
      <span><button class="btn small" data-rv="1">🛠 Починить!</button> <button class="btn small ghost" data-rv="5">+5 за 20 💰</button></span></div></div>`;
  }).join('') || '<p class="fineprint">Сейчас всё работает — чинить нечего 🎉</p>';
}
$('#repairList').addEventListener('click', e => {
  const b = e.target.closest('[data-rv]'); if (!b) return;
  const a = ATT.find(x => x.id === +b.closest('.rp').dataset.id); voteRepair(a, b.dataset.rv === '5'); renderRepair();
});
$('#board').addEventListener('click', e => { const c = e.target.closest('[data-open]'); if (c) openRide(+c.dataset.open); });

/* ================= «Когда» ================= */
function renderCalendar() {
  const cal = $('#calendar'); cal.innerHTML = '';
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(d => cal.insertAdjacentHTML('beforeend', `<div class="cal-dow">${d}</div>`));
  const first = UI.days[0], lead = (first.date.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) cal.insertAdjacentHTML('beforeend', '<div class="cal-day empty"></div>');
  UI.days.forEach(d => {
    const W = WX(d.code), el = document.createElement('button');
    el.className = `cal-day q${d.q} ${d.src === 'climate' ? 'clim' : ''} ${d.ds === UI.dateStr ? 'sel' : ''}`; el.dataset.ds = d.ds;
    el.setAttribute('aria-label', `${longDate(d.date)}, ${W.t}, ${Math.round(d.tmax)} градусов, загрузка ${qName(d.bestH.load)}`);
    el.innerHTML = `${d.hol ? '<span class="hol" title="' + esc(d.hol) + '">🎉</span>' : ''}<span class="n">${d.date.getDate()}${d.date.getDate() === 1 || d === first ? ' <small>' + MONTHS[d.date.getMonth()].slice(0, 3) + '</small>' : ''}</span><span class="ic">${W.i}</span><span class="t">${Math.round(d.tmax)}°/${Math.round(d.tmin)}°</span><span class="r">☔${Math.round(d.pr)}%</span>`;
    el.addEventListener('click', () => selectDay(d.ds));
    cal.appendChild(el);
  });
}
function renderDetail() {
  const d = selDay();
  $('#ddTitle').textContent = longDate(d.date) + (d.hol ? ` · ${d.hol}` : '');
  const tag = $('#ddSrc'); tag.textContent = d.src === 'forecast' ? 'Прогноз по часам' : 'Климат за 11 лет, не прогноз'; tag.className = 'tag ' + (d.src === 'forecast' ? 'fc' : 'cl');
  const b = d.bestH, wb = wxAt(d, b.h);
  $('#ddBest').innerHTML = `⭐ Лучшее время — <b>${pad(b.h)}:00</b>: ${WX(wb.code).i} ${Math.round(wb.t)}°, ${qName(b.load)}, монеты <b>×${coinMult(b.load)}</b>.` +
    (d.src === 'climate' ? ' Часовой прогноз появится за 16 дней до даты.' : '') + ` <span class="fineprint">Точность очередей: ${dayConf(d).n} (±${dayConf(d).s} мин).${isBreak(d.ds) ? ' Возможны каникулы (предположение).' : ''}</span>`;
  $('#hours').innerHTML = d.hours.map(x => {
    const w = wxAt(d, x.h), W = WX(w.code);
    return `<button class="hr q${qLevel(x.load)} ${x.h === UI.hour ? 'sel' : ''} ${x.h === b.h ? 'best' : ''}" data-h="${x.h}" aria-label="${pad(x.h)}:00, ${W.t}, ${qName(x.load)}">
      <div class="h">${pad(x.h)}:00</div><div class="ic">${W.i}</div><div class="t">${Math.round(w.t)}°</div><div class="p">☔ ${Math.round(w.p)}%</div>
      <div class="bar"><i style="width:${x.load}%"></i></div><div class="m">${qName(x.load)} · хиты ~${waitMin(x.load, 1.3)} мин</div><div class="x">💰 ×${coinMult(x.load)}</div></button>`;
  }).join('');
}
$('#hours').addEventListener('click', e => { const b = e.target.closest('.hr'); if (b) setHour(+b.dataset.h); });

/* ================= оператор ================= */
function renderOp() {
  const day = selDay(), h = UI.hour;
  const plays = ATT.reduce((s, a) => s + playsOf(a), 0), likes = ATT.reduce((s, a) => s + likesOf(a), 0), votes = ATT.reduce((s, a) => s + repairVotes(a), 0);
  $('#opKpis').innerHTML = [['🎮', plays, 'игр на аттракционах'], ['❤', likes, 'сердечек'], ['🛠', votes, 'голосов за ремонт'], ['💡', allIdeas().length, 'идей игроков']]
    .map(([i, n, t]) => `<div class="kpi"><i>${i}</i><b>${n.toLocaleString('ru-RU')}</b><span>${t}</span></div>`).join('');
  $('#opRepair').innerHTML = ATT.filter(a => statusOf(a, day, h).cls === 'bad').sort((a, b) => repairVotes(b) - repairVotes(a))
    .map(a => `<div class="oprow"><span>${esc(a.name)}</span><b>${repairVotes(a)}</b></div>`).join('') || '<p class="fineprint">Нет остановленных аттракционов.</p>';
  $('#opIdeas').innerHTML = allIdeas().sort((a, b) => ideaVotes(b) - ideaVotes(a)).slice(0, 6)
    .map(i => `<div class="oprow"><span>${esc(i.name)} <small>${THEMES[i.theme].name}</small></span><b>${ideaVotes(i)}</b></div>`).join('');
  $('#opTable').innerHTML = ATT.map(a => {
    const ov = S.ops[a.id] || { status: 'auto', reason: '', eta: '' }, st = statusOf(a, day, h);
    return `<div class="optr" data-id="${a.id}"><b>${esc(a.name)}</b><span class="mini-st ${st.cls}">${st.label}</span>
      <select class="o-st">${[['auto', 'Авто'], ['ok', 'Работает'], ['repair', 'Ремонт'], ['service', 'Тех. обслуживание'], ['weather', 'Погода']].map(([v, t]) => `<option value="${v}" ${ov.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="o-re" placeholder="Причина" value="${esc(ov.reason || '')}"><input class="o-eta" type="date" value="${ov.eta || ''}"><button class="btn small">Сохранить</button></div>`;
  }).join('');
}
$('#opTable').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const r = b.closest('.optr');
  applyOp(+r.dataset.id, $('.o-st', r).value, $('.o-re', r).value.trim(), $('.o-eta', r).value);
  toast('Статус сохранён');
});
$('#opLink').addEventListener('click', e => { e.preventDefault(); go('op'); });
