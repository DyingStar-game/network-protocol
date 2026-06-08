#!/usr/bin/env node
/**
 * validate.js — CI self-check for network-protocol
 *
 * Finds every *.schema.json file under schemas/ and verifies that:
 *   1. The file is valid JSON.
 *   2. The parsed object is a valid JSON Schema (draft-07) according to ajv's
 *      meta-schema check.
 *
 * Exit code 0 = all schemas valid.
 * Exit code 1 = one or more schemas failed.
 */

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

const ajv = new Ajv({ strict: false, allErrors: true });

const schemasDir = path.join(__dirname, 'schemas');
let failed = 0;
let total  = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
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

walk(schemasDir);

console.log(`\n${total - failed}/${total} schemas valid`);
if (failed > 0) {
  process.exit(1);
}
