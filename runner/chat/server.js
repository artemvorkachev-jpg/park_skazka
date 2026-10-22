// Чат-адаптер над runner.js: HTTP + SSE для веб-интерфейса Баюна.
// Запуск: node chat/server.js  (из папки runner/ или откуда угодно — пути относительные)
// Зависимости: только Node.js 18+. Ключи и модель берёт сам runner.js (.env, agent/).
//
// Протокол:
//   GET  /            — страница «спланируй визит → спроси Баюна» (index.html рядом с этим файлом)
//   GET  /dashboard   — маркетинговый дашборд (dashboard.html); данные закрыты токеном, см. ниже
//   GET  /health      — {"ok":true}
//   POST /api/chat    — тело { message: string, history?: [...], context?: {visitId?, date?, group?, picks?} }
//                       ответ — text/event-stream, события runner.js построчно:
//                       session_start / turn_start / assistant_delta / assistant_final /
//                       tool_start / tool_end / error / done {answer}
//   POST /api/visits  — заявка визита {id, date?, group?, picks?, route?} — в store.js
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

const PORT = parseInt(process.env.CHAT_PORT || "8130", 10);
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || "120000", 10);
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 10;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";

const HTML = readFileSync(INDEX_HTML, "utf-8");
const DASH = readFileSync(DASHBOARD_HTML, "utf-8");

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
const fmtT = (t) => (t > 0 ? "+" : "") + Math.round(t) + "°";

function parseContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ctx = {};
  if (typeof raw.visitId === "string" && raw.visitId.trim()) ctx.visitId = raw.visitId.trim().slice(0, 64);
  if (typeof raw.date === "string") ctx.date = raw.date.slice(0, 10);
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
      };
    }
  }
  return ctx.group?.length || ctx.picks?.length || ctx.date || ctx.visitId || ctx.route?.length || ctx.weather ? ctx : null;
}

function formatContext(ctx) {
  const lines = [];
  if (ctx.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.date);
    const wd = m ? WEEKDAY_FULL_RU[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] : "";
    lines.push(`Дата визита: ${m ? `${m[3]}.${m[2]}.${m[1]}${wd ? ` (${wd})` : ""}` : ctx.date}`);
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
      `Погода на дату визита (около 12:00): ${wmoRu(ctx.weather.code)}, ${fmtT(ctx.weather.t)}` +
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

// --- доступ к дашборду: если задан DASHBOARD_TOKEN, данные отдаём только с ним ---

function dashboardAllowed(url) {
  return !DASHBOARD_TOKEN || url.searchParams.get("token") === DASHBOARD_TOKEN;
}

// --- HTTP-сервер ---

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  } else if (req.method === "GET" && url.pathname === "/dashboard") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DASH);
  } else if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
  } else if (req.method === "POST" && url.pathname === "/api/chat") {
    handleChat(req, res);
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
      console.log(`Страница Баюна: http://localhost:${PORT}/  · дашборд: /dashboard  (runner: ${RUNNER_JS})`);
    });
