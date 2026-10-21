/* build.js — «Стройка»: конструктор аттракционов, оценка интереса, голосование за идеи */
'use strict';

const THEMES = {
  dino: { name: 'Динозавры', e: '🦖', c1: '#2fb5a7', c2: '#f5b83d', bg: ['#123a31', '#0b1f1b'], deco: ['🦖', '🌴'], pop: 1.2, adj: 'Динозаврий' },
  space: { name: 'Космос', e: '🚀', c1: '#8b6bff', c2: '#7de3ff', bg: ['#231a5c', '#0a0722'], deco: ['🚀', '⭐'], pop: 1.1, adj: 'Космический' },
  pirate: { name: 'Пираты', e: '⚓', c1: '#ef6f5e', c2: '#f5b83d', bg: ['#3a2418', '#150d09'], deco: ['⚓', '🦜'], pop: 1.0, adj: 'Пиратский' },
  fairy: { name: 'Русские сказки', e: '🏰', c1: '#e0556b', c2: '#ffd27a', bg: ['#3b1b4a', '#150a1c'], deco: ['🏰', '🧙'], pop: 1.15, adj: 'Сказочный' },
  ocean: { name: 'Подводный мир', e: '🐙', c1: '#1f9d8f', c2: '#7de3ff', bg: ['#0e3b57', '#06141f'], deco: ['🐙', '🌊'], pop: .95, adj: 'Подводный' },
  winter: { name: 'Зимняя сказка', e: '❄️', c1: '#7aa8ff', c2: '#ffffff', bg: ['#27406b', '#0e1830'], deco: ['❄️', '⛄'], pop: .9, adj: 'Снежный' }
};
const BTYPES = {
  coaster: { name: 'Американские горки', ana: 'extreme', cap: 900, area: 2200, cost: 5, noun: 'Вихрь' },
  wheel: { name: 'Колесо', ana: 'family', cap: 700, area: 900, cost: 3, noun: 'Обзор' },
  tower: { name: 'Башня падения', ana: 'extreme', cap: 500, area: 300, cost: 3, noun: 'Прыжок' },
  carousel: { name: 'Карусель', ana: 'kids', cap: 600, area: 350, cost: 2, noun: 'Хоровод' },
  ship: { name: 'Качели-корабль', ana: 'family', cap: 500, area: 500, cost: 2, noun: 'Корабль' },
  dark: { name: 'Дом / лабиринт', ana: 'interactive', cap: 800, area: 700, cost: 2, noun: 'Терем' }
};
const BMODS = { loop: 'Мёртвая петля', lights: 'Подсветка и шоу', fog: 'Туман и эффекты', mascot: 'Персонаж-встречающий', photo: 'Фото-зона', indoor: 'Крытый павильон' };
const SEED_IDEAS = [
  { id: 's1', name: 'Тираннозавр-Экспресс', type: 'coaster', theme: 'dino', thrill: 4, height: 120, mods: ['loop', 'fog'], author: 'Артём, 9 лет', votes: 132 },
  { id: 's2', name: 'Подводное колесо', type: 'wheel', theme: 'ocean', thrill: 2, height: 0, mods: ['lights', 'photo'], author: 'Семья Беловых', votes: 97 },
  { id: 's3', name: 'Башня Кощея', type: 'tower', theme: 'fairy', thrill: 5, height: 140, mods: ['fog'], author: 'Ильдар', votes: 88 },
  { id: 's4', name: 'Космический Хоровод', type: 'carousel', theme: 'space', thrill: 1, height: 80, mods: ['lights', 'mascot'], author: 'Маша, 6 лет', votes: 71 },
  { id: 's5', name: 'Снежный Лабиринт', type: 'dark', theme: 'winter', thrill: 2, height: 100, mods: ['indoor', 'lights'], author: 'Команда «Метель»', votes: 54 }
];
const allIdeas = () => SEED_IDEAS.concat(S.ideas);
const ideaVotes = i => (i.votes || 0) + (S.ideaVotes[i.id] ? 1 : 0);
const B = { type: 'coaster', theme: 'dino', thrill: 3, height: 110, mods: new Set(['lights']), title: '' };

/* ---------- модель (SVG) ---------- */
function modelSVG(c, uid = 'm') {
  const T = THEMES[c.theme], mods = new Set(c.mods), th = c.thrill;
  let s = `<defs><linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg[0]}"/><stop offset="1" stop-color="${T.bg[1]}"/></linearGradient></defs>
    <rect width="320" height="230" rx="18" fill="url(#bg${uid})"/>`;
  for (let i = 0; i < 18; i++) { const r = rnd(i + 3); s += `<circle cx="${(r() * 320) | 0}" cy="${(r() * 120) | 0}" r="${(.6 + r() * 1.2).toFixed(1)}" fill="#fff" opacity="${(.2 + r() * .5).toFixed(2)}"/>`; }
  s += `<rect y="200" width="320" height="30" fill="rgba(0,0,0,.35)"/>`;
  const k = .78 + th * .06, c1 = T.c1, c2 = T.c2;
  if (c.type === 'coaster') {
    const loop = mods.has('loop') || th >= 4;
    s += `<g transform="translate(0,${(200 - 200 * k).toFixed(0)}) scale(1,${k.toFixed(2)})">
      <path d="M10 200 C50 200 60 70 115 70 S170 200 205 160 S265 40 310 120 L310 200Z" fill="${c1}" opacity=".16"/>
      <path d="M10 196 C50 196 60 70 115 70 S170 196 205 156 S265 40 310 118" stroke="${c1}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M10 196 C50 196 60 70 115 70 S170 196 205 156 S265 40 310 118" stroke="#fff" stroke-width="1.5" fill="none" stroke-dasharray="3 6" opacity=".7"/>
      ${loop ? `<circle cx="212" cy="116" r="38" stroke="${c2}" stroke-width="5" fill="none"/>` : ''}
      <rect x="100" y="60" width="26" height="12" rx="4" fill="${c2}"/></g>`;
  } else if (c.type === 'wheel') {
    const r = 54 + th * 5;
    s += `<path d="M160 120 L105 200 M160 120 L215 200" stroke="${c2}" stroke-width="5" stroke-linecap="round"/><circle cx="160" cy="120" r="${r}" stroke="${c1}" stroke-width="5" fill="none"/>`;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, x = 160 + r * Math.cos(a), y = 120 + r * Math.sin(a); s += `<line x1="160" y1="120" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}" stroke="${c1}" stroke-width="1.5" opacity=".7"/><rect x="${(x - 7).toFixed(0)}" y="${(y - 5).toFixed(0)}" width="14" height="11" rx="3" fill="${i % 2 ? c2 : '#fff'}"/>`; }
    s += `<circle cx="160" cy="120" r="7" fill="${c2}"/>`;
  } else if (c.type === 'tower') {
    const top = 200 - (120 + th * 14);
    s += `<rect x="150" y="${top}" width="20" height="${200 - top}" fill="${c1}" opacity=".85"/><rect x="132" y="${top + 28}" width="56" height="12" rx="5" fill="${c2}"/>`;
    for (let i = 0; i < 6; i++) s += `<circle cx="${138 + i * 9}" cy="${top + 46}" r="4" fill="#fff"/>`;
    s += `<path d="M160 ${top - 8} L148 ${top + 4} L172 ${top + 4}Z" fill="${c2}"/><path d="M96 ${top + 40} v40 m-8 -8 l8 8 l8 -8 M224 ${top + 40} v40 m-8 -8 l8 8 l8 -8" stroke="${c2}" stroke-width="3" fill="none" opacity=".7"/>`;
  } else if (c.type === 'carousel') {
    s += `<ellipse cx="160" cy="190" rx="98" ry="16" fill="${c1}" opacity=".5"/><rect x="156" y="70" width="8" height="120" fill="${c2}"/>
      <path d="M52 100 L160 40 L268 100Z" fill="${c1}"/><path d="M52 100 Q160 120 268 100" fill="${c2}" opacity=".8"/>`;
    [[88, 150], [160, 160], [232, 150]].forEach(([x, y], i) => { s += `<line x1="${x}" y1="108" x2="${x}" y2="${y + 4}" stroke="${c2}" stroke-width="3"/><text x="${x}" y="${y + 18}" font-size="${i === 1 ? 30 : 24}" text-anchor="middle">🐎</text>`; });
  } else if (c.type === 'ship') {
    const ang = 20 + th * 6;
    s += `<path d="M95 200 L160 60 L225 200" stroke="${c1}" stroke-width="7" fill="none" stroke-linejoin="round"/><circle cx="160" cy="60" r="8" fill="${c2}"/>
      <g transform="rotate(${-ang} 160 60)"><line x1="160" y1="60" x2="160" y2="170" stroke="${c2}" stroke-width="4"/>
      <path d="M110 170 L210 170 L195 198 L125 198Z" fill="${c1}"/><path d="M160 170 L160 128 L196 170Z" fill="#fff" opacity=".9"/></g>
      <path d="M160 60 L${(160 - 110 * Math.sin(ang * Math.PI / 180)).toFixed(0)} ${(60 + 110 * Math.cos(ang * Math.PI / 180)).toFixed(0)}" stroke="${c2}" stroke-width="1" stroke-dasharray="3 4" opacity=".5"/>`;
  } else {
    s += `<rect x="70" y="105" width="180" height="95" fill="${c1}" opacity=".9"/><path d="M60 108 L160 48 L260 108Z" fill="${c2}"/>
      <rect x="82" y="72" width="26" height="44" fill="${c1}"/><path d="M78 74 L95 48 L112 74Z" fill="${c2}"/><rect x="212" y="72" width="26" height="44" fill="${c1}"/><path d="M208 74 L225 48 L242 74Z" fill="${c2}"/>
      <rect x="140" y="150" width="40" height="50" rx="18" fill="#150a1c"/>`;
    [[92, 128], [128, 128], [192, 128], [228, 128]].forEach(([x, y]) => { s += `<rect x="${x - 8}" y="${y - 8}" width="16" height="22" rx="8" fill="${c2}" opacity="${mods.has('lights') ? 1 : .6}"/>`; });
    s += `<text x="160" y="104" font-size="26" text-anchor="middle">👻</text>`;
  }
  if (mods.has('indoor')) s += `<path d="M18 205 Q18 20 160 20 Q302 20 302 205" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="6 5"/>`;
  if (mods.has('fog')) s += `<ellipse cx="90" cy="205" rx="80" ry="14" fill="#fff" opacity=".16"/><ellipse cx="240" cy="208" rx="86" ry="12" fill="#fff" opacity=".13"/>`;
  if (mods.has('lights')) for (let i = 0; i < 14; i++) { const r = rnd(i + 90); s += `<circle cx="${(30 + r() * 260) | 0}" cy="${(40 + r() * 150) | 0}" r="3" fill="${c2}" opacity=".85"/>`; }
  s += `<text x="26" y="52" font-size="26">${T.deco[0]}</text><text x="284" y="52" font-size="26" text-anchor="middle">${T.deco[1]}</text>`;
  if (mods.has('mascot')) s += `<text x="30" y="222" font-size="22">🐈</text>`;
  if (mods.has('photo')) s += `<text x="292" y="222" font-size="22" text-anchor="middle">📸</text>`;
  return s;
}

/* ---------- оценка ---------- */
function evalIdea(c) {
  const T = THEMES[c.theme], Y = BTYPES[c.type], mods = c.mods.length ?? c.mods.size;
  const analogs = ATT.filter(a => a.type === Y.ana).sort((a, b) => loveScore(b) - loveScore(a));
  const max = loveScore([...ATT].sort((a, b) => loveScore(b) - loveScore(a))[0]);
  const top = analogs[0], second = analogs[1];
  let interest = 38 + (loveScore(top) / max) * 36 + (T.pop - 1) * 40 + mods * 3.5;
  if (c.type === 'coaster' || c.type === 'tower') interest += (c.thrill - 3) * 3; else interest -= Math.max(0, c.thrill - 3) * 3;
  const hasLoop = (c.mods.has ? c.mods.has('loop') : c.mods.includes('loop')) && c.type === 'coaster';
  const cap = Math.round(Y.cap * (1 + mods * .04) * (hasLoop ? .9 : 1) / 10) * 10;
  return {
    interest: clamp(Math.round(interest), 20, 98), top, second, cap,
    area: Math.round(Y.area * (1 + c.thrill * .06) / 50) * 50,
    cost: clamp(Y.cost + (hasLoop ? 1 : 0) + (mods >= 4 ? 1 : 0), 1, 5),
    age: c.height >= 120 ? '10+ лет и взрослые' : c.height >= 100 ? '6+ лет, с родителями' : c.height > 0 ? 'от 3 лет, с родителями' : 'для всех возрастов'
  };
}
const autoName = c => `${THEMES[c.theme].adj} ${BTYPES[c.type].noun}`;

/* ---------- экран «Стройка» ---------- */
function renderBuild() {
  const c = { ...B, mods: B.mods }, ev = evalIdea(c);
  $('#bsvg').innerHTML = modelSVG(c, 'b');
  $('#bname').textContent = B.title || autoName(B);
  $('#bThrillV').textContent = B.thrill; $('#bHeightV').textContent = B.height;
  $('#bstats').innerHTML = `
    <div class="meter"><span>Индекс интереса</span><div class="bar gold"><i style="width:${ev.interest}%"></i></div><b>${ev.interest}</b></div>
    <p class="analog">По аналогам: у «${esc(ev.top.name)}» — ${likesOf(ev.top)} ❤ и ${playsOf(ev.top)} игр${ev.second ? `, у «${esc(ev.second.name)}» — ${likesOf(ev.second)} ❤` : ''}. Тема «${THEMES[B.theme].name}» ${THEMES[B.theme].pop > 1 ? 'сейчас в плюсе' : THEMES[B.theme].pop < 1 ? 'пока менее популярна' : 'в норме'}.</p>
    <div class="badges"><span class="badge">👥 ~${ev.cap} чел./час</span><span class="badge">📐 ~${ev.area} м²</span><span class="badge">💸 класс затрат ${'★'.repeat(ev.cost)}${'☆'.repeat(5 - ev.cost)}</span><span class="badge">🎯 ${ev.age}</span></div>
    <p class="fineprint">Оценки ориентировочные: основаны на рейтинге похожих аттракционов в этом приложении, а не на инженерном расчёте.</p>`;
}
function renderMods() {
  $('#bMods').innerHTML = Object.entries(BMODS).map(([k, t]) => `<button type="button" class="mod ${B.mods.has(k) ? 'on' : ''}" data-mod="${k}">${t}</button>`).join('');
}
function initBuild() {
  renderMods();
  $('#bType').addEventListener('change', e => { B.type = e.target.value; renderBuild(); });
  $('#bTheme').addEventListener('change', e => { B.theme = e.target.value; renderBuild(); });
  $('#bThrill').addEventListener('input', e => { B.thrill = +e.target.value; renderBuild(); });
  $('#bHeight').addEventListener('input', e => { B.height = +e.target.value; renderBuild(); });
  $('#bTitle').addEventListener('input', e => { B.title = e.target.value.trim(); renderBuild(); });
  $('#bMods').addEventListener('click', e => { const k = e.target.dataset?.mod; if (!k) return; B.mods.has(k) ? B.mods.delete(k) : B.mods.add(k); renderMods(); renderBuild(); });
  $('#bSubmit').addEventListener('click', () => {
    const idea = { id: 'u' + Date.now(), name: B.title || autoName(B), type: B.type, theme: B.theme, thrill: B.thrill, height: B.height, mods: [...B.mods], author: 'Вы', votes: 0 };
    S.ideas.push(idea); save(); reward(30, 30);
    toast(`💡 «${idea.name}» отправлена парку (+30 💰)`, true); say(`Мррр, «${idea.name}» — звучит! Зовите друзей голосовать.`);
    renderIdeas(); $('#ideas').scrollIntoView({ behavior: 'smooth' });
  });
  $('#ideas').addEventListener('click', e => {
    const b = e.target.closest('[data-iv]'); if (!b) return;
    if (S.ideaVotes[b.dataset.iv]) return toast('Вы уже голосовали за эту идею');
    S.ideaVotes[b.dataset.iv] = 1; save(); reward(1, 1); toast('Голос учтён (+1 💰)'); renderIdeas();
  });
}
function renderIdeas() {
  const list = allIdeas().sort((a, b) => ideaVotes(b) - ideaVotes(a));
  $('#ideas').innerHTML = list.map((i, n) => {
    const T = THEMES[i.theme], ev = evalIdea({ ...i, mods: new Set(i.mods) });
    return `<article class="idea ${i.author === 'Вы' ? 'mine' : ''}"><div class="idea-img"><svg viewBox="0 0 320 230">${modelSVG({ ...i, mods: i.mods }, 'i' + n)}</svg><span class="rankn">${['🥇', '🥈', '🥉'][n] || '#' + (n + 1)}</span></div>
      <div class="idea-body"><h4>${esc(i.name)}</h4><small>${T.e} ${T.name} · ${BTYPES[i.type].name} · рост ${i.height ? 'от ' + i.height : 'любой'}</small>
      <small>Автор: ${esc(i.author)} · интерес ${ev.interest}</small>
      <div class="idea-row"><b>👍 ${ideaVotes(i)}</b><button class="btn small ${S.ideaVotes[i.id] ? '' : 'ghost'}" data-iv="${i.id}">${S.ideaVotes[i.id] ? 'Вы проголосовали' : 'Хочу такой!'}</button></div></div></article>`;
  }).join('');
}
