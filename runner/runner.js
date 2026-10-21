import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(__dirname, "agent");

// Load .env if present
const envFile = resolve(__dirname, ".env");
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch {}
}

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: node runner.js <prompt>");
  process.exit(1);
}

// Resolve ${VAR} placeholders in models.json from environment
function resolveEnvInModels(jsonStr) {
  return jsonStr.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    return process.env[envVar] ?? `_${envVar}_not_set_`;
  });
}

const {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} = await import("@earendil-works/pi-coding-agent");

const MAX_RETRIES = 3;
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || "120000", 10);

function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) => {
    const t = setTimeout(() => {
      clearTimeout(t);
      reject(new Error("turn_timeout"));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

function getLastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "agent_end" && e.messages) {
      const last = [...e.messages].reverse().find((m) => m.role === "assistant");
      if (last) {
        return last.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      }
    }
  }
  return "";
}

async function main() {
  const authStorage = AuthStorage.create(resolve(AGENT_DIR, "auth.json"));

  // Load models.json and resolve ${ENV_VAR} placeholders from .env
  const modelsPath = resolve(AGENT_DIR, "models.json");
  const modelsRaw = readFileSync(modelsPath, "utf-8");
  const modelsResolved = resolveEnvInModels(modelsRaw);
  const modelsResolvedPath = resolve(AGENT_DIR, "models.resolved.json");
  writeFileSync(modelsResolvedPath, modelsResolved, "utf-8");

  const modelRegistry = ModelRegistry.create(authStorage, modelsResolvedPath);
  const settingsManager = SettingsManager.create(process.cwd(), AGENT_DIR);

  // Find the first available model (getAvailable = models with configured auth)
  const model = modelRegistry.getAvailable().find((m) => m.provider);
  if (!model) {
    const loadErr = modelRegistry.getError();
    process.stdout.write(JSON.stringify({ type: "error", message: `No models configured. Set up agent/models.json and provide an API key.${loadErr ? " models.json: " + loadErr : ""}` }) + "\n");
    process.exit(1);
  }

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: AGENT_DIR,
    settingsManager,
    systemPromptOverride: () => {
      const promptPath = resolve(__dirname, "system-prompt.md");
      return readFileSync(promptPath, "utf-8");
    },
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: AGENT_DIR,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    tools: [],
    customTools: [],
  });

  let seq = 0;
  let turnError = null;

  function normalizeEvent(raw) {
    const base = { seq: seq++, timestamp: new Date().toISOString() };
    switch (raw.type) {
      case "session_start":
        return { ...base, type: "session_start", reason: raw.reason };
      case "session_shutdown":
        return { ...base, type: "session_shutdown", reason: raw.reason };
      case "agent_start":
        return { ...base, type: "turn_start" };
      case "agent_end":
        return { ...base, type: "assistant_final", messages: raw.messages, willRetry: raw.willRetry };
      case "turn_start":
        return { ...base, type: "turn_start", turnIndex: raw.turnIndex };
      case "turn_end":
        return { ...base, type: "turn_end", turnIndex: raw.turnIndex, message: raw.message, toolResults: raw.toolResults };
      case "message_start":
        if (raw.message?.role === "assistant") {
          return { ...base, type: "assistant_delta", role: "assistant", text: "" };
        }
        return { ...base, type: "message_start", message: raw.message };
      case "message_update":
        if (raw.message?.role === "assistant") {
          const text = raw.message.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "";
          return { ...base, type: "assistant_delta", role: "assistant", text };
        }
        return { ...base, type: "message_update", message: raw.message };
      case "message_end":
        if (raw.message?.role === "assistant") {
          const text = raw.message.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "";
          return { ...base, type: "assistant_final", role: "assistant", text, stopReason: raw.message.stopReason };
        }
        return { ...base, type: "message_end", message: raw.message };
      case "tool_execution_start":
        return { ...base, type: "tool_start", toolCallId: raw.toolCallId, toolName: raw.toolName, args: raw.args };
      case "tool_execution_end":
        return { ...base, type: "tool_end", toolCallId: raw.toolCallId, toolName: raw.toolName, result: raw.result, isError: raw.isError };
      case "error":
        turnError = raw.message ?? "unknown_error";
        return { ...base, type: "error", message: raw.message, errorType: raw.errorType ?? "unknown" };
      default:
        return { ...base, ...raw };
    }
  }

  session.subscribe((event) => {
    const normalized = normalizeEvent(event);
    process.stdout.write(JSON.stringify(normalized) + "\n");
  });

  const onSignal = () => { session.abort().catch(() => {}); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let currentPrompt = prompt;
  let eventBuffer = [];

  session.subscribe((event) => { eventBuffer.push(event); });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await withTimeout(session.prompt(currentPrompt), TURN_TIMEOUT_MS);
    } catch (err) {
      const errorEvent = {
        type: "error",
        seq: seq++,
        message: err.message,
        errorType: err.message === "turn_timeout" ? "timeout" : "prompt_failed",
        timestamp: new Date().toISOString(),
      };
      process.stdout.write(JSON.stringify(errorEvent) + "\n");
      break;
    }

    if (turnError) {
      break;
    }

    const finalText = getLastAssistantText(eventBuffer);
    const doneEvent = {
      type: "done",
      seq: seq++,
      answer: finalText,
      timestamp: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(doneEvent) + "\n");
    break;
  }

  session.dispose();
  process.exit(turnError ? 1 : 0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    type: "error", message: err.message, timestamp: new Date().toISOString(),
  }) + "\n");
  process.exit(1);
});