// ── Scenario manifest ────────────────────────────────────────────────────────

export type StepAction =
  | "send"
  | "receive"
  | "receive-stream";

/**
 * A single step in a scenario sequence.
 *
 * Common fields:
 *   step        — 1-based position in the sequence (informational)
 *   action      — what to do at this step
 *   schema      — relative path from SCHEMAS_DIR to validate the message against
 *   file        — JSON file whose content is sent (send) or matched (receive)
 *   matchFields — subset of top-level fields to compare on receive (ignores dynamic values like UUIDs)
 *
 * receive-stream specific:
 *   until       — filename of the terminal message that ends the stream;
 *                 every intermediate message is validated against `schema`
 *
 * mock-server specific:
 *   service     — name of the mocked service this step belongs to
 */
export interface Step {
  step: number;
  action: StepAction;
  service?: string;       // mock-server mode only
  file?: string;          // path to JSON payload file (relative to scenario dir)
  schema?: string;        // schema path relative to SCHEMAS_DIR
  matchFields?: string[]; // fields to compare on receive (subset match)
  until?: string;         // receive-stream: terminal message filename
  terminalSchema?: string; // receive-stream: schema to validate the terminal message against
}

/** Service entry for mock-server mode. */
export interface ServiceConfig {
  name: string;
  port: number;
}

/** The parsed contents of a scenario.json manifest. */
export type ScenarioManifest =
  | MockServerScenario
  | ClientScenario;

export interface MockServerScenario {
  name: string;
  mode: "mock-server";
  services: ServiceConfig[];
  sequence: Step[];
}

export interface ClientScenario {
  name: string;
  mode: "client";
  /** WebSocket URL; supports ${ENV_VAR} interpolation. */
  url: string;
  sequence: Step[];
}
