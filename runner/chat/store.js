// store.js — хранилище заявок «спланированных визитов» и вопросов Баюну (append-only JSONL)
// плюс агрегация для маркетингового дашборда. Без внешних зависимостей.
//
// Файлы (в chat/data/, в контейнере — том bayun_data):
//   visits.jsonl     — по строке на отправку конфигурации гостей (дубликаты по id: побеждает последняя)
//   questions.jsonl  — по строке на сообщение посетителя (связано с визитом через visitId)
//
// Парсинг для маркетинга делается при записи: поля parsed.* в самой строке —
// сегмент каждого гостя по росту и категория группы (семья / взрослые / дети).

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.BAYUN_DATA_DIR || join(__dirname, "data");
const VISITS_FILE = join(DATA_DIR, "visits.jsonl");
const QUESTIONS_FILE = join(DATA_DIR, "questions.jsonl");

// --- сегменты гостей и категории групп (словарь маркетинга) ---

export const SEGMENT_RU = {
  kid: "малыш (до 120 см)",
  child: "ребёнок (120–149 см)",
  adult: "взрослый (от 150 см)",
};
export const CATEGORY_RU = {
  family: "Семья с детьми",
  adults: "Взрослая компания",
  kids: "Детская группа",
};

export function segmentOf(height) {
  if (height < 120) return "kid";
  if (height < 150) return "child";
  return "adult";
}

export function categoryOf(heights) {
  const segs = heights.map(segmentOf);
  const hasAdult = segs.includes("adult");
  const hasKid = segs.some((s) => s !== "adult");
  if (hasAdult && hasKid) return "family";
  return hasAdult ? "adults" : "kids";
}

// --- нормализация входа от страницы (ничего непроверенного в файл не попадает) ---

const clampNum = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

export function normalizeVisit(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 64) : null;
  if (!id) return null;

  const group = (Array.isArray(raw.group) ? raw.group : []).slice(0, 20).map((m) => ({
    name: typeof m?.name === "string" && m.name.trim() ? m.name.trim().slice(0, 32) : "Гость",
    height: clampNum(m?.height, 50, 220, 120),
  }));
  if (!group.length) return null;

  const picks = (Array.isArray(raw.picks) ? raw.picks : [])
    .slice(0, 7)
    .map((p) => ({
      name: typeof p?.name === "string" ? p.name.trim().slice(0, 100) : "",
      type: typeof p?.type === "string" ? p.type.slice(0, 20) : "",
      hmin: clampNum(p?.hmin, 0, 250, 0),
      hmax: clampNum(p?.hmax, 0, 300, 250),
      priceFrom: clampNum(p?.priceFrom, 0, 10_000_000, 0),
    }))
    .filter((p) => p.name);

  const heights = group.map((m) => m.height);
  const segments = { kid: 0, child: 0, adult: 0 };
  for (const h of heights) segments[segmentOf(h)]++;

  return {
    id,
    date: typeof raw.date === "string" ? raw.date.slice(0, 10) : "",
    group,
    picks,
    ts: new Date().toISOString(),
    parsed: {
      size: group.length,
      segments,
      category: categoryOf(heights),
    },
  };
}

// --- append-only запись ---

function appendLine(file, obj) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

export function saveVisit(visit) {
  appendLine(VISITS_FILE, visit);
  return visit;
}

export function logQuestion(visitId, text) {
  if (typeof text !== "string" || !text.trim()) return;
  appendLine(QUESTIONS_FILE, {
    ts: new Date().toISOString(),
    visitId: typeof visitId === "string" ? visitId.slice(0, 64) : null,
    text: text.trim().slice(0, 200),
  });
}

// --- чтение и агрегация ---

function readJsonl(file) {
  let raw = "";
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* битая строка — пропускаем */
    }
  }
  return out;
}

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function weekdayOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (d.getDay() + 6) % 7; // 0 = понедельник
}

export function getStats() {
  // дубликаты id: побеждает последняя отправка (гость изменил конфигурацию)
  const byId = new Map();
  for (const v of readJsonl(VISITS_FILE)) {
    if (v && typeof v.id === "string") byId.set(v.id, v);
  }
  const visits = [...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const questions = readJsonl(QUESTIONS_FILE).filter((q) => q && typeof q.text === "string");

  const categories = { family: 0, adults: 0, kids: 0 };
  const segments = { kid: 0, child: 0, adult: 0 };
  const sizes = {};
  const dates = {};
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const attrCount = new Map();
  let guestsTotal = 0;

  for (const v of visits) {
    const p = v.parsed || {};
    guestsTotal += p.size || v.group?.length || 0;
    if (p.category in categories) categories[p.category]++;
    const sizeKey = (p.size || 0) >= 5 ? "5+" : String(p.size || 0);
    if (p.size) sizes[sizeKey] = (sizes[sizeKey] || 0) + 1;
    for (const [k, n] of Object.entries(p.segments || {})) {
      if (k in segments) segments[k] += n;
    }
    if (typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      dates[v.date] = (dates[v.date] || 0) + 1;
      const wd = weekdayOf(v.date);
      if (wd !== null) weekdays[wd]++;
    }
    for (const pick of Array.isArray(v.picks) ? v.picks : []) {
      if (pick?.name) attrCount.set(pick.name, (attrCount.get(pick.name) || 0) + 1);
    }
  }

  const questionsByVisit = new Map();
  for (const q of questions) {
    if (q.visitId) questionsByVisit.set(q.visitId, (questionsByVisit.get(q.visitId) || 0) + 1);
  }

  const visitsCount = visits.length;
  return {
    generatedAt: new Date().toISOString(),
    visitsCount,
    guestsTotal,
    avgGroupSize: visitsCount ? Math.round((guestsTotal / visitsCount) * 10) / 10 : 0,
    familyShare: visitsCount ? Math.round((categories.family / visitsCount) * 100) : 0,
    categories,
    segments,
    sizes,
    dates: Object.entries(dates).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-14),
    weekdays: WEEKDAYS_RU.map((name, i) => ({ name, count: weekdays[i] })),
    topAttractions: [...attrCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    questionsCount: questions.length,
    recentVisits: visits
      .slice(-10)
      .reverse()
      .map((v) => ({
        ts: v.ts,
        date: v.date,
        size: v.parsed?.size || v.group?.length || 0,
        category: v.parsed?.category || "",
        group: (v.group || []).map((m) => ({ name: m.name, height: m.height })),
        picks: (v.picks || []).map((p) => p.name),
        questions: questionsByVisit.get(v.id) || 0,
      })),
    recentQuestions: questions.slice(-15).reverse(),
  };
}
