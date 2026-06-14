import Ajv from "ajv";
import * as fs from "fs";
import * as path from "path";

const SCHEMAS_DIR =
  process.env.NETWORK_PROTOCOL_SCHEMAS_DIR ??
  path.resolve(__dirname, "../../schemas");

const ajv = new Ajv({ strict: false, allErrors: true });

const cache = new Map<string, ReturnType<Ajv["compile"]>>();

/**
 * Load and compile a JSON Schema by its path relative to SCHEMAS_DIR.
 * Compiled validators are cached so schemas are only parsed once.
 */
export function loadSchema(schemaRelPath: string): ReturnType<Ajv["compile"]> {
  const cached = cache.get(schemaRelPath);
  if (cached) return cached;

  const full = path.join(SCHEMAS_DIR, schemaRelPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Schema file not found: ${full}`);
  }

  const raw = fs.readFileSync(full, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in schema file ${schemaRelPath}: ${(err as Error).message}`);
  }

  const validate = ajv.compile(parsed as object);
  cache.set(schemaRelPath, validate);
  return validate;
}

/**
 * Validate `data` against the schema at `schemaRelPath`.
 * Throws an Error with AJV details if validation fails.
 */
export function assertSchema(schemaRelPath: string, data: unknown, label: string): void {
  const validate = loadSchema(schemaRelPath);
  const ok = validate(data);
  if (!ok) {
    throw new Error(
      `Schema validation failed for ${label} (schema: ${schemaRelPath}):\n` +
      JSON.stringify(validate.errors, null, 2)
    );
  }
}
