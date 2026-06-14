import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";
import { ClientScenario, Step } from "./types";
import { assertSchema } from "./validator";

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadStepFile(scenarioDir: string, filename: string): unknown {
  const full = path.join(scenarioDir, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`Step file not found: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

/** Expand ${VAR_NAME} placeholders using process.env. */
function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Environment variable "${name}" is not set (referenced in scenario URL)`);
    }
    return value;
  });
}

function subsetMatch(expected: Record<string, unknown>, actual: unknown, fields: string[]): void {
  if (typeof actual !== "object" || actual === null) {
    throw new Error(`Expected an object but received: ${JSON.stringify(actual)}`);
  }
  const actualObj = actual as Record<string, unknown>;
  for (const field of fields) {
    const exp = JSON.stringify(expected[field]);
    const got = JSON.stringify(actualObj[field]);
    if (exp !== got) {
      throw new Error(
        `Field mismatch on "${field}":\n  expected: ${exp}\n  received: ${got}`
      );
    }
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`Timeout (${timeoutMs}ms): no message received`));
    }, timeoutMs);

    const onMsg = (raw: WebSocket.RawData) => {
      clearTimeout(timer);
      ws.off("message", onMsg);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        reject(new Error(`Received non-JSON message: ${raw.toString()}`));
        return;
      }
      resolve(parsed);
    };

    ws.on("message", onMsg);
  });
}

// ── Step runner ───────────────────────────────────────────────────────────────

const RECEIVE_TIMEOUT_MS = 10_000;

async function runStep(step: Step, ws: WebSocket, scenarioDir: string): Promise<void> {
  const stepLabel = `step ${step.step}`;

  if (step.action === "send") {
    if (!step.file) throw new Error(`${stepLabel}: "file" is required for action "send"`);
    const payload = loadStepFile(scenarioDir, step.file);
    ws.send(JSON.stringify(payload));
    return;
  }

  if (step.action === "receive") {
    const received = await waitForMessage(ws, RECEIVE_TIMEOUT_MS);

    if (step.schema) {
      assertSchema(step.schema, received, stepLabel);
    }

    if (step.file && step.matchFields && step.matchFields.length > 0) {
      const expected = loadStepFile(scenarioDir, step.file) as Record<string, unknown>;
      subsetMatch(expected, received, step.matchFields);
    }
    return;
  }

  if (step.action === "receive-stream") {
    if (!step.until) throw new Error(`${stepLabel}: "until" is required for action "receive-stream"`);
    const terminal = loadStepFile(scenarioDir, step.until) as Record<string, unknown>;
    const terminalFields = Object.keys(terminal);

    while (true) {
      const received = await waitForMessage(ws, RECEIVE_TIMEOUT_MS);

      const isTerminal = terminalFields.every(
        (f) =>
          JSON.stringify((received as Record<string, unknown>)[f]) ===
          JSON.stringify(terminal[f])
      );

      if (!isTerminal) {
        if (step.schema) {
          assertSchema(step.schema, received, `${stepLabel} (stream message)`);
        }
      } else {
        if (step.terminalSchema) {
          assertSchema(step.terminalSchema, received, `${stepLabel} (terminal message)`);
        }
        break;
      }
    }
    return;
  }

  throw new Error(`${stepLabel}: unknown action "${(step as Step).action}"`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a client scenario:
 *  1. Connect to the service URL (env-var-interpolated).
 *  2. Execute each step in sequence.
 *  3. Close the connection.
 */
export async function runClient(
  scenario: ClientScenario,
  scenarioDir: string
): Promise<void> {
  const url = expandEnvVars(scenario.url);
  const ws = await connect(url);
  try {
    for (const step of scenario.sequence) {
      await runStep(step, ws, scenarioDir);
    }
  } finally {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}
