import * as fs from "fs";
import * as path from "path";
import { ScenarioManifest } from "./types";
import { runMockServer } from "./mock-server";
import { runClient } from "./client";

/**
 * Load and parse a scenario.json file.
 * Throws if the file is missing or malformed.
 */
export function loadScenario(scenarioJsonPath: string): ScenarioManifest {
  if (!fs.existsSync(scenarioJsonPath)) {
    throw new Error(`Scenario file not found: ${scenarioJsonPath}`);
  }

  const raw = fs.readFileSync(scenarioJsonPath, "utf8");
  let manifest: ScenarioManifest;
  try {
    manifest = JSON.parse(raw) as ScenarioManifest;
  } catch (err) {
    throw new Error(
      `Invalid JSON in ${scenarioJsonPath}: ${(err as Error).message}`
    );
  }

  if (!manifest.mode) {
    throw new Error(`${scenarioJsonPath}: missing required field "mode"`);
  }
  if (manifest.mode !== "mock-server" && manifest.mode !== "client") {
    throw new Error(
      `${scenarioJsonPath}: unknown mode "${(manifest as ScenarioManifest).mode}". Expected "mock-server" or "client".`
    );
  }

  return manifest;
}

/**
 * Run a scenario from its scenario.json path.
 * Dispatches to the mock-server or client runner depending on `mode`.
 */
export async function run(scenarioJsonPath: string): Promise<void> {
  const scenarioDir = path.dirname(scenarioJsonPath);
  const manifest = loadScenario(scenarioJsonPath);

  console.log(`\nRunning scenario: ${manifest.name} [${manifest.mode}]`);

  if (manifest.mode === "mock-server") {
    await runMockServer(manifest, scenarioDir);
  } else {
    await runClient(manifest, scenarioDir);
  }
}
