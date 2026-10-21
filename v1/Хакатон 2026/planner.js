/* planner.js — планировщик визита: топ-7 аттракционов → состав группы → вопросы Баюну → маршрут с учётом погоды → бонусы по пути.
   Новая концепция UX: сначала интересы гостя, потом его вопросы, потом маршрут и маркетинг — лаконично. */
'use strict';

/* ---------- состояние плана ---------- */
const PLAN_MAX = 7;
const PLAN_STEPS = [
  { n: 1, e: '❤️', t: 'Топ-7' },
  { n: 2, e: '👨‍👩‍👧', t: 'Группа' },
  { n: 3, e: '🐈', t: 'Вопросы' },
  { n: 4, e: '🗺️', t: 'Маршрут' },
  { n: 5, e: '🎁', t: 'Бонусы' }
];
// продолжительность точки маршрута, минут (зоны большие, детские — короткие)
const PLAN_DUR = { zone: 90, extreme: 40, family: 35, kids: 25, interactive: 45 };
const byId = id => ATT.find(a => a.id === id);

function planState() {
  const fresh = { step: 1, picks: [], chat: [], route: null, routeDay: null, routeSig: '', promos: {} };
  if (!S.plan || typeof S.plan !== 'object') S.plan = {};
  Object.keys(fresh).forEach(k => { if (S.plan[k] === undefined) S.plan[k] = fresh[k]; });
  return S.plan;
}
const planPicks = () => planState().picks.map(byId).filter(Boolean);
const planHeights = () => S.family.map(f => f.h);

/* ================= шаг 1: топ-7 ================= */
const PLAN_FILTER = { type: 'all', q: '' };
function renderPickGrid() {
  const P = planState(), picked = new Set(P.picks);
  const list = ATT.filter(a => (PLAN_FILTER.type === 'all' || a.type === PLAN_FILTER.type) && (!PLAN_FILTER.q || a.name.toLowerCase().includes(PLAN_FILTER.q)));
  $('#pGrid').innerHTML = list.map(a => `
    <button type="button" class="pick-card ${picked.has(a.id) ? 'sel' : ''}" data-pick="${a.id}" aria-pressed="${picked.has(a.id)}">
      <span class="pk-mark">${picked.has(a.id) ? '✔' : P.picks.length + 1}</span>
      <img loading="lazy" referrerpolicy="no-referrer" src="${a.img}" alt="">
      <span class="pk-name">${TYPE_EMOJI[a.type]} ${esc(a.name)}</span>
      <span class="pk-meta">рост ${a.hmin ? 'от ' + a.hmin : 'любой'} см · от ${a.priceFrom} ₽</span>
    </button>`).join('') || '<p class="fineprint">Ничего не найдено.</p>';
}
function renderPickStep() {
  const P = planState();
  $('#planBody').innerHTML = `
    <p class="plan-count">Выбрано <b>${P.picks.length}</b> из ${PLAN_MAX} — клик по карточке добавляет и убирает.</p>
    <div class="filters">
      <label class="field">Поиск<input id="pQ" type="search" placeholder="Бумеранг, дино…" value="${esc(PLAN_FILTER.q)}"></label>
    </div>
    <div class="tabs" id="pTypes">
      ${['all', 'extreme', 'family', 'kids', 'interactive', 'zone'].map(t => `<button class="${PLAN_FILTER.type === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? 'Все' : TYPE_EMOJI[t] + ' ' + TYPE_RU[t]}</button>`).join('')}
    </div>
    <div class="pick-grid" id="pGrid"></div>
    <div class="plan-nav"><span class="fineprint">Совет: начните с ❤ из «Топа» — там видно, что нравится гостям.</span>
      <button class="btn big" data-pnav="2" ${P.picks.length ? '' : 'disabled'}>Далее: кто идёт →</button></div>`;
  renderPickGrid();
}
function togglePick(id) {
  const P = planState(), i = P.picks.indexOf(id);
  if (i >= 0) P.picks.splice(i, 1);
  else {
    if (P.picks.length >= PLAN_MAX) return toast(`Максимум ${PLAN_MAX} аттракционов — сначала уберите один`);
    P.picks.push(id);
  }
  save(); renderPickStep();
}

/* ================= шаг 2: состав группы ================= */
function renderGroupStep() {
  const picks = planPicks(), heights = planHeights();
  const fits = picks.map(a => fit(a, heights));
  const allOk = fits.filter(f => f.ok).length;
  $('#planBody').innerHTML = `
    <div class="plan-two">
      <div class="panel">
        <h3>Кто идёт</h3>
        <p class="fineprint">Рост определяет, какие аттракционы доступны. Имена — чтобы Баюн обращался лично.</p>
        ${S.family.map((f, i) => `
          <div class="group-row" data-gi="${i}">
            <input class="g-name" value="${esc(f.name)}" maxlength="16" aria-label="Имя">
            <input class="g-h" type="number" min="50" max="220" value="${f.h}" aria-label="Рост, см" inputmode="numeric"><span class="g-sm">см</span>
            <button class="btn small ghost" data-gdel="${i}" ${S.family.length <= 1 ? 'disabled' : ''} aria-label="Убрать">✕</button>
          </div>`).join('')}
        <div class="group-add">
          <button class="btn small" data-gadd="kid">+ Малыш (110 см)</button>
          <button class="btn small ghost" data-gadd="adult">+ Взрослый (175 см)</button>
        </div>
      </div>
      <div class="panel">
        <h3>Проверка вашего топа</h3>
        ${picks.length ? `
          <ul class="fit-list">${picks.map((a, i) => `<li><span>${TYPE_EMOJI[a.type]} ${esc(a.name)}</span><b class="${fits[i].kind}">${fits[i].ok ? '✅' : fits[i].kind === 'partial' ? '👀' : '⛔'} ${esc(fits[i].why)}</b></li>`).join('')}</ul>
          <p class="g-hint">Доступно всей группе: ${allOk} из ${picks.length}. ⛔-точки лучше заменить на шаге 1.</p>`
        : '<p class="fineprint">Сначала выберите аттракционы на шаге 1.</p>'}
      </div>
    </div>
    <div class="plan-nav"><button class="btn ghost" data-pnav="1">← Топ-7</button><button class="btn big" data-pnav="3">Далее: спросить Баюна →</button></div>`;
}

/* ================= шаг 3: вопросы Баюну ================= */
function chatChips() {
  const picks = planPicks(), minH = Math.min(...planHeights()), chips = [];
  if (picks[0]) chips.push(`Расскажи про «${picks[0].name}»`);
  if (picks[1]) chips.push(`Что сначала: «${picks[0].name}» или «${picks[1].name}»?`);
  chips.push(`Ребёнок ${minH} см — всё ли подходит?`);
  chips.push('Что если в день визита дождь?');
  chips.push('Где поесть на маршруте?');
  chips.push('Сколько времени займёт маршрут?');
  return chips;
}
function renderChatStep() {
  const P = planState();
  $('#planBody').innerHTML = `
    <div class="chat-box">
      <div class="chat-log" id="pChat">${P.chat.length ? P.chat.map(m => `<div class="bub ${m.who}">${m.who === 'cat' ? '🐈 ' : ''}${esc(m.text).replace(/\n/g, '<br>')}</div>`).join('')
        : '<div class="bub cat">🐈 Мяу! Спросите что угодно про ваш топ: рост, очереди, дождь, еда, время. Я знаю состав группы и день визита.</div>'}</div>
      <div class="chat-chips">${chatChips().map(c => `<button type="button" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <form class="chat-form" id="pAsk"><input id="pQ2" type="text" placeholder="Спросите Баюна…" autocomplete="off"><button class="btn">Спросить</button></form>
      <p class="fineprint">В прототипе отвечает офлайн-логика на данных каталога и погодной модели; в боевой версии здесь работает агент Баюн (папка runner/).</p>
    </div>
    <div class="plan-nav"><button class="btn ghost" data-pnav="2">← Группа</button><button class="btn big" data-pnav="4">Далее: маршрут →</button></div>`;
  const log = $('#pChat'); log.scrollTop = log.scrollHeight;
}
function askBayun(q) {
  const log = $('#pChat');
  if (log) {
    log.insertAdjacentHTML('beforeend', `<div class="bub me">${esc(q)}</div><div class="bub cat typing">🐈 …думает</div>`);
    log.scrollTop = log.scrollHeight;
  }
  setTimeout(() => {                                     // офлайн-движок; в бою здесь fetch к агенту Баюну
    const P = planState(), ans = bayunAnswer(q);
    P.chat.push({ who: 'me', text: q }, { who: 'cat', text: ans });
    if (P.chat.length > 40) P.chat.splice(0, P.chat.length - 40);
    save();
    const t = document.querySelector('#pChat .typing'); if (t) t.remove();
    const lg = $('#pChat');
    if (lg) { lg.insertAdjacentHTML('beforeend', `<div class="bub cat">🐈 ${esc(ans).replace(/\n/g, '<br>')}</div>`); lg.scrollTop = lg.scrollHeight; }
  }, 350);
}

/* ---------- офлайн-движок ответов Баюна (данные каталога + погодная модель) ---------- */
function matchAttraction(q) {
  const names = ATT.map(a => ({ a, n: a.name.toLowerCase().replace(/[«»]/g, '') }));
  return (names.find(o => q.includes(o.n)) || names.filter(o => o.n.split(/[\s-]+/).some(w => w.length >= 5 && q.includes(w)))[0] || {}).a || null;
}
function attrLine(a, day) {
  const st = statusOf(a, day, UI.hour), w = waitFor(a, day, UI.hour), best = bestHourFor(a, day);
  return `${TYPE_EMOJI[a.type]} «${a.name}»: ${st.k === 'ok' ? `работает, очередь ~${w} мин, лучше всего в ${pad(best.h)}:00` : `${st.label.toLowerCase()} — ${st.reason} (${st.eta})`}. Рост ${a.hmin ? 'от ' + a.hmin : 'любой'}${a.hmax < 250 ? ' до ' + a.hmax : ''} см, цена от ${a.priceFrom} ₽.`;
}
function bayunAnswer(raw) {
  const q = (raw || '').toLowerCase(), day = selDay(), picks = planPicks(), heights = planHeights(), minH = Math.min(...heights);
  const W = WX(wxAt(day, UI.hour).code), wet = ['rain', 'storm', 'snow'].includes(W.k);
  const a = matchAttraction(q);
  if (/рост|подойд|см\b|низк|малыш/.test(q)) {
    if (!picks.length) return 'Сначала соберите топ-7 на шаге 1 — и я проверю каждую точку по росту.';
    return `С ростом ${heights.join(' и ')} см:\n` + picks.map(x => { const f = fit(x, heights); return `${f.ok ? '✅' : f.kind === 'partial' ? '👀' : '⛔'} «${x.name}» — ${f.why}`; }).join('\n') + '\n⛔-точки советую заменить: кнопка «← Топ-7».';
  }
  if (/дожд|гроз|ветер|погод|зонт|холод/.test(q)) {
    const roofed = picks.filter(x => x.type === 'interactive' || x.type === 'zone');
    const risky = picks.filter(x => x.type === 'extreme');
    return `На ${longDate(day.date)}: ${W.t.toLowerCase()}, ${Math.round(wxAt(day, UI.hour).t)}°.\n• Ливень и гроза: открытые точки мокрые, зато под крышей у вас ${roofed.length ? roofed.map(x => '«' + x.name + '»').join(', ') : 'пока ничего — добавьте 1–2 интерактивных (лабиринты, Дино парк)'}.\n• Ветер от 15 м/с останавливает экстрим${risky.length ? ` — у вас это ${risky.map(x => '«' + x.name + '»').join(', ')}` : ', экстрима в топе нет'}.\nМаршрут на шаге 4 расставит точки так, чтобы непогода застала вас под крышей.`;
  }
  if (/поест|еда|голод|кафе|ресторан|обед|перекус/.test(q)) {
    return `Обед на маршруте ставлю на ~13:00 — между утренними точками и дневным пиком.\n• «Да Блин» — быстрый перекус: блин и какао.\n• «Базилик» — полноценный обед, бизнес-ланч 12:00–15:00.\n• «Сказочные крылья» и фуд-корты — рядом с детскими аттракционами.\nБонусы партнёров по маршруту — на шаге 5.`;
  }
  if (/врем|долго|сколько|успе/.test(q)) {
    if (!picks.length) return 'Соберите топ-7 — и я посчитаю время.';
    const total = picks.reduce((s, x) => s + (PLAN_DUR[x.type] || 40) + waitFor(x, day, UI.hour), 0);
    return `Ваш топ из ${picks.length} точек — примерно ${Math.round(total / 60 * 10) / 10} ч чистыми с очередями, плюс 10–15 минут на переход между зонами.\n${picks.length >= 6 ? 'Насыщенный день: начинайте в 10:00, к открытию очереди минимальны.' : 'Уложитесь с запасом — останется время на обед и фотозоны.'}\nТочная расстановка по часам — шаг 4.`;
  }
  if (/очеред|людно|тихо|когда лучше|загрузк/.test(q)) {
    return `Самый тихий час ${longDate(day.date)} — ${pad(day.bestH.h)}:00 (${qName(day.bestH.load)}), монеты за отметки ×${coinMult(day.bestH.load)}.\n` + (picks.length ? 'По вашим точкам: ' + picks.slice(0, 4).map(x => `«${x.name}» — в ${pad(bestHourFor(x, day).h)}:00`).join(', ') + '.' : 'Соберите топ — скажу лучший час для каждой точки.');
  }
  if (/страшн|страх|боит|экстрим|адреналин/.test(q)) {
    const rank = { extreme: 3, family: 2, interactive: 2, kids: 1, zone: 1 };
    const calm = [...picks].sort((x, y) => rank[x.type] - rank[y.type])[0];
    return `Самая мягкая точка вашего топа — «${calm ? calm.name : 'колесо обозрения'}»${calm ? ` (${TYPE_RU[calm.type].toLowerCase()}, рост ${calm.hmin ? 'от ' + calm.hmin : 'любой'} см)` : ''}.\nЭкстрим в «Сказке» честный: на каждой карточке есть рост и тип ощущений. Самый строгий — «Смерч», от 140 см.\nМаршрут на шаге 4 идёт от спокойных точек к острым — страх раскачивается постепенно.`;
  }
  if (/цен|дорог|бюджет|скидк|стоит/.test(q)) {
    const sum = picks.reduce((s, x) => s + x.priceFrom, 0);
    return `По ценам «от» ваш топ — примерно от ${sum} ₽ на человека за все точки.\nЕсли планируете больше 5–6 катаний, выгоднее безлимит на день: 2 700 ₽ онлайн / 2 900 ₽ в кассе (на 20.10.2026).\nЕда на территории — самая чувствительная часть чека по отзывам: закладывайте 500–1 500 ₽ на человека. Скидки по маршруту — шаг 5.`;
  }
  if (/взять|собой|собра|одежд|экипир/.test(q)) {
    return `На ${longDate(day.date)}: ${W.t.toLowerCase()}, ${Math.round(wxAt(day, UI.hour).t)}°, ветер ${Math.round(wxAt(day, UI.hour).wind)} м/с.\n${wet ? '• Дождевик: открытые точки работают, но мокрые.\n' : ''}${wxAt(day, UI.hour).t >= 22 ? '• Вода и головные уборы — будет жарко.\n' : ''}${wxAt(day, UI.hour).t <= 5 ? '• Тёплые слои и перчатки — на высоте заметно холоднее.\n' : ''}• Заряженный телефон: отметки на маршруте дают монеты.\n• Рост детей держите в «Группе» актуальным — от него зависят допуски.`;
  }
  if (/что сначала|с чего начал|порядок|очерёдност|маршрут/.test(q)) {
    if (!picks.length) return 'Соберите топ-7 — и я разложу точки по часам.';
    const order = [...picks].sort((x, y) => TYPE_PEAK[x.type][0] - TYPE_PEAK[y.type][0]);
    return `Держите такой порядок: ${order.map(x => '«' + x.name + '»').join(' → ')}.\nЛогика: спокойные и детские точки — до обеда, экстрим — после, когда малыши спят в колясках, а очередь на острых короче. Полный маршрут по часам — шаг 4.`;
  }
  if (a) return attrLine(a, day) + '\n' + (planState().picks.includes(a.id) ? 'Она уже в вашем маршруте — увижу её на шаге 4.' : 'Добавьте её в топ на шаге 1 — и я поставлю в маршрут.');
  return 'Спросите про конкретный аттракцион, рост, очереди, погоду, еду или время — а можно просто нажать кнопку под чатом.';
}

/* ================= шаг 4: маршрут дня ================= */
function suggestAlt(a, day, heights) {
  return ATT.filter(x => x.type === a.type && !planState().picks.includes(x.id) && fit(x, heights).ok)
    .filter(x => [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].some(h => statusOf(x, day, h).k === 'ok'))
    .sort((x, y) => loveScore(y) - loveScore(x))[0] || null;
}
function buildRoute() {
  const day = selDay(), heights = planHeights(), picks = planPicks();
  const items = [], missed = [];
  const taken = new Set();
  let cursor = 10, overflow = 0;
  const sorted = [...picks].sort((x, y) => TYPE_PEAK[x.type][0] - TYPE_PEAK[y.type][0]);
  for (const a of sorted) {
    const open = h => statusOf(a, day, h).k === 'ok';
    // ищем наименее людной час в окне; лёгкий бонус ранним часам держит день в хронологическом порядке
    const scan = (from, to, freeOnly) => {
      let b = null;
      for (let h = Math.max(10, from); h <= Math.min(19, to); h++) {
        if (!open(h) || (freeOnly && taken.has(h))) continue;
        const l = attLoad(a, day, h) + (h - 10) * 0.8;
        if (!b || l < b.l) b = { h, l };
      }
      return b;
    };
    let best = scan(cursor, cursor + 5, true) || scan(cursor, 19, true) || scan(10, cursor - 1, true) || scan(10, 19, false);
    const shifted = !!best && best.h < cursor;
    if (!best) { const st = statusOf(a, day, 13); missed.push({ a, st, alt: suggestAlt(a, day, heights) }); continue; }
    const dur = PLAN_DUR[a.type] || 40;
    items.push({ a, h: best.h, dur, wait: waitFor(a, day, best.h), shifted });
    taken.add(best.h);
    cursor = Math.max(cursor, best.h) + Math.ceil(dur / 60);
    if (cursor > 21) { overflow = picks.length - items.length - missed.length; break; }
  }
  items.sort((x, y) => x.h - y.h);
  return { items, missed, overflow };
}
function routeSig() { return planState().picks.join(',') + '|' + S.family.map(f => f.h).join(','); }
function renderRouteStep(force) {
  const P = planState(), day = selDay(), W = WX(wxAt(day, UI.hour).code);
  if (force || !P.route || P.routeDay !== day.ds || P.routeSig !== routeSig()) {
    P.route = buildRoute(); P.routeDay = day.ds; P.routeSig = routeSig(); save();
  }
  const R = P.route, totalMin = R.items.reduce((s, it) => s + it.dur + it.wait, 0);
  const roofed = R.items.filter(it => it.a.type === 'interactive' || it.a.type === 'zone').length;
  $('#planBody').innerHTML = `
    <div class="route-head">
      <p><b>${longDate(day.date)}</b> · ${W.i} ${W.t.toLowerCase()} · загрузка ${qName(day.hours.find(x => x.h === UI.hour)?.load ?? 40)}</p>
      <button class="btn small ghost" data-pact="rebuild">↻ Перестроить</button>
      <a class="btn small ghost" data-go="when" href="#when">Изменить день</a>
    </div>
    ${!planPicks().length ? '<p class="fineprint">Топ-7 пуст — вернитесь к шагу 1.</p>' : `
    <ol class="route-list">${R.items.map(it => `
      <li class="route-item">
        <span class="route-time">${pad(it.h)}:00<small>–${pad(Math.min(21, it.h + Math.ceil(it.dur / 60)))}:00</small></span>
        <div class="route-main"><b>${TYPE_EMOJI[it.a.type]} ${esc(it.a.name)}</b>
          <small>очередь ~${it.wait} мин · ${it.shifted ? 'время сдвинуто из-за статуса' : 'наименее людной час'} · ${fit(it.a, planHeights()).kind !== 'ok' ? `👀 ${esc(fit(it.a, planHeights()).why)}` : 'подходит всей группе'}</small>
        </div>
        <button class="btn small ghost" data-open="${it.a.id}">Подробнее</button>
      </li>`).join('')}</ol>
    ${R.missed.map(m => `<div class="warn-card">🔴 «${esc(m.a.name)}» в этот день не работает: ${esc(m.st.reason.toLowerCase())} (${esc(m.st.eta)}). ${m.alt ? `<button class="btn small" data-swap="${m.a.id}|${m.alt.id}">Заменить на «${esc(m.alt.name)}»</button>` : 'Подберите замену на шаге 1.'}</div>`).join('')}
    ${R.overflow > 0 ? `<div class="warn-card">⏳ Ещё ${R.overflow} точк(и) не вместилось в день — уберите что-то или приходите к открытию.</div>` : ''}
    <div class="route-sum">
      <span>⏱ ~${Math.round(totalMin / 60 * 10) / 10} ч с очередями</span>
      <span>📍 точек: ${R.items.length} из ${planPicks().length}</span>
      <span>🌧 под крышей: ${roofed}</span>
      <span>⭐ тихий час: ${pad(day.bestH.h)}:00</span>
    </div>
    <p class="fineprint">Время — оценка модели загрузки (день недели, погода, праздники), не живые данные парка. Между зонами закладывайте 10–15 минут ходьбы.</p>`}
    <div class="plan-nav"><button class="btn ghost" data-pnav="3">← Вопросы</button><button class="btn big" data-pnav="5" ${R.items.length ? '' : 'disabled'}>Далее: бонусы →</button></div>`;
}

/* ================= шаг 5: бонусы по пути ================= */
const PROMOS = [
  { id: 'lunch', e: '🥞', t: '13:00 · «Да Блин»: блин + какао по браслету плана −20%', c: 15 },
  { id: 'bazilik', e: '🍝', t: '«Базилик»: бизнес-ланч 12:00–15:00, компот в подарок', c: 10 },
  { id: 'photo', e: '📸', t: 'Фотозона у колеса: код BAYUN-FOTO даёт −10% на печать', c: 10, need: () => planPicks().some(a => a.id === 30) },
  { id: 'tea', e: '🍵', t: 'Отметьте 3 точки маршрута — чай в подарок (код BAYUN-TEA)', c: 15 },
  { id: 'finale', e: '🎟️', t: 'Финал дня: бонусный билет на карусель (код BAYUN-RIDE)', c: 20, need: () => planPicks().some(a => a.type === 'kids' || a.type === 'family') }
];
function renderPromoStep() {
  const P = planState(), list = PROMOS.filter(p => !p.need || p.need());
  $('#planBody').innerHTML = `
    <p class="fineprint">Лаконичные задания по маршруту — выполняются почти сами. Партнёры и условия в прототипе демонстрационные, в бою их задаёт парк.</p>
    <div class="promo-list">${list.map(p => P.promos[p.id]
      ? `<div class="promo-row done"><span>${p.e} ${esc(p.t)}</span><b>✔ +${p.c} 💰</b></div>`
      : `<div class="promo-row"><span>${p.e} ${esc(p.t)}</span><button class="btn small" data-promo="${p.id}" data-c="${p.c}">Выполнить +${p.c} 💰</button></div>`).join('')}</div>
    <div class="plan-nav"><button class="btn ghost" data-pnav="4">← Маршрут</button><a class="btn big" href="#map" data-go="map">В парк! 🎡</a></div>`;
}

/* ================= каркас и события ================= */
function renderPlanner() {
  const P = planState();
  $('#planSteps').innerHTML = PLAN_STEPS.map(s => `<button type="button" class="pstep ${s.n === P.step ? 'on' : s.n < P.step ? 'done' : ''}" data-pnav="${s.n}"><i>${s.e}</i><span>${s.t}</span></button>`).join('');
  [renderPickStep, renderGroupStep, renderChatStep, renderRouteStep, renderPromoStep][P.step - 1]();
}
$('#s-plan').addEventListener('click', e => {   // общий контейнер: и степпер (#planSteps), и тело шага (#planBody)
  const P = planState();
  const nav = e.target.closest('[data-pnav]');
  if (nav) { P.step = clamp(+nav.dataset.pnav, 1, 5); save(); renderPlanner(); return; }
  const t = e.target.closest('#pTypes button');
  if (t) { PLAN_FILTER.type = t.dataset.t; renderPickStep(); return; }
  const pick = e.target.closest('[data-pick]');
  if (pick) { togglePick(+pick.dataset.pick); return; }
  const gadd = e.target.closest('[data-gadd]');
  if (gadd) { S.family.push(gadd.dataset.gadd === 'kid' ? { name: `Малыш ${S.family.length + 1}`, h: 110 } : { name: 'Взрослый', h: 175 }); save(); renderPlanner(); return; }
  const gdel = e.target.closest('[data-gdel]');
  if (gdel) { S.family.splice(+gdel.dataset.gdel, 1); save(); renderPlanner(); return; }
  const chip = e.target.closest('[data-chip]');
  if (chip) { askBayun(chip.dataset.chip); return; }
  const swap = e.target.closest('[data-swap]');
  if (swap) { const [from, to] = swap.dataset.swap.split('|').map(Number); P.picks = P.picks.map(id => id === from ? to : id); save(); renderRouteStep(true); return; }
  const promo = e.target.closest('[data-promo]');
  if (promo) { P.promos[promo.dataset.promo] = 1; save(); reward(+promo.dataset.c, +promo.dataset.c); toast(`Бонус отмечен: +${promo.dataset.c} 💰`, true); renderPromoStep(); return; }
  const open = e.target.closest('[data-open]');
  if (open) { openRide(+open.dataset.open); return; }
  if (e.target.closest('[data-pact="rebuild"]')) renderRouteStep(true);
});
$('#planBody').addEventListener('change', e => {
  const row = e.target.closest('.group-row'); if (!row) return;
  const i = +row.dataset.gi;
  if (e.target.classList.contains('g-name')) S.family[i].name = e.target.value.trim() || `Гость ${i + 1}`;
  if (e.target.classList.contains('g-h')) S.family[i].h = clamp(+e.target.value || 110, 50, 220);
  save(); renderPlanner();
});
$('#planBody').addEventListener('input', e => {
  if (e.target.id === 'pQ') {
    PLAN_FILTER.q = e.target.value.trim();
    const g = $('#pGrid'); if (g) renderPickGrid();                // перерисовываем только сетку, чтобы не терять фокус
  }
});
$('#planBody').addEventListener('submit', e => {
  if (e.target.id !== 'pAsk') return;
  e.preventDefault();
  const inp = $('#pQ2'), q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  askBayun(q);
});
