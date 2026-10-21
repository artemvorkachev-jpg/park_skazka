/* host.js — игра «Хранитель Сказки»: ИИ-ведущий Кот Баюн (5 ходов, 2–3 варианта, последствия) */
'use strict';

/* ---------- данные игры ---------- */
const GZ = [
  { id: 'dino', name: 'Дино парк', cost: 40, p: { g: 6, m: 2, c: 3 }, animals: false, e: '🦖' },
  { id: 'alpaca', name: 'Альпака парк', cost: 20, p: { g: 3, m: 4, c: 1 }, animals: true, e: '🦙' },
  { id: 'husky', name: 'Хаски-Лэнд', cost: 30, p: { g: 4, m: 4, c: 2 }, animals: true, e: '🐕' },
  { id: 'enot', name: 'Страна ЕНОТиЯ', cost: 25, p: { g: 3, m: 4, c: 1 }, animals: true, e: '🦝' },
  { id: 'rope', name: 'Верёвочный парк', cost: 35, p: { g: 5, m: 1, c: 3 }, animals: false, e: '🧗' },
  { id: 'ostrich', name: 'Страус парк', cost: 20, p: { g: 3, m: 3, c: 1 }, animals: true, e: '🐦' },
  { id: 'aiva', name: 'Парк «Айва»', cost: 25, p: { g: 2, m: 6, c: 0 }, animals: false, e: '🌿' }
];
const GTURNS = [10, 12, 14, 16, 19];
const GOAL = { guests: 120, mood: 70 };
const GQ = { busy: false, ai: null, mock: false };
const sgn = n => (n > 0 ? '+' : '') + n;
const zoneById = id => GZ.find(z => z.id === id);
const gi = n => Math.max(0, Math.round(+n || 0));

/* ---------- связь с сервером ---------- */
async function gameHealth() {
  try { const r = await fetch('/api/health', { cache: 'no-store' }); const j = await r.json(); GQ.ai = !!j.ai; GQ.mock = !!j.mock; } catch { GQ.ai = false; }
  if (UI.screen === 'game') renderGame();
}
async function askHost(ctx) {
  if (GQ.ai === false) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('/api/host', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ctx), signal: ctl.signal });
    const j = await r.json(); return j.ok ? j.data : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/* ---------- контекст для ведущего (реальная погода и статусы) ---------- */
function gWeather(h) {
  const w = wxAt(selDay(), h), W = WX(w.code);
  return { temp: Math.round(w.t), desc: W.t, wind: Math.round(w.wind), rainChance: Math.round(w.p), wet: ['rain', 'storm', 'snow'].includes(W.k) };
}
function gStopped(h) {
  const day = selDay();
  return ATT.map(a => ({ a, s: statusOf(a, day, h) })).filter(x => x.s.k !== 'ok').slice(0, 6).map(x => ({ name: x.a.name, why: x.s.reason, back: x.s.eta }));
}
function gCtx(mode, g, last) {
  const h = GTURNS[Math.min(g.turn, 5) - 1];
  return {
    mode, turn: g.turn, totalTurns: 5, date: longDate(selDay().date), time: pad(h) + ':00', weather: gWeather(h), stoppedRides: gStopped(h),
    state: { coins: g.coins, guests: g.guests, mood: g.mood, built: g.built.map(id => zoneById(id).name), available: GZ.filter(z => !g.built.includes(z.id)).map(z => ({ id: z.id, name: z.name, cost: z.cost, note: z.animals ? 'животные: нужен уход' : 'без животных' })) },
    goal: GOAL, last: last || null
  };
}

/* ---------- проверка ответа ИИ ---------- */
function cleanTurn(d, g) {
  if (!d || typeof d.story !== 'string' || !Array.isArray(d.options)) return null;
  const opts = d.options.slice(0, 3).map(o => {
    const zone = o.build && zoneById(o.build) && !g.built.includes(o.build) ? zoneById(o.build) : null;
    const cl = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
    return {
      label: String(o.label || '').slice(0, 70), hint: String(o.hint || '').slice(0, 120), build: zone ? zone.id : null,
      cost: zone ? zone.cost : cl(o.cost, 0, 60), earn: cl(o.earn, 0, 30), guests: cl(o.guests, -15, 35), mood: cl(o.mood, -25, 25)
    };
  }).filter(o => o.label);
  if (opts.length < 2) return null;
  return { consequence: String(d.consequence || '').slice(0, 500), story: d.story.slice(0, 600), options: opts };
}

/* ---------- резервный ведущий (если нет ключа или связи) ---------- */
function offlineTurn(g, last) {
  const t = g.turn, h = GTURNS[t - 1], w = gWeather(h), unb = GZ.filter(z => !g.built.includes(z.id)).sort((a, b) => a.cost - b.cost);
  const wtxt = `${w.desc}, ${w.temp}°, ветер ${w.wind} м/с`;
  const buildOpt = z => ({ label: `Построить: ${z.name}`, hint: z.animals ? 'Животные радуют гостей, но им нужен уход.' : 'Привлечёт новых гостей.', cost: z.cost, earn: 0, guests: z.p.g * 2 + 6, mood: z.p.m + 2, build: z.id });
  const hasAnimals = g.built.some(id => zoneById(id).animals);
  const stopped = gStopped(h)[0];
  let story, opts = [];
  if (t === 1) {
    story = `Парк «Сказка» открывается: ${wtxt}. У касс ${g.guests} гостей, в казне ${g.coins} монет. С чего начнём?`;
    opts = unb.slice(0, 2).map(buildOpt); opts.push({ label: 'Объявить «Тихий час: монеты ×3»', hint: 'Бесплатно: придут любители спокойствия.', cost: 0, earn: 4, guests: 10, mood: 3, build: null });
  } else if (w.wet) {
    story = `В ${pad(h)}:00 ${w.desc}. Открытые зоны пустеют, гости жмутся под навесами.`;
    opts = [{ label: 'Открыть лабиринты и дома страха', hint: 'Под крышей весело всем.', cost: 10, earn: 6, guests: 14, mood: 6, build: null }, { label: 'Раздать дождевики', hint: 'Дорого, зато настроение выше.', cost: 15, earn: 0, guests: 4, mood: 12, build: null }, { label: 'Переждать дождь', hint: 'Бесплатно, но гости заскучают.', cost: 0, earn: 0, guests: -6, mood: -8, build: null }];
  } else if (w.wind >= 12) {
    story = `В ${pad(h)}:00 ветер ${w.wind} м/с: «Смерч» и колесо обозрения придётся остановить. У касс ропот.`;
    opts = [{ label: 'Остановить и объяснить причину в приложении', hint: 'Честность ценят.', cost: 0, earn: 0, guests: -4, mood: 10, build: null }, { label: 'Раздать горячий чай', hint: 'Смягчит настроение.', cost: 12, earn: 0, guests: 0, mood: 10, build: null }, { label: 'Ничего не менять', hint: 'Гости не поймут, почему стоят.', cost: 0, earn: 0, guests: 0, mood: -20, build: null }];
  } else if (t === 3) {
    story = `В ${pad(h)}:00 к воротам подъехали три автобуса: 30 школьников. Погода: ${wtxt}. Чем их занять?`;
    opts = [{ label: 'Устроить квест по парку', hint: 'Дёшево и весело.', cost: 8, earn: 10, guests: 22, mood: 8, build: null }, { label: 'Скидка на групповые билеты', hint: 'Придёт больше, но касса пострадает.', cost: 0, earn: 0, guests: 28, mood: 2, build: null }, { label: 'Пустить без программы', hint: 'Суета и очереди.', cost: 0, earn: 4, guests: 10, mood: -12, build: null }];
  } else if (t === 4 && stopped) {
    story = `В ${pad(h)}:00 «${stopped.name}» стоит: ${stopped.why.toLowerCase()} (${stopped.back}). Гости спрашивают, что случилось.`;
    opts = [{ label: 'Объяснить причину и срок в приложении', hint: 'Прозрачность успокаивает.', cost: 0, earn: 0, guests: 0, mood: 9, build: null }, { label: 'Предложить гостям другой аттракцион', hint: 'Придётся подвинуть очередь.', cost: 6, earn: 4, guests: 8, mood: 5, build: null }, { label: 'Промолчать', hint: 'Слухи пойдут быстрее.', cost: 0, earn: 0, guests: -4, mood: -14, build: null }];
  } else {
    story = `В ${pad(h)}:00 парк наполнен: ${wtxt}. ${t === 5 ? 'Приближается вечер — последний шанс удивить гостей.' : 'Можно усилить впечатление.'}`;
    opts = unb.slice(0, 1).map(buildOpt);
    if (hasAnimals) opts.push({ label: 'Накормить и вычесать животных', hint: 'Животные довольны — гости тоже.', cost: 8, earn: 0, guests: 6, mood: 12, build: null });
    opts.push(t === 5 ? { label: 'Вечерний салют', hint: 'Дорого, но запомнится.', cost: 30, earn: 0, guests: 20, mood: 14, build: null } : { label: 'Фотосессия с героями парка', hint: 'Дёшево и всем нравится.', cost: 6, earn: 8, guests: 12, mood: 6, build: null });
  }
  return { consequence: last ? offlineConsequence(last) : '', story, options: opts.slice(0, 3) };
}
function offlineConsequence(last) {
  const a = last.applied, tone = a.mood >= 8 ? 'Гостям это очень понравилось.' : a.mood >= 2 ? 'Гости остались довольны.' : a.mood <= -8 ? 'Гости ушли недовольными.' : 'Гости отнеслись спокойно.';
  return `«${last.label}». ${tone} Монеты ${sgn(a.coins)}, гости ${sgn(a.guests)}, настроение ${sgn(a.mood)}.`;
}
function offlineFinal(g, last, win) {
  return { consequence: offlineConsequence(last), epilogue: win ? 'Парк закрылся под аплодисменты: гостей много и все счастливы. Сказка удалась!' : 'День закончился. Парк стал чуть лучше — завтра можно сделать ещё больше.', title: win ? 'Хранитель Сказки' : 'Помощник Кота' };
}

/* ---------- движок хода ---------- */
function applyChoice(g, o) {
  const before = { coins: g.coins, guests: g.guests, mood: g.mood };
  let pg = 0, pm = 0, pc = 0;
  g.built.forEach(id => { const z = zoneById(id); pg += z.p.g; pm += z.p.m; pc += z.p.c; });           // зоны, построенные раньше, работают на этом ходу
  const w = gWeather(GTURNS[g.turn - 1]); let wg = 0, wm = 0;
  if (w.wet) { wg -= 6; wm -= 3; } if (w.wind >= 12) wm -= 4;                                           // реальная погода слота
  if (o.build && !g.built.includes(o.build)) g.built.push(o.build);
  const income = Math.round(g.guests / 10);
  g.coins = Math.max(0, g.coins - o.cost + o.earn + pc + income);
  g.guests = Math.max(0, g.guests + o.guests + pg + wg);
  g.mood = Math.max(0, Math.min(100, g.mood + o.mood + pm + wm));
  return { coins: g.coins - before.coins, guests: g.guests - before.guests, mood: g.mood - before.mood, passive: { coins: pc + income, guests: pg, mood: pm }, weather: { guests: wg, mood: wm } };
}

async function gameStart() {
  if (GQ.busy) return;
  const g = { turn: 1, coins: 100, guests: 40, mood: 60, built: [], log: [], cur: null, done: false, final: null, date: selDay().ds, engine: 'offline' };
  S.game = g; save(); GQ.busy = true; renderGame();
  const ai = cleanTurn(await askHost(gCtx('start', g, null)), g);
  g.cur = ai || offlineTurn(g, null); g.engine = ai ? 'ai' : 'offline';
  GQ.busy = false; save(); renderGame(true);
}
async function gameChoose(k) {
  const g = S.game; if (!g || GQ.busy || g.done) return;
  const o = g.cur.options[k]; if (!o || o.cost > g.coins) return;
  GQ.busy = true;
  const story = g.cur.story, consequenceBefore = g.cur.consequence;
  const applied = applyChoice(g, o);
  const last = { label: o.label, applied: { coins: applied.coins, guests: applied.guests, mood: applied.mood }, passive: applied.passive, weatherEffect: applied.weather };
  g.log.push({ turn: g.turn, story, choice: o.label, applied: last.applied, consequence: '' });
  renderGame();
  if (g.turn >= 5) {
    const win = g.guests >= GOAL.guests && g.mood >= GOAL.mood;
    const ai = await askHost(gCtx('final', g, last));
    const fin = (ai && typeof ai.epilogue === 'string') ? { consequence: String(ai.consequence || '').slice(0, 500), epilogue: ai.epilogue.slice(0, 500), title: String(ai.title || '').slice(0, 40) } : offlineFinal(g, last, win);
    if (!fin.title) fin.title = win ? 'Хранитель Сказки' : 'Помощник Кота';
    fin.win = win; g.log[g.log.length - 1].consequence = fin.consequence; g.final = fin; g.done = true; g.cur = null;
    S.gameBest = Math.max(S.gameBest || 0, g.guests); reward(win ? 150 : 40, win ? 150 : 40);
    if (win) { S.badges.game = '🔮'; }
    save(); GQ.busy = false; renderGame(true); renderTop();
    toast(win ? '🏆 Вы — Хранитель Сказки! +150 💰' : 'День закончен: +40 💰', true);
    return;
  }
  g.turn += 1;
  const ai = cleanTurn(await askHost(gCtx('turn', g, last)), g);
  const next = ai || offlineTurn(g, last);
  g.engine = ai ? 'ai' : 'offline'; g.log[g.log.length - 1].consequence = next.consequence; g.cur = next;
  GQ.busy = false; save(); renderGame(true);
}

/* ---------- интерфейс ---------- */
function typeInto(el, text) {
  clearInterval(typeInto.t); const words = text.split(' '); let i = 0; el.textContent = '';
  typeInto.t = setInterval(() => { el.textContent = words.slice(0, ++i).join(' '); if (i >= words.length) clearInterval(typeInto.t); }, 38);
}
function meter(label, e, v, max, goal, cls) {
  return `<div class="gm ${cls}"><div class="gm-top"><span>${e} ${label}</span><b>${v}</b></div><div class="gm-bar"><i style="width:${Math.min(100, v / max * 100)}%"></i>${goal != null ? `<u style="left:${goal / max * 100}%" title="цель ${goal}"></u>` : ''}</div></div>`;
}
function renderGame(animate) {
  const root = $('#gameRoot'); if (!root) return;
  const g = S.game, eng = GQ.ai === false ? ['off', '🐈 Резервный ведущий (без ИИ)'] : GQ.ai ? ['on', GQ.mock ? '🧪 Пробный режим ведущего' : '✨ ИИ-ведущий онлайн'] : ['off', '…проверяю связь'];
  const day = selDay();
  if (!g) {
    const w = gWeather(12);
    root.innerHTML = `<div class="g-intro"><div class="g-cat">🐈</div><div>
      <h3>Вы — Хранитель Сказки</h3>
      <p>Один день парка, 5 ходов. Стройте зоны, ухаживайте за животными и привлекайте гостей. На каждом ходу Кот Баюн расскажет, что происходит, предложит 2–3 решения и объяснит последствия.</p>
      <ul><li>3 ресурса: 💰 монеты, 👥 гости, 😊 настроение</li><li>Цель: к вечеру <b>${GOAL.guests}+ гостей</b> и настроение <b>${GOAL.mood}+</b></li><li>Дата игры: <b>${longDate(day.date)}</b>, в полдень ${w.desc}, ${w.temp}° — погода настоящая</li></ul>
      <div class="g-engine ${eng[0]}">${eng[1]}</div>
      <button class="btn big" id="gStart">▶ Начать день</button>
      ${S.gameBest ? `<p class="fineprint">Ваш рекорд: ${S.gameBest} гостей</p>` : ''}</div></div>`;
    return;
  }
  const h = GTURNS[Math.min(g.turn, 5) - 1], wthr = gWeather(h);
  const dots = [1, 2, 3, 4, 5].map(n => `<i class="${g.done || n < g.turn ? 'done' : n === g.turn ? 'now' : ''}">${n}</i>`).join('');
  const built = g.built.length ? g.built.map(id => `<span class="bz" title="${zoneById(id).name}">${zoneById(id).e}</span>`).join('') : '<span class="fineprint">Пока ничего не построено</span>';
  let body = '';
  if (GQ.busy) body = `<div class="g-think"><div class="g-cat sm">🐈</div><div class="dots"><i></i><i></i><i></i></div><p>Кот Баюн думает…</p></div>`;
  else if (g.done) {
    const f = g.final;
    body = `<div class="g-end ${f.win ? 'win' : ''}"><div class="g-title">${f.win ? '🏆' : '🌙'} ${esc(f.title)}</div>
      ${f.consequence ? `<p class="g-cons">${esc(f.consequence)}</p>` : ''}<p class="g-epi">${esc(f.epilogue)}</p>
      <div class="g-sum"><span>👥 ${g.guests} гостей</span><span>😊 ${g.mood}%</span><span>💰 ${g.coins}</span><span>🏗 ${g.built.length} зон</span></div>
      <button class="btn big" id="gStart">↺ Сыграть ещё раз</button></div>`;
  } else {
    const cur = g.cur;
    body = `${cur.consequence ? `<div class="g-cons">⬅ ${esc(cur.consequence)}</div>` : ''}
      <div class="g-host"><div class="g-cat sm">🐈</div><div class="bubble g-bubble" id="gStory">${animate ? '' : esc(cur.story)}</div></div>
      <div class="g-opts" id="gOpts">${cur.options.map((o, k) => `<button class="g-opt" data-k="${k}" ${o.cost > g.coins ? 'disabled' : ''}><b>${esc(o.label)}</b><span>${esc(o.hint)}</span>
        <em>${o.cost ? `−${o.cost} 💰` : 'бесплатно'}${o.build ? ` · стройка ${zoneById(o.build).e}` : ''}${o.cost > g.coins ? ' · не хватает монет' : ''}</em></button>`).join('')}</div>`;
  }
  const prev = g.log.length ? `<details class="g-log"><summary>Ход игры (${g.log.length})</summary>${g.log.map(l => `<p><b>Ход ${l.turn}.</b> ${esc(l.choice)} — 💰${sgn(l.applied.coins)} 👥${sgn(l.applied.guests)} 😊${sgn(l.applied.mood)}</p>`).join('')}</details>` : '';
  root.innerHTML = `<div class="g-hud"><div class="g-steps">${dots}</div><div class="g-time">${g.done ? 'День окончен' : `Ход ${g.turn} из 5 · ${pad(h)}:00 · ${WX(wxAt(day, h).code).i} ${wthr.temp}°, ветер ${wthr.wind} м/с`}</div><div class="g-engine ${g.engine === 'ai' && GQ.ai ? 'on' : 'off'} small">${g.engine === 'ai' && GQ.ai ? '✨ ИИ' : '🐈 резерв'}</div></div>
    <div class="g-meters">${meter('Монеты', '💰', g.coins, 200, null, 'c')}${meter('Гости', '👥', g.guests, 200, GOAL.guests, 'g')}${meter('Настроение', '😊', g.mood, 100, GOAL.mood, 'm')}</div>
    <div class="g-built">${built}</div>${body}${prev}<button class="btn small ghost g-reset" id="gReset">Начать заново</button>`;
  if (animate && !GQ.busy && !g.done && g.cur) typeInto($('#gStory'), g.cur.story);
}
document.addEventListener('click', e => {
  if (e.target.closest('#gStart')) gameStart();
  if (e.target.closest('#gReset')) { if (confirm('Начать игру заново?')) { S.game = null; save(); renderGame(); } }
  const o = e.target.closest('.g-opt'); if (o && !o.disabled) gameChoose(+o.dataset.k);
});
