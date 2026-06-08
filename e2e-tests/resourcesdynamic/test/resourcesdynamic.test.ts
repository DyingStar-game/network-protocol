import WebSocket from "ws";
import { expect } from "chai";
import Ajv from "ajv";
import * as fs from "fs";
import * as path from "path";

// ── Schema loader ────────────────────────────────────────────────────────────

const SCHEMAS_DIR = process.env.NETWORK_PROTOCOL_SCHEMAS_DIR
  ?? path.resolve(__dirname, "../../../schemas");

const ajv = new Ajv({ strict: false, allErrors: true });

function loadSchema(schemaRelPath: string) {
  const full = path.join(SCHEMAS_DIR, schemaRelPath);
  const raw = fs.readFileSync(full, "utf8");
  return ajv.compile(JSON.parse(raw));
}

const validateInit           = loadSchema("bridge-resourcesdynamic/init.schema.json");
const validateTransform      = loadSchema("bridge-resourcesdynamic/transform.schema.json");
const validateCreateObject   = loadSchema("bridge-resourcesdynamic/response.create_object.schema.json");
const validateUpdateObject   = loadSchema("bridge-resourcesdynamic/response.update_object.schema.json");

function assertSchema(validate: ReturnType<Ajv["compile"]>, data: unknown, label: string) {
  const ok = validate(data);
  if (!ok) {
    throw new Error(
      `Schema validation failed for ${label}:\n` +
      JSON.stringify(validate.errors, null, 2)
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const WS_URL = process.env.RESOURCESDYNAMIC_WS_URL ?? "ws://localhost:9200";

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg));
}

function waitForMessage(
  ws: WebSocket,
  filter: (msg: unknown) => boolean,
  timeoutMs = 8000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for message`));
    }, timeoutMs);

    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (filter(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resourcesDynamic service — WebSocket protocol", function () {
  this.timeout(15_000);

  let ws: WebSocket;

  before(async () => {
    ws = await connect();
  });

  after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  // ── init ───────────────────────────────────────────────────────────────────

  describe("init", () => {
    it("request conforms to schema and service responds with create_object", async () => {
      const request = {
        event_type: "core",
        namespace: null,
        name: "init",
        payload: {
          system_internal_name: "tarsis",
          duration_s: 3,
          frequency: 60,
          from_timestamp: 1625247600,
        },
      };
      assertSchema(validateInit, request, "init request");
      send(ws, request);

      const response = await waitForMessage(
        ws,
        (msg: any) => msg.event === "create_object" && msg.namespace === "genericprops"
      );
      assertSchema(validateCreateObject, response, "genericprops.create_object response");
    });
  });

  // ── transform ─────────────────────────────────────────────────────────────

  describe("transform", () => {
    it("request conforms to schema and service responds with update_object", async () => {
      const request = {
        event_type: "core",
        namespace: null,
        name: "transform",
        payload: {
          uuid: "ed536e44-c2d7-4deb-bfbf-597bd335db03",
          duration_s: 3,
          frequency: 60,
          from_timestamp: 1625247601,
        },
      };
      assertSchema(validateTransform, request, "transform request");
      send(ws, request);

      const response = await waitForMessage(
        ws,
        (msg: any) => msg.event === "update_object" && msg.namespace === "genericprops"
      );
      assertSchema(validateUpdateObject, response, "genericprops.update_object response");
    });
  });
});
