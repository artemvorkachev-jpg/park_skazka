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

