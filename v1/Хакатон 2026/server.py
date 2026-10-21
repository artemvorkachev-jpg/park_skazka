# -*- coding: utf-8 -*-
"""
Сервер игры «Хранитель Сказки»: отдаёт сайт и связывает его с ИИ-ведущим (Кот Баюн).

Запуск:   python server.py            (сайт откроется на http://localhost:5173)
ИИ-ведущий (по порядку):
  1) ключ API: переменная окружения HOST_API_KEY (или OPENAI_API_KEY) либо файл host_key.txt рядом (одна строка);
  2) консольный Claude (программа claude, под вашей учётной записью, без отдельного ключа);
  3) резервный ведущий в браузере (без ИИ).
Ключ нигде не печатается и не отдаётся браузеру.

Необязательно:
  HOST_MODEL     модель (по умолчанию gpt-4.1-mini, запасная gpt-4o-mini)
  HOST_API_BASE  адрес совместимого API (по умолчанию https://api.openai.com/v1)
  HOST_CLAUDE_MODEL  модель консольного Claude (по умолчанию haiku — быстрая)
  HOST_MOCK=1    пробный режим: возвращает готовые ответы, без внешнего ИИ (для проверки связки)
  PORT           порт (по умолчанию 5173)
"""
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import sys
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', '5173'))
API_BASE = os.environ.get('HOST_API_BASE', 'https://api.openai.com/v1').rstrip('/')
MODELS = [m for m in [os.environ.get('HOST_MODEL'), 'gpt-4.1-mini', 'gpt-4o-mini'] if m]
MOCK = os.environ.get('HOST_MOCK') == '1'
CLAUDE_MODEL = os.environ.get('HOST_CLAUDE_MODEL', 'haiku')
CLAUDE_BIN = shutil.which('claude')
HIDDEN = {'host_key.txt', 'server.py'}

SYSTEM = """Ты — Кот Баюн, добрый и находчивый ведущий онлайн-стратегии «Хранитель Сказки» о парке развлечений «Сказка» (Москва, Крылатское).
Игрок управляет парком в течение одного дня: 5 ходов. Ресурсы: монеты, гости, настроение (0–100).
Игрок строит зоны парка, ухаживает за животными и привлекает гостей. Цель: к вечеру 120+ гостей и настроение 70+ (старт: 40 гостей, настроение 60, 100 монет).

Правила ответа:
- Отвечай ТОЛЬКО одним JSON-объектом, без пояснений и без markdown.
- Пиши по-русски, тепло и коротко: рассказ — 2 предложения, последствия — 2 предложения, подсказка к варианту — до 12 слов.
- Используй только факты из переданных данных (погода, названия зон и аттракционов, статусы). Не выдумывай цены, акции и факты о парке.
- Реальная погода из данных обязательно влияет на события. Если аттракцион остановлен — объясняй причину и срок.
- Новые зоны предлагай только из списка «available» (поле build = id зоны), цена строго как в списке.
- Для каждого варианта числа должны быть целыми: cost 0–60 (монеты потратить), earn 0–30 (монеты заработать), guests -15..35, mood -25..25.
- Варианты должны быть РАЗНЫМИ по смыслу: безопасный, рискованный, творческий. Рискованный даёт больше, но может ударить по настроению.

Формат для хода (mode = "start" или "turn"):
{"consequence":"<что получилось после прошлого решения; для первого хода пустая строка>",
 "story":"<что происходит в парке сейчас>",
 "options":[{"label":"<до 60 символов>","hint":"<одно предложение о рисках и выгоде>","cost":0,"earn":0,"guests":0,"mood":0,"build":null}]}
ВАЖНО: в mode = "start" и "turn" ВСЕГДА возвращай story и options — даже на последнем, 5-м ходу. Итог дня (epilogue, title) — только в mode = "final".
Формат для итога (mode = "final"):
{"consequence":"<последствия последнего решения>","epilogue":"<итог дня: 2–3 предложения>","title":"<звание игроку, 2–4 слова>"}
В mode = "turn" и "final" опирайся на поле last.applied: это ФАКТИЧЕСКИЕ изменения ресурсов, не меняй их и не противоречь им."""


def read_key():
    k = os.environ.get('HOST_API_KEY') or os.environ.get('OPENAI_API_KEY')
    if k:
        return k.strip()
    p = os.path.join(HERE, 'host_key.txt')
    if os.path.isfile(p):
        with open(p, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    return line
    return None


def mock_reply(ctx):
    mode = ctx.get('mode')
    if mode == 'final':
        return {'consequence': 'Последнее решение принесло свои плоды.', 'epilogue': 'Парк закрылся под аплодисменты гостей. Завтра — новый день!', 'title': 'Хранитель дня'}
    av = [z for z in ctx.get('state', {}).get('available', [])][:2]
    opts = [{'label': 'Построить: ' + z['name'], 'hint': 'Дорого, но привлечёт гостей.', 'cost': z['cost'], 'earn': 0, 'guests': 12, 'mood': 4, 'build': z['id']} for z in av]
    opts.append({'label': 'Объявить «тихий час»', 'hint': 'Бесплатно, но осторожно с очередями.', 'cost': 0, 'earn': 5, 'guests': 8, 'mood': 2, 'build': None})
    return {'consequence': '' if mode == 'start' else '[пробный режим] Решение принято, гости заметили перемены.', 'story': '[пробный режим] Ход ' + str(ctx.get('turn')) + ': в парке оживлённо.', 'options': opts}


def engine_name():
    if MOCK:
        return 'mock'
    if read_key():
        return 'api'
    if CLAUDE_BIN:
        return 'claude'
    return None


def call_ai(ctx):
    key = read_key()
    last_err = 'нет ключа'
    if not key:
        if CLAUDE_BIN:
            for attempt in (1, 2):                                # одна повторная попытка, если ответ вышел кривым
                try:
                    return call_claude(ctx)
                except (RuntimeError, ValueError) as e:
                    sys.stderr.write('Claude, попытка %d: %s\n' % (attempt, e))
                    if attempt == 2:
                        raise RuntimeError(str(e))
        raise RuntimeError('no_key')
    for model in MODELS:
        body = json.dumps({
            'model': model,
            'temperature': 0.9,
            'max_tokens': 700,
            'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': json.dumps(ctx, ensure_ascii=False)}],
        }).encode('utf-8')
        req = urllib.request.Request(API_BASE + '/chat/completions', data=body, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode('utf-8'))
            text = data['choices'][0]['message']['content']
            m = re.search(r'\{.*\}', text, re.S)
            return json.loads(m.group(0) if m else text)
        except urllib.error.HTTPError as e:
            last_err = 'HTTP %s' % e.code
            if e.code in (400, 404):  # модель недоступна — пробуем следующую
                continue
            break
        except Exception as e:  # сеть, таймаут, разбор
            last_err = type(e).__name__
            break
    raise RuntimeError(last_err)


_sys_file = None


def system_file():
    """Системный промпт кладём во временный файл: так русский текст не портится при запуске программы на Windows."""
    global _sys_file
    if _sys_file and os.path.isfile(_sys_file):
        return _sys_file
    fd, p = tempfile.mkstemp(prefix='baiun_', suffix='.txt')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(SYSTEM)
    _sys_file = p
    return p


def empty_mcp():
    p = os.path.join(tempfile.gettempdir(), 'baiun_mcp.json')
    if not os.path.isfile(p):
        with open(p, 'w', encoding='utf-8') as f:
            f.write('{"mcpServers":{}}')
    return p


def call_claude(ctx):
    """Кот Баюн через консольный Claude: запрос идёт по stdin, tools отключены, сессия не сохраняется."""
    cmd = [CLAUDE_BIN, '-p', '--output-format', 'json', '--no-session-persistence', '--tools', '', '--model', CLAUDE_MODEL, '--system-prompt-file', system_file(),
           '--strict-mcp-config', '--mcp-config', empty_mcp(), '--disable-slash-commands']          # без лишних плагинов — быстрее старт
    env = dict(os.environ, MAX_THINKING_TOKENS='0')                                                # без долгих размышлений: ход за ~10 секунд
    try:
        r = subprocess.run(cmd, input=json.dumps(ctx, ensure_ascii=False), capture_output=True, text=True, encoding='utf-8', timeout=90, cwd=tempfile.gettempdir(), env=env)
    except subprocess.TimeoutExpired:
        raise RuntimeError('claude: таймаут')
    except OSError as e:
        raise RuntimeError('claude: ' + type(e).__name__)
    if r.returncode != 0:
        raise RuntimeError('claude: код %s' % r.returncode)
    try:
        outer = json.loads(r.stdout)
        text = outer.get('result', '') if isinstance(outer, dict) else r.stdout
    except ValueError:
        text = r.stdout
    m = re.search(r'\{.*\}', text, re.S)
    if not m:
        raise RuntimeError('claude: нет JSON в ответе')
    return json.loads(m.group(0), strict=False)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        # во время хакатона файлы часто меняются: не даём браузеру держать старые копии
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split('?')[0]
        if os.path.basename(path) in HIDDEN:
            return self._json(404, {'error': 'not found'})
        if path == '/api/health':
            e = engine_name()
            return self._json(200, {'ai': bool(e), 'mock': MOCK, 'engine': e, 'model': CLAUDE_MODEL if e == 'claude' else MODELS[0]})
        return super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/host':
            return self._json(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            ctx = json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return self._json(400, {'error': 'bad request'})
        if MOCK:
            return self._json(200, {'ok': True, 'data': mock_reply(ctx), 'mock': True})
        try:
            return self._json(200, {'ok': True, 'data': call_ai(ctx)})
        except RuntimeError as e:
            sys.stderr.write('Ведущий недоступен: %s\n' % e)
            return self._json(200, {'ok': False, 'error': str(e)})


class Server6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def serve(cls, host):
    try:
        srv = cls((host, PORT), Handler)
    except OSError:
        return None
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == '__main__':
    # слушаем только свой компьютер: и по 127.0.0.1, и по ::1 (иначе браузер ждёт лишние 2 секунды)
    a = serve(ThreadingHTTPServer, '127.0.0.1')
    b = serve(Server6, '::1')
    if not a and not b:
        sys.exit('Не удалось занять порт %d: он уже занят другой программой.' % PORT)
    state = {'mock': 'пробный режим (без ИИ)', 'api': 'ключ API найден', 'claude': 'консольный Claude (модель %s)' % CLAUDE_MODEL, None: 'нет ключа и Claude — будет резервный ведущий'}[engine_name()]
    print('Хранитель Сказки: http://localhost:%d  |  ИИ-ведущий: %s' % (PORT, state), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
