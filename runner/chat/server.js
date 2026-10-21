// Чат-адаптер над runner.js: HTTP + SSE для веб-интерфейса Баюна.
// Запуск: node chat/server.js  (из папки runner/ или откуда угодно — пути относительные)
// Зависимости: только Node.js 18+. Ключи и модель берёт сам runner.js (.env, agent/).
//
// Протокол:
//   GET  /          — страница чата (index.html рядом с этим файлом)
//   GET  /health    — {"ok":true}
//   POST /api/chat  — тело { message: string, history?: [{role:'user'|'bayun', text:string}] }
//                     ответ — text/event-stream, события runner.js построчно:
//                     session_start / turn_start / assistant_delta / assistant_final /
//                     tool_start / tool_end / error / done {answer}
//
// runner.js — одноразовый процесс на один запрос: на каждое сообщение чата
// запускается новый runner, история диалога передаётся в промпте (см. buildPrompt).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = resolve(__dirname, "..");
const RUNNER_JS = join(RUNNER_ROOT, "runner.js");
const INDEX_HTML = join(__dirname, "index.html");

const PORT = parseInt(process.env.CHAT_PORT || "8130", 10);
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || "120000", 10);
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 10;

const HTML = readFileSync(INDEX_HTML, "utf-8");

// --- сборка промпта: runner не хранит сессию между сообщениями, историю передаём текстом ---

function buildPrompt(message, history = []) {
  const lines = [];
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

// --- POST /api/chat: запуск runner.js и трансляция его NDJSON в SSE ---

function handleChat(req, res) {
  let body = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) { tooBig = true; req.destroy(); }
  });
  req.on("error", () => {});
  req.on("end", () => {
    if (tooBig) return;
    let message = "", history = [];
    try {
      const parsed = JSON.parse(body || "{}");
      if (typeof parsed.message === "string") message = parsed.message.trim();
      if (Array.isArray(parsed.history)) history = parsed.history;
    } catch { /* пустое/битое тело — ответим ошибкой ниже */ }

    if (!message) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Пустое сообщение" }));
      return;
    }
    if (message.length > MAX_MESSAGE_LEN) message = message.slice(0, MAX_MESSAGE_LEN);

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

    const prompt = buildPrompt(message, history);
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
        if (event.type === "done") gotDone = true;
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
  });
}

// --- HTTP-сервер ---

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  } else if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  } else if (req.method === "POST" && url.pathname === "/api/chat") {
    handleChat(req, res);
  } else {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }})
    .on("error", (err) => {
      console.error("Ошибка сервера:", err.message);
      process.exit(1);
    })
    .listen(PORT, () => {
      console.log(`Чат Баюна: http://localhost:${PORT}/  (runner: ${RUNNER_JS})`);
    });
