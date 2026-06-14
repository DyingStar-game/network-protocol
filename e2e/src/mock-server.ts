import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import WebSocket, { WebSocketServer } from "ws";
import { MockServerScenario, Step } from "./types";
import { assertSchema } from "./validator";

// ── Types ────────────────────────────────────────────────────────────────────

interface ServiceState {
  server: WebSocketServer;
  httpServer: http.Server;
  /** Resolves when the first client connects. */
  connected: Promise<WebSocket>;
  socket: WebSocket | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadStepFile(scenarioDir: string, filename: string): unknown {
  const full = path.join(scenarioDir, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`Step file not found: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
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

function waitForMessage(socket: WebSocket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMsg);
      reject(new Error(`Timeout (${timeoutMs}ms): no message received`));
    }, timeoutMs);

    const onMsg = (raw: WebSocket.RawData) => {
      clearTimeout(timer);
      socket.off("message", onMsg);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        reject(new Error(`Received non-JSON message: ${raw.toString()}`));
        return;
      }
      resolve(parsed);
    };

    socket.on("message", onMsg);
  });
}

// ── Mock server ───────────────────────────────────────────────────────────────

/**
 * Start one WebSocket server per service defined in the scenario.
 * Returns a map of service-name → ServiceState.
 */
function startServers(scenario: MockServerScenario): Map<string, ServiceState> {
  const services = new Map<string, ServiceState>();

  for (const svc of scenario.services) {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    let resolveConnected!: (ws: WebSocket) => void;
    const connected = new Promise<WebSocket>((res) => {
      resolveConnected = res;
    });

    const state: ServiceState = {
      server: wss,
      httpServer,
      connected,
      socket: null,
    };

    wss.on("connection", (ws) => {
      state.socket = ws;
      resolveConnected(ws);
    });

    httpServer.listen(svc.port);
    services.set(svc.name, state);
    console.log(`  [mock] ${svc.name} listening on port ${svc.port}`);
  }

  return services;
}

function stopServers(services: Map<string, ServiceState>): Promise<void[]> {
  const closes: Promise<void>[] = [];

  for (const [, state] of services) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.close();
    }
    closes.push(
      new Promise<void>((res) => state.httpServer.close(() => res()))
    );
  }

  return Promise.all(closes);
}

// ── Step runner ───────────────────────────────────────────────────────────────

const RECEIVE_TIMEOUT_MS = 10_000;

async function runStep(
  step: Step,
  services: Map<string, ServiceState>,
  scenarioDir: string
): Promise<void> {
  const stepLabel = `step ${step.step}`;

  // resolve which socket to use
  const serviceName = step.service;
  if (!serviceName) {
    throw new Error(`${stepLabel}: "service" field is required in mock-server mode`);
  }
  const serviceState = services.get(serviceName);
  if (!serviceState) {
    throw new Error(`${stepLabel}: unknown service "${serviceName}"`);
  }

  // wait for the remote end to be connected before any step that needs a socket
  const socket = await serviceState.connected;

  if (step.action === "send") {
    if (!step.file) throw new Error(`${stepLabel}: "file" is required for action "send"`);
    const payload = loadStepFile(scenarioDir, step.file);
    socket.send(JSON.stringify(payload));
    return;
  }

  if (step.action === "receive") {
    const received = await waitForMessage(socket, RECEIVE_TIMEOUT_MS);

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

    // Collect messages until one fully matches the terminal file fields
    while (true) {
      const received = await waitForMessage(socket, RECEIVE_TIMEOUT_MS);

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
 * Run a mock-server scenario:
 *  1. Start one WS server per service.
 *  2. Execute each step in sequence.
 *  3. Stop all servers.
 */
export async function runMockServer(
  scenario: MockServerScenario,
  scenarioDir: string
): Promise<void> {
  const services = startServers(scenario);
  try {
    for (const step of scenario.sequence) {
      await runStep(step, services, scenarioDir);
    }
  } finally {
    await stopServers(services);
  }
}
