#!/usr/bin/env node
/**
 * validate.js — CI self-check for network-protocol
 *
 * 1. Finds every *.schema.json file under schemas/ and verifies that:
 *      a. The file is valid JSON.
 *      b. The parsed object is a valid JSON Schema (draft-07) according to ajv's
 *         meta-schema check.
 *
 * 2. Finds every scenario.json file under e2e/scenarios/ and validates it
 *    against schemas/e2e-scenario.schema.json.
 *
 * Exit code 0 = all checks pass.
 * Exit code 1 = one or more checks failed.
 */

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

const ajv = new Ajv({ strict: false, allErrors: true });

const schemasDir   = path.join(__dirname, 'schemas');
const scenariosDir = path.join(__dirname, 'e2e', 'scenarios');
let failed = 0;
let total  = 0;

// ── 1. Validate all *.schema.json files ──────────────────────────────────────

function walkSchemas(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSchemas(full);
    } else if (entry.name.endsWith('.schema.json')) {
      total++;
      const rel = path.relative(__dirname, full);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (err) {
        console.error(`FAIL  ${rel}\n      Invalid JSON: ${err.message}`);
        failed++;
        continue;
      }
      try {
        // Compiling the schema validates its structure against the JSON Schema
        // meta-schema. ajv throws if the schema itself is malformed.
        ajv.compile(parsed);
        console.log(`ok    ${rel}`);
      } catch (err) {
        console.error(`FAIL  ${rel}\n      Invalid schema: ${err.message}`);
        failed++;
      }
    }
  }
}

walkSchemas(schemasDir);

// ── 2. Validate scenario.json files against e2e-scenario.schema.json ─────────

const scenarioSchemaPath = path.join(schemasDir, 'e2e-scenario.schema.json');

if (fs.existsSync(scenarioSchemaPath) && fs.existsSync(scenariosDir)) {
  const scenarioSchema = JSON.parse(fs.readFileSync(scenarioSchemaPath, 'utf8'));
  const validateScenario = ajv.compile(scenarioSchema);

  function walkScenarios(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkScenarios(full);
      } else if (entry.name === 'scenario.json') {
        total++;
        const rel = path.relative(__dirname, full);
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch (err) {
          console.error(`FAIL  ${rel}\n      Invalid JSON: ${err.message}`);
          failed++;
          continue;
        }
        const ok = validateScenario(parsed);
        if (!ok) {
          console.error(
            `FAIL  ${rel}\n      Schema violations:\n` +
            JSON.stringify(validateScenario.errors, null, 2)
          );
          failed++;
        } else {
          console.log(`ok    ${rel}`);
        }
      }
    }
  }

  walkScenarios(scenariosDir);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${total - failed}/${total} checks passed`);
if (failed > 0) {
  process.exit(1);
}
