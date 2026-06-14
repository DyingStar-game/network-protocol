import * as path from "path";
import { globSync } from "glob";
import { run } from "../src/runner";

// ── Scenario discovery ────────────────────────────────────────────────────────

const SCENARIOS_DIR = path.resolve(__dirname, "../scenarios");

// Optional filter: SCENARIO_FILTER=horizon/startup-persistence npm test
const filter = process.env.SCENARIO_FILTER;

const scenarioFiles = globSync("**/scenario.json", { cwd: SCENARIOS_DIR, absolute: true })
  .filter((f) => {
    if (!filter) return true;
    // Match if the scenario path contains the filter string
    return f.includes(filter.replace(/\//g, path.sep));
  })
  .sort();

if (scenarioFiles.length === 0) {
  throw new Error(
    filter
      ? `No scenarios found matching filter: "${filter}"`
      : `No scenario.json files found under ${SCENARIOS_DIR}`
  );
}

// ── Mocha suite ───────────────────────────────────────────────────────────────

describe("E2E scenarios", function () {
  // Allow generous timeout: mock-server scenarios wait for Docker services to start.
  this.timeout(60_000);

  for (const scenarioFile of scenarioFiles) {
    // Derive a human-readable name from the path:
    // .../scenarios/horizon/startup-persistence/scenario.json → "horizon/startup-persistence"
    const rel = path.relative(SCENARIOS_DIR, path.dirname(scenarioFile));
    const label = rel.replace(/\\/g, "/"); // normalise on Windows too

    it(label, async function () {
      await run(scenarioFile);
    });
  }
});
