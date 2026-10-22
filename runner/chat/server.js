// Чат-адаптер над runner.js: HTTP + SSE для веб-интерфейса Баюна.
// Запуск: node chat/server.js  (из папки runner/ или откуда угодно — пути относительные)
// Зависимости: только Node.js 18+. Ключи и модель берёт сам runner.js (.env, agent/).
//
// Протокол:
//   GET  /            — страница «спланируй визит → спроси Баюна» (index.html рядом с этим файлом)
//   GET  /dashboard   — маркетинговый дашборд (dashboard.html); данные закрыты токеном, см. ниже
//   GET  /game        — игра «Прогулка по парку» (game.html): симуляция визита на выбранную дату
//   GET  /map.svg     — схема парка без легенды для игры (map.svg рядом с этим файлом)
//   GET  /health      — {"ok":true}
//   POST /api/chat    — тело { message: string, history?: [...], context?: {visitId?, date?, group?, picks?} }
//                       ответ — text/event-stream, события runner.js построчно:
//                       session_start / turn_start / assistant_delta / assistant_final /
//                       tool_start / tool_end / error / done {answer}
//   POST /api/visits  — заявка визита {id, date?, time?, group?, picks?, route?} — в store.js
//   GET  /api/weather — погода на дату/час (кэш 30 мин, таймаут 6 с; источник — Open-Meteo)
//   GET  /api/stats   — агрегаты для дашборда; если задан DASHBOARD_TOKEN, требует ?token=...
//
// runner.js — одноразовый процесс на один запрос: на каждое сообщение чата
// запускается новый runner, история диалога, конфигурация гостей и маршрут дня
// передаются в промпте (см. buildPrompt). Реплики диалога (вопрос + ответ Баюна)
// логируются в dialogue.jsonl (store.js).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStats, logDialogue, normalizeVisit, saveVisit } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = resolve(__dirname, "..");
const RUNNER_JS = join(RUNNER_ROOT, "runner.js");
const INDEX_HTML = join(__dirname, "index.html");
const DASHBOARD_HTML = join(__dirname, "dashboard.html");
const GAME_HTML = join(__dirname, "game.html");
const MAP_SVG_PATH = process.env.MAP_SVG || join(__dirname, "map.svg");

const PORT = parseInt(process.env.CHAT_PORT || "8130", 10);
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || "120000", 10);
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 10;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";

const HTML = readFileSync(INDEX_HTML, "utf-8");
const DASH = readFileSync(DASHBOARD_HTML, "utf-8");
const GAME = readFileSync(GAME_HTML, "utf-8");
const MAP_SVG = (() => { try { return readFileSync(MAP_SVG_PATH, "utf-8"); } catch { return ""; } })();

// --- сборка промпта: runner не хранит сессию между сообщениями, историю и
// --- конфигурацию гостей передаём текстом

const TYPE_RU = {
  extreme: "экстрим",
  family: "семейный",
  kids: "детский",
  interactive: "интерактив",
  zone: "детская зона",
};
const WEEKDAY_FULL_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

// коды WMO из Open-Meteo (weathercode)
const wmoRu = (c) => {
  if (c === 0) return "ясно";
  if (c <= 2) return "переменная облачность";
  if (c === 3) return "пасмурно";
  if (c < 50) return "туман";
  if (c < 60) return "морось";
  if (c < 70) return "дождь";
  if (c < 80) return "снег";
  if (c < 95) return "ливень";
  return "гроза";
};
const fmtT = (t) => (t > 0 ? "+" : "") + Math.round(t) + " °C";

function parseContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ctx = {};
  if (typeof raw.visitId === "string" && raw.visitId.trim()) ctx.visitId = raw.visitId.trim().slice(0, 64);
  if (typeof raw.date === "string") ctx.date = raw.date.slice(0, 10);
  if (typeof raw.time === "string" && /^\d{1,2}:\d{2}$/.test(raw.time.trim())) ctx.time = raw.time.trim().slice(0, 5);
  if (Array.isArray(raw.group)) {
    ctx.group = raw.group
      .slice(0, 20)
      .map((m) => ({
        name: typeof m?.name === "string" ? m.name.trim().slice(0, 32) : "",
        height: Number(m?.height),
      }))
      .filter((m) => m.name && Number.isFinite(m.height) && m.height > 20 && m.height < 260);
  }
  if (Array.isArray(raw.picks)) {
    ctx.picks = raw.picks
      .slice(0, 7)
      .map((p) => ({
        name: typeof p?.name === "string" ? p.name.trim().slice(0, 100) : "",
        type: typeof p?.type === "string" ? p.type.slice(0, 20) : "",
        hmin: Number(p?.hmin) || 0,
        hmax: Number(p?.hmax) || 250,
        priceFrom: Number(p?.priceFrom) || 0,
      }))
      .filter((p) => p.name);
  }
  if (Array.isArray(raw.route)) {
    ctx.route = raw.route
      .slice(0, 20)
      .map((r) => ({
        time: typeof r?.time === "string" && /^\d{1,2}:\d{2}$/.test(r.time.trim()) ? r.time.trim() : "",
        name: typeof r?.name === "string" ? r.name.trim().slice(0, 100) : "",
        dur: Number(r?.dur) || 0,
      }))
      .filter((r) => r.name && r.time);
  }
  if (raw.weather && typeof raw.weather === "object") {
    const t = Number(raw.weather.t);
    if (Number.isFinite(t)) {
      ctx.weather = {
        t,
        code: Number.isFinite(Number(raw.weather.code)) ? Number(raw.weather.code) : -1,
        precip: Number.isFinite(Number(raw.weather.precip)) ? Number(raw.weather.precip) : -1,
        wind: Number.isFinite(Number(raw.weather.wind)) ? Number(raw.weather.wind) : -1,
        approx: raw.weather.approx === true,
      };
    }
  }
  return ctx.group?.length || ctx.picks?.length || ctx.date || ctx.time || ctx.visitId || ctx.route?.length || ctx.weather ? ctx : null;
}

function formatContext(ctx) {
  const lines = [];
  if (ctx.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.date);
    const wd = m ? WEEKDAY_FULL_RU[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] : "";
    lines.push(`Дата визита: ${m ? `${m[3]}.${m[2]}.${m[1]}${wd ? ` (${wd})` : ""}` : ctx.date}${ctx.time ? `, приход в ${ctx.time}` : ""}`);
  } else if (ctx.time) {
    lines.push(`Время прихода: ${ctx.time}`);
  }
  if (ctx.group?.length) {
    lines.push(`Группа: ${ctx.group.map((g) => `${g.name} — ${Math.round(g.height)} см`).join("; ")}`);
  }
  if (ctx.picks?.length) {
    lines.push(
      `Выбранные аттракционы: ${ctx.picks
        .map((p) => {
          const h = [p.hmin ? `от ${p.hmin} см` : "рост любой", p.hmax < 250 ? `до ${p.hmax} см` : ""].filter(Boolean).join(" ");
          const price = p.priceFrom ? `, от ${p.priceFrom} ₽` : "";
          return `«${p.name}» (${TYPE_RU[p.type] || "аттракцион"}, ${h}${price})`;
        })
        .join(", ")}`
    );
  }
  if (ctx.route?.length) {
    lines.push(`Маршрут дня: ${ctx.route.map((r) => `${r.time} «${r.name}»${r.dur ? ` (${r.dur} мин)` : ""}`).join(" → ")}`);
  }
  if (ctx.weather) {
    lines.push(
      (ctx.weather.approx
        ? "Погода ориентировочная (дата дальше горизонта прогноза, взят прогноз на 10 дней от сегодняшнего дня): "
        : "Погода на время прихода: ") +
      `${wmoRu(ctx.weather.code)}, ${fmtT(ctx.weather.t)}` +
      `${ctx.weather.precip >= 0 ? `, вероятность осадков ${ctx.weather.precip}%` : ""}` +
      `${ctx.weather.wind >= 0 ? `, ветер до ${ctx.weather.wind} м/с` : ""}`
    );
  }
  return lines.join("\n").slice(0, 1500);
}

function buildPrompt(message, history = [], context = null) {
  const lines = [];
  const conf = context && formatContext(context);
  if (conf) {
    lines.push("[Конфигурация гостей — учитывай её в ответах, обращайся к гостям по именам]", conf, "[Конец конфигурации гостей]", "");
  }
  const recent = history.slice(-MAX_HISTORY);
  if (recent.length) {
    lines.push("[Предыдущий диалог — для контекста, отвечай только на новое сообщение]");
    for (const h of recent) {
      if (!h || typeof h.text !== "string") continue;
      const who = h.role === "user" ? "Посетитель" : "Баюн";
      lines.push(`${who}: ${h.text.slice(0, 1000)}`);
    }
    lines.push("[Конец предыдущего диалога]", "");
  }
  lines.push("Новое сообщение посетителя:", message);
  return lines.join("\n");
}

// --- чтение JSON-тела (общее для /api/chat и /api/visits) ---

function readJsonBody(req) {
  return new Promise((resolveBody) => {
    let body = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("error", () => {});
    req.on("end", () => {
      if (tooBig) return resolveBody(null);
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        resolveBody(null);
      }
    });
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

/* страницы всегда просим свежие: без no-cache WebView/браузер может показать
   старую версию UI после обновления сервера (heuristic-кэширование) */
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" };

// --- POST /api/chat: запуск runner.js и трансляция его NDJSON в SSE ---

async function handleChat(req, res) {
  const parsed = await readJsonBody(req);
  if (!parsed) return;

  let message = "";
  let history = [];
  if (typeof parsed.message === "string") message = parsed.message.trim();
  if (Array.isArray(parsed.history)) history = parsed.history;

  if (!message) {
    json(res, 400, { error: "Пустое сообщение" });
    return;
  }
  if (message.length > MAX_MESSAGE_LEN) message = message.slice(0, MAX_MESSAGE_LEN);

  const context = parseContext(parsed.context);
  // вопрос посетителя — в диалог для маркетинга (связь с визитом по visitId)
  logDialogue(context?.visitId ?? null, "user", message);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (obj) => { if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  // Отключение клиента ловим на res ("close" у req в современных Node срабатывает
  // сразу после чтения тела запроса — им нельзя детектить обрыв соединения)
  let closed = false;
  let child = null;

  // Страховочный таймаут: runner сам ограничен TURN_TIMEOUT_MS, даём запас
  const hardKill = setTimeout(() => child && child.kill(), TURN_TIMEOUT_MS + 15000);
  // Heartbeat, чтобы прокси не рвали соединение, пока Баюн думает
  const heartbeat = setInterval(() => { if (!closed) res.write(": ka\n\n"); }, 15000);

  res.on("close", () => { closed = true; if (child) child.kill(); });

  const prompt = buildPrompt(message, history, context);
  const visitId = context?.visitId ?? null;
  child = spawn(process.execPath, [RUNNER_JS, prompt], {
    cwd: RUNNER_ROOT,
    env: process.env,
    windowsHide: true,
  });

  let stdoutBuf = "";
  let gotDone = false;
  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "done") {
        gotDone = true;
        logDialogue(visitId, "bayun", event.answer || "");
      }
      if (!closed) send(event);
      if (event.type === "done" || event.type === "error") {
        clearInterval(heartbeat);
        clearTimeout(hardKill);
        res.end();
        closed = true;
        child.kill();
        return;
      }
    }
  });

  let stderrTail = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk).slice(-2000); });

  child.on("error", (err) => {
    clearInterval(heartbeat);
    clearTimeout(hardKill);
    if (!closed) { send({ type: "error", message: `Не удалось запустить runner: ${err.message}` }); res.end(); closed = true; }
  });

  child.on("close", (code) => {
    clearInterval(heartbeat);
    clearTimeout(hardKill);
    if (closed) return;
    closed = true;
    if (!gotDone) {
      send({
        type: "error",
        message: stderrTail.trim()
          ? `Runner завершился без ответа (код ${code}): ${stderrTail.trim()}`
          : `Runner завершился без ответа (код ${code}). Проверьте настройку runner/agent/models.json и .env.`,
      });
    }
    res.end();
  });
}

// --- POST /api/visits: заявка спланированного визита — в JSONL-хранилище ---

async function handleVisits(req, res) {
  const parsed = await readJsonBody(req);
  const visit = normalizeVisit(parsed);
  if (!visit) {
    json(res, 400, { error: "Нужны id и group (хотя бы один гость: {name, height})" });
    return;
  }
  saveVisit(visit);
  json(res, 200, { ok: true, parsed: visit.parsed });
}

// --- погода: прокси к Open-Meteo с кэшем и таймаутом.
// Гости ходят на наш бэкенд (GET /api/weather), а не напрямую — их браузеры не зависят
// от доступности open-meteo.com; кэш 30 минут бережёт лимиты API.
const PARK = { lat: 55.771505, lon: 37.434665 };
const WX_CACHE = new Map();               // "date|hour" -> { data, ts }
const WX_TTL_MS = 30 * 60 * 1000;
const WX_TIMEOUT_MS = 6000;
const WX_MAX_AHEAD = 16;                  // горизонт прогноза Open-Meteo, дней
const WX_BASE = process.env.WX_URL_BASE || "https://api.open-meteo.com"; // смена источника для тестов/зеркал

async function weatherFor(date, hour) {
  const key = date + "|" + hour;
  const hit = WX_CACHE.get(key);
  if (hit && Date.now() - hit.ts < WX_TTL_MS) return hit.data;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysAhead = Math.round((new Date(date + "T00:00:00") - today) / 864e5);
  const approx = daysAhead > WX_MAX_AHEAD;
  const fetchDate = approx ? new Date(today.getTime() + 10 * 864e5).toISOString().slice(0, 10) : date;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WX_TIMEOUT_MS);
  let j;
  try {
    const u = `${WX_BASE}/v1/forecast?latitude=${PARK.lat}&longitude=${PARK.lon}` +
      `&hourly=temperature_2m,precipitation_probability,weathercode,wind_speed_10m` +
      `&start_date=${fetchDate}&end_date=${fetchDate}&timezone=Europe%2FMoscow`;
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) throw new Error("http_" + r.status);
    j = await r.json();
  } finally {
    clearTimeout(timer);
  }
  const h = j.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("bad_payload");
  let i = h.time.findIndex((x) => x.endsWith("T" + String(hour).padStart(2, "0") + ":00"));
  if (i < 0) i = h.time.findIndex((x) => x.endsWith("T12:00"));
  if (i < 0) throw new Error("no_hour");
  const data = {
    date, hour, approx,
    t: h.temperature_2m[i],
    code: h.weathercode[i],
    precip: (h.precipitation_probability || [])[i] ?? 0,
    wind: Math.round(h.wind_speed_10m[i] || 0),
  };
  WX_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

// --- доступ к дашборду: если задан DASHBOARD_TOKEN, данные отдаём только с ним ---

function dashboardAllowed(url) {
  return !DASHBOARD_TOKEN || url.searchParams.get("token") === DASHBOARD_TOKEN;
}

// --- HTTP-сервер ---

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, HTML_HEADERS);
    res.end(HTML);
  } else if (req.method === "GET" && url.pathname === "/dashboard") {
    res.writeHead(200, HTML_HEADERS);
    res.end(DASH);
  } else if (req.method === "GET" && url.pathname === "/game") {
    res.writeHead(200, HTML_HEADERS);
    res.end(GAME);
  } else if (req.method === "GET" && url.pathname === "/map.svg") {
    if (!MAP_SVG) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("map.svg не найден рядом с server.js");
      return;
    }
    res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" });
    res.end(MAP_SVG);
  } else if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
  } else if (req.method === "POST" && url.pathname === "/api/chat") {
    handleChat(req, res);
  } else if (req.method === "GET" && url.pathname === "/api/weather") {
    const date = url.searchParams.get("date") || "";
    const hour = parseInt(url.searchParams.get("hour"), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour) || hour < 0 || hour > 23) {
      json(res, 400, { error: "Нужны date=YYYY-MM-DD и hour=0..23" });
      return;
    }
    weatherFor(date, hour)
      .then((w) => json(res, 200, w))
      .catch((e) => json(res, 502, { error: "Прогноз недоступен: " + e.message }));
  } else if (req.method === "POST" && url.pathname === "/api/visits") {
    handleVisits(req, res);
  } else if (req.method === "GET" && url.pathname === "/api/stats") {
    if (!dashboardAllowed(url)) {
      json(res, 401, { error: "Неверный токен дашборда" });
      return;
    }
    json(res, 200, getStats());
  } else {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }})
    .on("error", (err) => {
      console.error("Ошибка сервера:", err.message);
      process.exit(1);
    })
    .listen(PORT, () => {
      console.log(`Страница Баюна: http://localhost:${PORT}/  · дашборд: /dashboard  · игра: /game  (runner: ${RUNNER_JS})`);
    });
