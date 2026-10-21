/* ui.js — оболочка: навигация, тосты, карточка аттракциона, Кот Баюн, hero, геолокация */
'use strict';

/* ---------- тост и Кот ---------- */
function toast(msg, gold) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (gold ? ' gold' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 3600);
}
function say(text) {
  const b = $('#bubble'); b.textContent = text;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
}

/* ---------- навигация ---------- */
const SCREENS = ['plan', 'map', 'game', 'quest', 'rides', 'top', 'build', 'when', 'op'];
const onShow = {
  plan: () => renderPlanner(),
  map: () => { drawMap(); renderStatusStrip(); setTimeout(() => UI.map && UI.map.invalidateSize(), 50); },
  game: () => { renderGame(); },
  quest: () => { renderChapters(); renderRewards(); },
  rides: () => renderRides(),
  top: () => { renderBoard(); renderRepair(); },
  build: () => { renderBuild(); renderIdeas(); },
  when: () => { renderCalendar(); renderDetail(); },
  op: () => renderOp()
};
function go(name, noHash) {
  if (!SCREENS.includes(name)) name = 'map';
  SCREENS.forEach(s => { $('#s-' + s).hidden = s !== name; });
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.go === name));
  if (!noHash && location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  closeSheet(); window.scrollTo(0, 0);
  if (UI.days.length) onShow[name] && onShow[name]();
  UI.screen = name;
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g && !g.closest('#tabbar')) { e.preventDefault(); go(g.dataset.go); }
});
$('#tabbar').addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); go(a.dataset.go); } });
addEventListener('hashchange', () => go(location.hash.slice(1), true));

function renderTop() {
  const li = levelOf(S.xp);
  $('#coinsTop').textContent = S.coins;
  $('#lvlChip').textContent = `${LEVELS[li].e} ${LEVELS[li].name}`;
}

/* ---------- hero ---------- */
function renderHero() {
  const day = selDay(), h = UI.hour, w = wxAt(day, h), W = WX(w.code), L = day.hours.find(x => x.h === h)?.load ?? 40;
  $('#heroWhen').textContent = `${longDate(day.date)} · ${pad(h)}:00`;
  const wet = ['rain', 'storm', 'snow'].includes(W.k);
  $('#heroTitle').textContent = `${W.i} ${Math.round(w.t)}°, ${W.t}` + (wet ? `: ${W.k === 'snow' ? 'снег' : 'дождь'} в ${pad(h)}:00` : '');
  const sc = statusCounts(day, h);
  $('#heroSub').textContent = day.src === 'forecast'
    ? `В парке будет ${qName(L)}. Работает ${sc.ok} из ${ATT.length} аттракционов. Самое спокойное время — ${pad(day.bestH.h)}:00.`
    : `До даты ещё далеко — это климатический ориентир: ${Math.round(day.tmin)}…${Math.round(day.tmax)}°, осадки в ${day.pr}% дней.`;
  $('#heroChips').innerHTML = [
    `<span class="chip">☔ осадки <b>${Math.round(w.p)}%</b></span>`,
    `<span class="chip">💨 ветер <b>${Math.round(w.wind)} м/с</b></span>`,
    `<span class="chip q${qLevel(L)}">👥 <b>${qName(L)}</b> · хиты ~${waitMin(L, 1.3)} мин</span>`,
    `<span class="chip">💰 монеты <b>×${coinMult(L)}</b></span>`
  ].join('');
  Scene.set(w.code, h, day.date, w.t);
  say(autoLine());
}
function autoLine() {
  const day = selDay(), h = UI.hour, w = wxAt(day, h), W = WX(w.code), L = day.hours.find(x => x.h === h)?.load ?? 40;
  const sc = statusCounts(day, h);
  if (UI.user && UI.user.dist <= RADIUS_M) return `Мяу! Вы уже в Сказке. Сейчас ${qName(L)}, монеты ×${coinMult(L)} — отметьтесь на аттракционе!`;
  if (sc.warn > 0 && W.k === 'storm') return `В ${pad(h)}:00 гроза — ${sc.warn} аттракционов остановят. Нажмите «Что не работает?», расскажу причины.`;
  if (sc.warn > 3) return `В ${pad(h)}:00 ветер ${Math.round(w.wind)} м/с: ${sc.warn} аттракционов могут встать. Загляните в «Статус».`;
  if (L < 25) return `В ${pad(h)}:00 тихо — очередей почти нет, монеты ×${coinMult(L)}. Отличное окно!`;
  if (L >= 75) return `В ${pad(h)}:00 людно. Сдвиньте визит на ${pad(day.bestH.h)}:00 — монет будет ×${coinMult(day.bestH.load)}.`;
  const next = nextQuestStep();
  return next ? `Следующее задание квеста: ${next.text}` : `${W.t[0].toUpperCase() + W.t.slice(1)}, ${Math.round(w.t)}°. Лучшее время — ${pad(day.bestH.h)}:00.`;
}
function answer(q) {
  const day = selDay(), h = UI.hour, minH = Math.min(...S.family.map(f => f.h));
  const names = (arr, n = 4) => arr.slice(0, n).map(a => a.name.replace(/[«»]/g, '')).join(', ');
  if (q === 'today') return say(`${longDate(day.date)}: лучше всего в ${pad(day.bestH.h)}:00 (${qName(day.bestH.load)}, монеты ×${coinMult(day.bestH.load)}). Работает ${statusCounts(day, h).ok} из ${ATT.length}.`);
  if (q === 'closed') {
    const bad = ATT.map(a => ({ a, s: statusOf(a, day, h) })).filter(x => x.s.k !== 'ok');
    if (!bad.length) return say('Сейчас всё работает! Можно кататься спокойно.');
    return say(bad.slice(0, 3).map(x => `«${x.a.name}» — ${x.s.reason.toLowerCase()} (${x.s.eta})`).join('. ') + (bad.length > 3 ? ` …и ещё ${bad.length - 3}. Всё — на экране «Статус».` : '.'));
  }
  if (q === 'kids') { const ok = ATT.filter(a => minH >= a.hmin && ['kids', 'family'].includes(a.type) && isOpen(a, day, h)); return say(`С ростом ${minH} см сейчас доступно ${ok.length} спокойных мест: ${names(ok.sort((a, b) => loveScore(b) - loveScore(a)))}.`); }
  if (q === 'thrill') { const ex = ATT.filter(a => a.type === 'extreme' && minH >= a.hmin && isOpen(a, day, h)); return say(ex.length ? `Для экстрима по росту и статусу доступны: ${names(ex.sort((a, b) => loveScore(b) - loveScore(a)))}. Любимцы гостей — первыми.` : 'Экстремальные сейчас недоступны по росту или статусу. Посмотрите колесо обозрения!'); }
  if (q === 'quest') { const n = nextQuestStep(); return say(n ? `Следующий шаг: ${n.text} (глава «${n.chapter}»).` : 'Все главы пройдены! Вы — Хранитель Сказки 🔮'); }
}
$('#ask').addEventListener('click', e => { const q = e.target.dataset?.q; if (q) answer(q); });

/* ---------- время / день ---------- */
function setHour(h) {
  UI.hour = clamp(h, OPEN_H, CLOSE_H - 1);
  $('#hourSlider').value = UI.hour; $('#hourLabel').textContent = pad(UI.hour) + ':00';
  renderHero(); renderStatusStrip(); drawMap();
  if (UI.screen === 'rides') renderRides(true);
  if (UI.screen === 'when') $$('.hr').forEach(e => e.classList.toggle('sel', +e.dataset.h === UI.hour));
  refreshSheet();
}
function selectDay(ds) {
  UI.dateStr = ds; renderHero(); renderStatusStrip(); drawMap();
  if (UI.screen === 'when') { renderCalendar(); renderDetail(); }
  if (UI.screen === 'rides') renderRides(true);
}
$('#hourSlider').addEventListener('input', e => setHour(+e.target.value));

/* ---------- полоса статусов ---------- */
function renderStatusStrip() {
  const day = selDay(), h = UI.hour, sc = statusCounts(day, h);
  $('#statusStrip').innerHTML =
    `<button class="ss ok" data-filter="ok"><b>${sc.ok}</b><span>работает</span></button>` +
    `<button class="ss warn" data-filter="warn"><b>${sc.warn}</b><span>погода</span></button>` +
    `<button class="ss bad" data-filter="bad"><b>${sc.bad}</b><span>ремонт</span></button>` +
    `<button class="ss gold" data-go="top"><b>${ATT.filter(a => REPAIR[a.id] && S.ops[a.id]?.status !== 'ok').length}</b><span>ждут голосов</span></button>`;
  $('#mapLegend').innerHTML = '<span><i class="d ok"></i> работает</span><span><i class="d warn"></i> погода</span><span><i class="d bad"></i> ремонт</span><span><i class="d fav"></i> ❤ любимый</span>';
}
$('#statusStrip').addEventListener('click', e => {
  const f = e.target.closest('[data-filter]'); if (!f) return;
  CAT.status = f.dataset.filter; go('rides');
  $$('#catStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === CAT.status)); renderRides(true);
});

/* ---------- карточка аттракциона ---------- */
function openRide(id) {
  UI.sheetId = id; renderSheet(); $('#sheet').hidden = false; $('#sheetBg').hidden = false;
  requestAnimationFrame(() => { $('#sheet').classList.add('on'); });
}
function closeSheet() { UI.sheetId = null; $('#sheet').classList.remove('on'); $('#sheet').hidden = true; $('#sheetBg').hidden = true; }
function refreshSheet() { if (UI.sheetId) renderSheet(); }
function renderSheet() {
  const a = ATT.find(x => x.id === UI.sheetId); if (!a) return;
  const day = selDay(), h = UI.hour, st = statusOf(a, day, h), wait = waitFor(a, day, h), best = bestHourFor(a, day), conf = dayConf(day);
  const fitR = fit(a, catHeights());
  const rank = [...ATT].sort((x, y) => loveScore(y) - loveScore(x)).findIndex(x => x.id === a.id) + 1;
  const rv = repairVotes(a), bad = st.cls === 'bad';
  $('#sheet').innerHTML = `
    <button class="sheet-x" id="sheetX" aria-label="Закрыть">✕</button>
    <div class="sheet-img"><img referrerpolicy="no-referrer" src="${a.img}" alt="${esc(a.name)}"><span class="ac-type">${TYPE_EMOJI[a.type]} ${TYPE_RU[a.type]}</span></div>
    <div class="sheet-body">
      <h3>${esc(a.name)}</h3>
      <div class="stat-banner ${st.cls}"><b>${st.dot} ${st.label}</b>${st.reason ? `<p>${esc(st.reason)}</p><p class="eta">${esc(st.eta)}</p>` : `<p>Работает. ${waitText(wait, conf)}</p>`}
        ${st.k !== 'ok' ? `<button class="btn small ${S.subs[a.id] ? '' : 'ghost'}" data-act="sub">${S.subs[a.id] ? '🔔 Вы подписаны' : '🔔 Сообщить, когда заработает'}</button>` : ''}</div>
      <p class="sheet-desc">${esc(a.desc)}</p>
      <div class="badges">
        <span class="badge">рост ${a.hmin ? 'от ' + a.hmin : 'любой'}${a.hmax < 250 ? ' до ' + a.hmax : ''} см</span>
        <span class="badge ${fitR.ok ? '' : 'warn'}">${fitR.ok ? '✅' : '⛔'} ${esc(fitR.why)}</span>
        ${a.priceFrom ? `<span class="badge">от ${a.priceFrom} ₽</span>` : ''}
        <span class="badge">лучше в ${pad(best.h)}:00 (~${waitFor(a, day, best.h)} мин)</span>
      </div>
      <div class="love-row"><span>🏆 №${rank} в рейтинге</span><span>🎮 ${playsOf(a)} игр</span><span>❤ ${likesOf(a)}</span></div>
      <div class="sheet-actions">
        <button class="btn ${S.likes[a.id] ? 'on' : 'ghost'}" data-act="like">${S.likes[a.id] ? '❤ В любимых' : '🤍 Мне нравится'}</button>
        <button class="btn ghost" data-act="play">🎮 Сыграть</button>
        ${bad ? `<div class="locked">🔒 Отметиться пока нельзя: ${esc(st.label.toLowerCase())}${st.eta ? ' · ' + esc(st.eta) : ''}. Нажмите «Сообщить, когда заработает» или «Починить!».</div>` : '<button class="btn big" data-act="checkin">✔ Я здесь!</button>'}
        ${bad ? `<button class="btn gold" data-act="vote">🛠 Починить! (${rv}/${REPAIR_GOAL})</button>` : ''}
      </div>
    </div>`;
  $('#sheetX').onclick = closeSheet;
}
const waitText = (w, conf) => `Ожидание ~${w} мин (точность: ${conf.n}).`;
$('#sheetBg').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  const a = ATT.find(x => x.id === UI.sheetId); if (!a) return;
  if (act === 'like') toggleLike(a);
  if (act === 'sub') toggleSub(a);
  if (act === 'vote') voteRepair(a, false);
  if (act === 'play') openGame(a);
  if (act === 'checkin') {
    const r = doCheckin(a);
    if (!r.ok) return toast(r.msg);
    let msg = `+${r.gain} 💰 за «${a.name}»` + (r.mult > 1 ? ` (×${r.mult}, ${qName(r.L)})` : '');
    msg += questProgress();
    toast(msg, true);
    say(r.mult >= 2 ? `Умно! «${qName(r.L)}» час — монет ×${r.mult}.` : `Отметил «${a.name}». ${r.L >= 75 ? 'Людно — в следующий раз приходите пораньше.' : 'Так держать!'}`);
    refreshAfterWorld();
    askLike(a);
  }
});
// после отметки предлагаем поставить сердечко — так рождается рейтинг любимых
function askLike(a) {
  if (S.likes[a.id]) return;
  modal(`<h3>Как вам «${esc(a.name)}»?</h3><p>Ваша оценка помогает парку понять, какие аттракционы нравятся больше всего.</p>
    <div class="modal-row"><button class="btn" data-m="like">❤ Понравилось (+2 💰)</button><button class="btn ghost" data-m="skip">Пропустить</button></div>`, m => { if (m === 'like') toggleLike(a); });
}

/* ---------- модальное окно ---------- */
let modalCb = null;
function modal(html, cb) {
  $('#modal').innerHTML = html; modalCb = cb || null; $('#modalBg').hidden = false;
}
function closeModal() { $('#modalBg').hidden = true; modalCb = null; }
$('#modalBg').addEventListener('click', e => {
  if (e.target.id === 'modalBg') return closeModal();
  const m = e.target.closest('[data-m]'); if (!m) return;
  const cb = modalCb; if (m.dataset.m === 'close') return closeModal();
  if (cb) cb(m.dataset.m, m);
  if (!m.dataset.keep) closeModal();
});

/* ---------- карта и геолокация ---------- */
function haversine(a, b, c, d) { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(c - a), dLo = r(d - b); const x = Math.sin(dLa / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function initMap() {
  if (!window.L) { $('#leaflet').innerHTML = '<p style="padding:20px">Карта не загрузилась.</p>'; return; }
  const map = L.map('leaflet', { scrollWheelZoom: false }).setView([PARK.lat, PARK.lon], 16);
  // у OpenStreetMap и CARTO плитки без ключа не отдаются, поэтому схему берём у Esri (как и спутник)
  const osm = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Street Map' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Imagery' });
  sat.addTo(map);
  L.control.layers({ 'Спутник': sat, 'Схема': osm }, null, { collapsed: false }).addTo(map);
  L.circle([PARK.lat, PARK.lon], { radius: RADIUS_M, color: '#f5b83d', weight: 2, fillOpacity: .08 }).addTo(map);
  const icon = L.divIcon({ html: '<div style="font-size:34px;filter:drop-shadow(0 2px 4px #0008)">🎡</div>', className: '', iconSize: [34, 34], iconAnchor: [17, 30] });
  L.marker([PARK.lat, PARK.lon], { icon }).addTo(map).bindPopup(`<b>${PARK.name}</b><br>${PARK.addr}`);
  map.on('click', e => { if (!UI.pick) return; UI.pick = false; $('#geoPick').classList.remove('on'); map.getContainer().style.cursor = ''; setUser(e.latlng.lat, e.latlng.lng, 'manual'); });
  UI.map = map;
}
function updateGis() {
  const to = `${PARK.lon}%2C${PARK.lat}`;
  $('#gis').href = `https://2gis.ru/moscow?m=${to}%2F16`;
  $('#gisRoute').href = UI.user ? `https://2gis.ru/moscow/directions/points/${UI.user.lon}%2C${UI.user.lat}%7C${to}` : `https://2gis.ru/moscow/directions/points/%7C${to}`;
}
// положение: src = 'gps' (точное, из браузера), 'ip' (примерно, по адресу сети) или 'manual' (указано на карте)
function setUser(lat, lon, src, accuracy) {
  const dist = haversine(lat, lon, PARK.lat, PARK.lon);
  UI.user = { lat, lon, dist, accuracy, src };
  const km = dist / 1000, inPark = dist <= RADIUS_M;
  const how = { gps: '', ip: ' <span class="geo-tag">примерно, по сети: точность до города</span>', manual: ' <span class="geo-tag">указано вручную</span>' }[src];
  $('#geoStatus').innerHTML = (inPark && src === 'gps') ? `✅ Вы в парке (${Math.round(dist)} м от центра). Можно отмечаться!` :
    (km > 100 ? `До парка <b>${Math.round(km)} км</b> — вы далеко от Москвы.${how}` : `До парка <b>${km < 10 ? km.toFixed(1) : Math.round(km)} км</b>. Пешком ~${Math.round(km / 4.8 * 60)} мин, на авто ~${Math.max(5, Math.round(km / 24 * 60))} мин (без пробок).${how}`);
  if (UI.map) {
    if (UI.userMarker) UI.userMarker.setLatLng([lat, lon]); else UI.userMarker = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1 }).addTo(UI.map).bindPopup('Вы здесь');
    if (!inPark) UI.map.fitBounds([[lat, lon], [PARK.lat, PARK.lon]], { padding: [40, 40], maxZoom: 16 });
  }
  updateGis(); say(autoLine());
}
function onPosition(p) { setUser(p.coords.latitude, p.coords.longitude, 'gps', p.coords.accuracy); }

// запасной способ: примерное место по сети (если браузер не дал точное положение)
async function ipLocate() {
  for (const u of ['https://ipwho.is/', 'https://ipapi.co/json/']) {
    try {
      const j = await (await fetch(u, { cache: 'no-store' })).json();
      const lat = +(j.latitude ?? j.lat), lon = +(j.longitude ?? j.lon ?? j.lng);
      if (isFinite(lat) && isFinite(lon) && (lat || lon)) return { lat, lon, city: j.city || '' };
    } catch { /* пробуем следующий */ }
  }
  return null;
}
async function geoFallback(reason) {
  $('#geoStatus').innerHTML = reason + '<br>Пробую определить примерно по сети…';
  const r = await ipLocate();
  if (r) { setUser(r.lat, r.lon, 'ip'); $('#geoStatus').innerHTML = reason + '<br>' + $('#geoStatus').innerHTML + `<br><small>Если место неверно или нужны отметки в парке: разрешите геолокацию, нажмите «Указать на карте» или включите демо-режим.</small>`; }
  else $('#geoStatus').innerHTML = reason + '<br>Сеть тоже не помогла. Нажмите «Указать на карте» или включите демо-режим.';
}
function startGeo() {
  if (!window.isSecureContext && location.hostname !== 'localhost') return geoFallback('Браузер разрешает геолокацию только на защищённых страницах (https).');
  if (!navigator.geolocation) return geoFallback('Этот браузер не поддерживает геолокацию.');
  $('#geoStatus').textContent = 'Определяю положение… (если браузер спросит — нажмите «Разрешить»)';
  if (UI.watch) { navigator.geolocation.clearWatch(UI.watch); UI.watch = null; }
  // сначала мягкий запрос: на компьютере без GPS точный режим часто не успевает ответить
  navigator.geolocation.getCurrentPosition(p => {
    onPosition(p);
    UI.watch = navigator.geolocation.watchPosition(onPosition, () => { }, { enableHighAccuracy: false, maximumAge: 20000, timeout: 30000 });
  }, err => {
    if (err.code === 1) geoFallback('🔒 Доступ к геолокации запрещён. Нажмите на замок рядом с адресом страницы → «Разрешить определение местоположения», затем повторите. На Windows ещё проверьте: Параметры → Конфиденциальность → Расположение.');
    else if (err.code === 2) geoFallback('Компьютер не смог определить положение (включите службу расположения и Wi-Fi).');
    else geoFallback('Положение не определилось за отведённое время.');
  }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 });
}
$('#geoBtn').addEventListener('click', startGeo);

// ручной выбор: нажмите на карту — это ваше положение
$('#geoPick').addEventListener('click', () => {
  UI.pick = !UI.pick; $('#geoPick').classList.toggle('on', UI.pick);
  $('#geoStatus').textContent = UI.pick ? '📌 Нажмите на карте место, где вы находитесь.' : 'Выбор на карте отменён.';
  if (UI.map) UI.map.getContainer().style.cursor = UI.pick ? 'crosshair' : '';
});
$('#radiusLbl').textContent = RADIUS_M;
$('#demoMode').addEventListener('change', e => { S.demo = e.target.checked; save(); toast(S.demo ? 'Демо-режим включён: время берётся с ползунка' : 'Демо-режим выключен: нужна геолокация'); });
