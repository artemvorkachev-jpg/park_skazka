# Park Skazka Runner

Isolated Pi agent runner for the «Парк Сказка» chat system (agent: Баюн). Uses `@earendil-works/pi-coding-agent` (pi-durable) to run single prompts and emit JSON events to stdout.

## Setup

```bash
cd runner
npm install

# Configure your model in agent/models.json (add your API key)
# Optionally create .env with API keys
```

## Usage

```bash
# Single prompt
node runner.js "Какие аттракционы есть в парке Сказка?"

# With timeout override (ms)
TURN_TIMEOUT_MS=60000 node runner.js "Расскажи про Дино парк"
```

## Output

JSON lines to stdout — one object per event:
- `session_start` — session initialized
- `turn_start` — agent thinking started
- `assistant_delta` — streaming text chunks
- `assistant_final` — complete assistant message
- `tool_start` / `tool_end` — tool execution
- `error` — errors
- `done` — final answer with full text

## File Structure

```
runner/
├── runner.js              # Pi SDK agent runner
├── system-prompt.md       # Баюн persona prompt
├── agent/                 # Isolated Pi profile
│   ├── auth.json          # API credentials
│   ├── models.json        # Model definitions
│   └── settings.json      # Agent settings
├── chat/                  # HTTP/SSE-адаптер (node chat/server.js)
│   ├── index.html         # планировщик визита + чат с Баюном
│   ├── game.html          # мини-игра «Прогулка по парку» (симуляция визита)
│   ├── map.svg            # схема парка без легенды для игры
│   ├── dashboard.html     # маркетинговый дашборд
│   ├── media/             # интро-видео (intro.mp4) — GET /media/…, показывается до шага «Визит»
│   ├── landing/           # лендинг защиты (копия «Защита/Команда — Хранитель Сказки»), GET /landing/
│   ├── server.js          # HTTP: /, /game, /dashboard, /landing/, /media/…, /map.svg, /api/*
│   └── store.js           # JSONL-хранилище заявок и диалога
├── package.json
└── .env                   # (create with your API keys)
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TURN_TIMEOUT_MS` | `120000` | Prompt timeout (ms) |

Edit `agent/models.json` to configure your LLM provider and API key.