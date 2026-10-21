/* quest.js — сюжетный квест, викторины, мини-игра, награды */
'use strict';

const shuffle = (arr, seed = Date.now()) => { const r = rnd(seed % 99991), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fact = (q, right, wrong, say) => ({ q, options: shuffle([right, ...wrong].map(String), q.length), answer: String(right), say });

/* ---------- викторины (факты — с сайта парка и из модели) ---------- */
const QUIZ = {
  time: () => {
    const d = selDay(), best = d.bestH, worse = d.hours.filter(x => x.h !== best.h && x.load > best.load + 15).sort((a, b) => b.load - a.load).slice(0, 3);
    const opts = shuffle([best, ...worse].map(x => pad(x.h) + ':00'), d.bestH.h);
    return { q: `Когда ${longDate(d.date)} в парке тише всего (до 18:00)?`, options: opts, answer: pad(best.h) + ':00', say: `Верно! В ${pad(best.h)}:00 загрузка ~${best.load}%, монеты ×${coinMult(best.load)}.` };
  },
  smerch: () => fact('С какого роста можно кататься на «Смерче»?', byName('Смерч').hmin + ' см', ['100 см', '110 см', '125 см'], 'Да, от 140 см — это один из самых высоких порогов в парке.'),
  star: () => fact('Какова высота свободного падения на «Звездопаде»?', '40 метров', ['25 метров', '55 метров', '70 метров'], 'Верно, 40 метров свободного падения!'),
  dino: () => fact('Какого года самая масштабная новинка «Дино сафари»?', '2023', ['2019', '2021', '2025'], 'Да, «Дино сафари» — новинка 2023 года.'),
  mirror: () => fact('С какого роста пускают в «Зеркальный лабиринт»?', byName('Зеркальный лабиринт').hmin + ' см', ['0 см', '70 см', '120 см'], 'Верно!'),
  wheel: () => fact('Какова высота колеса обозрения в «Сказке»?', '55 метров', ['30 метров', '42 метра', '75 метров'], 'Верно, 55 метров — отличный вид на Крылатское!')
};

/* ---------- главы ---------- */
const CHAPTERS = [
  { id: 'c1', e: '🌅', title: 'Утро в Сказке', sub: 'Задания до визита — можно выполнить дома', reward: 60, badge: '🌅', steps: [
    { id: 'c1a', type: 'quiz', quiz: 'time', text: 'Угадайте самый тихий час визита' },
    { id: 'c1b', type: 'quiz', quiz: 'smerch', text: 'Проверьте знание правил роста' },
    { id: 'c1c', type: 'like', text: 'Выберите любимый аттракцион (❤)' }] },
  { id: 'c2', e: '🦖', title: 'Дино-экспедиция', sub: 'Тайны Дино парка и Дино сафари', reward: 120, badge: '🦖', steps: [
    { id: 'c2a', type: 'checkin', pick: ['Дино парк'], alt: ['Страус парк'], text: 'Отметьтесь в Дино парке' },
    { id: 'c2b', type: 'checkin', pick: ['Дино сафари'], alt: ['Альпака'], text: 'Отметьтесь в Дино сафари' },
    { id: 'c2c', type: 'quiz', quiz: 'dino', text: 'Ответьте на вопрос про «Дино сафари»' }] },
  { id: 'c3', e: '🦙', title: 'Друзья Кота', sub: 'Звериная поляна: альпаки, страусы, хаски', reward: 120, badge: '🦙', steps: [
    { id: 'c3a', type: 'checkin_type', t: 'zone', n: 3, text: 'Побывайте в 3 тематических зонах' },
    { id: 'c3b', type: 'game', n: 1, text: 'Сыграйте в мини-игру на любом аттракционе' }] },
  { id: 'c4', e: '🎢', title: 'Вихрь и Молния', sub: 'Для смелых: экстремальные аттракционы', reward: 150, badge: '⚡', steps: [
    { id: 'c4a', type: 'checkin_type', t: 'extreme', n: 2, text: 'Прокатитесь на 2 экстремальных аттракционах' },
    { id: 'c4b', type: 'quiz', quiz: 'star', text: 'Вопрос про «Звездопад»' }] },
  { id: 'c5', e: '👻', title: 'Тайны Бабы Яги', sub: 'Лабиринты и дома с секретами', reward: 120, badge: '👻', steps: [
    { id: 'c5a', type: 'checkin_type', t: 'interactive', n: 2, text: 'Пройдите 2 интерактивных дома или лабиринта' },
    { id: 'c5b', type: 'quiz', quiz: 'mirror', text: 'Вопрос про «Зеркальный лабиринт»' }] },
  { id: 'c6', e: '🎠', title: 'Страна малышей', sub: 'Для самых маленьких героев', reward: 100, badge: '🎠', steps: [
    { id: 'c6a', type: 'checkin_type', t: 'kids', n: 3, text: 'Прокатитесь на 3 детских аттракционах' },
    { id: 'c6b', type: 'quiz', quiz: 'wheel', text: 'Вопрос про колесо обозрения' }] }
];
const FINAL = { id: 'cf', e: '🔮', title: 'Хранитель Сказки', reward: 300 };

const distinctCheckins = t => new Set(S.checkins.filter(c => ATT.find(a => a.id === c.id)?.type === t).map(c => c.id)).size;
function pickState(step) {
  const day = selDay(), h = UI.hour;
  const main = step.pick.map(byName).filter(Boolean), alt = (step.alt || []).map(byName).filter(Boolean);
  const mainOpen = main.filter(a => isOpen(a, day, h));
  const useAlt = !mainOpen.length;
  return { main, alt, useAlt, cands: useAlt ? alt.filter(a => isOpen(a, day, h)) : mainOpen, closed: main.filter(a => !isOpen(a, day, h)) };
}
function stepDone(step) {
  if (S.quest[step.id]) return true;
  if (step.type === 'like') return Object.keys(S.likes).length >= 1;
  if (step.type === 'game') return Object.values(S.plays).reduce((s, x) => s + x, 0) >= step.n;
  if (step.type === 'checkin_type') return distinctCheckins(step.t) >= step.n;
  if (step.type === 'checkin') { const ids = new Set(S.checkins.map(c => c.id)); return [...step.pick, ...(step.alt || [])].some(n => ids.has(byName(n)?.id)); }
  return false;
}
function questProgress() {
  let msg = '';
  CHAPTERS.forEach(ch => {
    ch.steps.forEach(s => { if (!S.quest[s.id] && stepDone(s)) S.quest[s.id] = Date.now(); });
    if (!S.chapters[ch.id] && ch.steps.every(s => S.quest[s.id])) {
      S.chapters[ch.id] = Date.now(); S.badges[ch.id] = ch.badge; save(); reward(ch.reward, ch.reward);
      msg += ` · 🏆 глава «${ch.title}» +${ch.reward}`;
    }
  });
  if (!S.chapters.cf && CHAPTERS.every(c => S.chapters[c.id])) { S.chapters.cf = Date.now(); S.badges.cf = '🔮'; save(); reward(FINAL.reward, FINAL.reward); msg += ` · 🔮 Хранитель Сказки +${FINAL.reward}`; }
  save();
  return msg;
}
function nextQuestStep() {
  for (const ch of CHAPTERS) for (const s of ch.steps) if (!S.quest[s.id]) return { text: s.text, chapter: ch.title };
  return null;
}

/* ---------- экран квеста ---------- */
function renderLevel() {
  const li = levelOf(S.xp), cur = LEVELS[li], nxt = LEVELS[li + 1];
  const pct = nxt ? Math.round((S.xp - cur.xp) / (nxt.xp - cur.xp) * 100) : 100;
  const badges = Object.values(S.badges).filter(b => typeof b === 'string' && !b.startsWith('1')).join(' ');
  $('#levelCard').innerHTML = `<div class="lv-badge">${cur.e}</div><div class="lv-mid"><div class="lv-name">${cur.name}</div><div class="lv-bar"><i style="width:${pct}%"></i></div>
    <small>${nxt ? `${S.xp} / ${nxt.xp} опыта до «${nxt.name}»` : 'Максимальный уровень!'}</small><div class="lv-badges">${badges || '<small>Значки глав появятся здесь</small>'}</div></div><div class="lv-coins">💰 ${S.coins}</div>`;
}
function renderChapters() {
  questProgress();
  renderLevel();
  const day = selDay(), h = UI.hour;
  $('#chapters').innerHTML = CHAPTERS.map(ch => {
    const done = ch.steps.filter(s => S.quest[s.id]).length, fin = !!S.chapters[ch.id];
    return `<article class="chap ${fin ? 'fin' : ''}"><header><span class="ce">${fin ? '✅' : ch.e}</span><div><h3>${ch.title}</h3><small>${ch.sub}</small></div><span class="cp">${done}/${ch.steps.length}<br><small>+${ch.reward} 💰</small></span></header>
      <ul>${ch.steps.map(s => {
        const ok = !!S.quest[s.id]; let extra = '', btn = '';
        if (s.type === 'checkin') {
          const p = pickState(s);
          if (!ok && p.useAlt) extra = `<div class="swap">⚠ ${p.closed.map(a => `«${esc(a.name)}»: ${esc(statusOf(a, day, h).reason.toLowerCase())}`).join('; ')}. Задание заменено — подойдёт ${p.alt.map(a => '«' + esc(a.name) + '»').join(' или ')}.</div>`;
          const t = p.cands[0] || p.alt[0] || p.main[0];
          if (!ok && t) btn = `<button class="btn small" data-quest="open" data-id="${t.id}">К аттракциону</button>`;
        }
        if (s.type === 'checkin_type' && !ok) { const have = distinctCheckins(s.t), open = ATT.filter(a => a.type === s.t && isOpen(a, day, h)).length; extra = `<div class="swap soft">Отмечено ${have} из ${s.n} · сейчас доступно ${open}</div>`; btn = `<button class="btn small" data-quest="map">На карту</button>`; }
        if (s.type === 'quiz' && !ok) btn = `<button class="btn small" data-quest="quiz" data-q="${s.quiz}" data-step="${s.id}">Ответить</button>`;
        if (s.type === 'like' && !ok) btn = `<button class="btn small" data-quest="rides">Выбрать</button>`;
        if (s.type === 'game' && !ok) btn = `<button class="btn small" data-quest="game">Играть</button>`;
        return `<li class="${ok ? 'ok' : ''}"><i>${ok ? '✔' : '○'}</i><div><span>${s.text}</span>${extra}</div>${btn}</li>`;
      }).join('')}</ul></article>`;
  }).join('') + `<article class="chap final ${S.chapters.cf ? 'fin' : ''}"><header><span class="ce">${FINAL.e}</span><div><h3>${FINAL.title}</h3><small>Пройдите все главы — получите титул</small></div><span class="cp">${CHAPTERS.filter(c => S.chapters[c.id]).length}/${CHAPTERS.length}<br><small>+${FINAL.reward} 💰</small></span></header></article>`;
}
$('#chapters').addEventListener('click', e => {
  const b = e.target.closest('[data-quest]'); if (!b) return;
  const k = b.dataset.quest;
  if (k === 'open') { go('map'); openRide(+b.dataset.id); }
  if (k === 'map') go('map');
  if (k === 'rides') go('rides');
  if (k === 'game') { const a = [...ATT].sort((x, y) => loveScore(y) - loveScore(x)).find(x => isOpen(x, selDay(), UI.hour)) || ATT[0]; openGame(a); }
  if (k === 'quiz') openQuiz(b.dataset.q, b.dataset.step);
});

/* ---------- викторина ---------- */
function openQuiz(key, stepId) {
  const qz = QUIZ[key](); UI.quizNow = { ...qz, stepId };
  modal(`<h3>🧠 ${esc(qz.q)}</h3><div class="quiz">${qz.options.map(o => `<button class="btn ghost" data-m="ans" data-v="${esc(o)}" data-keep="1">${esc(o)}</button>`).join('')}</div><p class="fineprint">Ответ без штрафа — можно пробовать ещё.</p>`,
    (m, el) => {
      const qn = UI.quizNow;
      if (el.dataset.v === qn.answer) {
        S.quest[qn.stepId] = Date.now(); save(); closeModal(); reward(15, 15); toast(`✔ ${qn.say} +15 💰`, true); say(qn.say);
        refreshAfterWorld();
      } else { el.disabled = true; el.classList.add('wrong'); toast('Не совсем — попробуйте ещё'); }
    });
}

/* ---------- мини-игра «Лови золото» ---------- */
const G = { run: false };
function openGame(a) {
  const base = { extreme: 1.6, kids: .9, family: 1.1, interactive: 1.0, zone: 1.0 }[a.type] || 1.1;
  Object.assign(G, { a, round: 1, total: 0, base, t0: performance.now(), c: .5, w: .1, run: true });
  const newRound = () => { G.round++; G.c = .25 + Math.random() * .5; G.w = Math.max(.05, .1 - G.round * .012); G.t0 = performance.now(); paintZone(); $('#gr').textContent = G.round; };
  const paintZone = () => { const z = $('#gzone'); if (z) { z.style.left = (G.c - G.w) * 100 + '%'; z.style.width = G.w * 200 + '%'; } };
  modal(`<h3>🎮 ${esc(a.name)}</h3><p>Остановите бегунок в золотой зоне — чем точнее, тем больше очков. Три раунда.</p>
    <div class="gbar"><div class="gzone" id="gzone"></div><div class="gpin" id="gpin"></div></div>
    <div class="gscore">Раунд <b id="gr">1</b>/3 · очки <b id="gs">0</b></div>
    <button class="btn big" data-m="stop" data-keep="1">СТОП!</button>`, (m) => {
    if (m !== 'stop' || !G.run) return;
    const p = G.p, d = Math.abs(p - G.c), pts = d <= G.w ? Math.round(100 - d / G.w * 30) : Math.max(0, Math.round(70 - (d - G.w) * 300));
    G.total += pts; $('#gs').textContent = G.total; toast(pts >= 85 ? `Идеально! +${pts}` : pts >= 50 ? `Неплохо: +${pts}` : `Мимо: +${pts}`);
    if (G.round >= 3) {
      G.run = false; closeModal();
      const got = recordPlay(a, G.total), stars = G.total >= 240 ? '⭐⭐⭐' : G.total >= 150 ? '⭐⭐' : '⭐';
      modal(`<h3>${stars} ${G.total} очков</h3><p>Ваша игра засчитана аттракциону «${esc(a.name)}» — так мы видим, что нравится гостям.${got ? ` <b>+${got} 💰</b>` : ' <small>(монеты за игры — 5 в день)</small>'}</p>
        <div class="modal-row"><button class="btn" data-m="again">Ещё раз</button><button class="btn ghost" data-m="like">❤ Нравится</button><button class="btn ghost" data-m="close">Закрыть</button></div>`,
        mm => { if (mm === 'again') setTimeout(() => openGame(a), 30); if (mm === 'like' && !S.likes[a.id]) toggleLike(a); });
    } else newRound();
  });
  paintZone();
  const loop = t => {
    if (!G.run || $('#modalBg').hidden) { G.run = false; return; }
    const x = ((t - G.t0) / 1000) * G.base * 0.9; G.p = Math.abs((x % 2) - 1);
    const pin = $('#gpin'); if (pin) pin.style.left = G.p * 100 + '%';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ---------- награды ---------- */
const REWARDS = [
  { id: 'tea', e: '🍵', name: 'Горячий чай в подарок', cost: 120, code: 'BAYUN-TEA' },
  { id: 'photo', e: '📸', name: 'Скидка 10% на фото-зону', cost: 200, code: 'BAYUN-FOTO' },
  { id: 'ride', e: '🎟️', name: 'Бонусный билет на карусель', cost: 350, code: 'BAYUN-RIDE' },
  { id: 'cat', e: '🐈', name: 'Значок «Друг Кота Баюна»', cost: 500, code: 'BAYUN-BADGE' }
];
function renderRewards() {
  $('#rewards').innerHTML = REWARDS.map(r => S.rewards[r.id]
    ? `<div class="rw owned"><span>${r.e} ${r.name}</span><code>${r.code}</code></div>`
    : `<div class="rw"><span>${r.e} ${r.name}</span><button class="btn small" data-r="${r.id}" ${S.coins < r.cost ? 'disabled' : ''}>${r.cost} 💰</button></div>`).join('');
}
$('#rewards').addEventListener('click', e => {
  const r = REWARDS.find(x => x.id === e.target.dataset?.r); if (!r || S.coins < r.cost) return;
  S.coins -= r.cost; S.rewards[r.id] = 1; save(); renderTop(); renderRewards(); renderLevel(); toast(`Награда получена: ${r.name}`, true); say('Мур! Теперь вы — друг Кота Баюна.');
});
$('#resetBtn').addEventListener('click', () => { if (confirm('Сбросить монеты, квест, голоса и ваши идеи?')) { S = defaults(); save(); renderAll(); toast('Прогресс сброшен'); } });
