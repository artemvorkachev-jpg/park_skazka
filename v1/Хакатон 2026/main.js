/* main.js — запуск приложения */
'use strict';

function renderAll() {
  if (!UI.days.length) return;
  renderTop(); renderHero(); renderStatusStrip(); drawMap();
  renderCatalogControls(); renderRides(true); renderBoard(); renderRepair();
  renderChapters(); renderRewards(); renderBuild(); renderIdeas(); renderCalendar(); renderDetail();
}

async function boot() {
  initCatalog(); initBuild(); initMap(); updateGis(); renderTop(); gameHealth();
  $('#demoMode').checked = S.demo;
  const [f, c] = await Promise.allSettled([loadForecast(), loadClimate()]);
  UI.forecast = f.status === 'fulfilled' ? f.value : null;
  UI.climate = c.status === 'fulfilled' ? c.value : null;
  if (!UI.forecast) toast('Не удалось получить прогноз погоды — показываю климатический ориентир');
  UI.days = buildDays();
  UI.dateStr = UI.days[0].ds;
  UI.hour = clamp(new Date().getHours() + 1, OPEN_H, CLOSE_H - 1);
  $('#hourSlider').value = UI.hour; $('#hourLabel').textContent = pad(UI.hour) + ':00';
  renderAll();
  go(location.hash.slice(1) || 'map', true);
  checkSubscriptions();
  const n = nextQuestStep();
  if (n && !S.checkins.length) setTimeout(() => say('Мяу! Начнём с «Утра в Сказке»: нажмите «Мой квест» — первые задания можно сделать прямо сейчас.'), 4500);
}
boot();
