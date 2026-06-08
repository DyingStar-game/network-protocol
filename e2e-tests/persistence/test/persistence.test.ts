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

const validateEnvelope        = loadSchema("bridge-persistence/bridge_envelope.schema.json");
const validateCreateObject    = loadSchema("bridge-persistence/create_object.schema.json");
const validateGetAllItems     = loadSchema("bridge-persistence/get_all_items.schema.json");
const validateItemsChunk      = loadSchema("bridge-persistence/response.items_chunk.schema.json");
const validateItemsEnd        = loadSchema("bridge-persistence/response.items_end.schema.json");

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

const WS_URL = process.env.PERSISTENCE_WS_URL ?? "ws://localhost:9100";

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function send(ws: WebSocket, envelope: object): void {
  const json = JSON.stringify(envelope);
  ws.send(json);
}

/** Collect all messages until one satisfies `until`, with a timeout. */
function collectUntil(
  ws: WebSocket,
  until: (msg: unknown) => boolean,
  timeoutMs = 8000
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const collected: unknown[] = [];
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for terminal message`));
    }, timeoutMs);

    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      collected.push(msg);
      if (until(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(collected);
      }
    };

    ws.on("message", onMsg);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("persistence service — WebSocket protocol", function () {
  this.timeout(15_000);

  let ws: WebSocket;
  const testUuid = "11111111-2222-3333-4444-555555555555";

  before(async () => {
    ws = await connect();
  });

  after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  // ── create_object ──────────────────────────────────────────────────────────

  describe("create_object", () => {
    it("message conforms to schema before sending", () => {
      const msg = {
        event_type: "core",
        namespace: null,
        name: "create_object",
        payload: {
          object_type: "box50cm",
          object_uuid: testUuid,
          object_data: {
            position: { x: 1.0, y: 2.0, z: 3.0 },
            rotation: { x: 0.0, y: 0.0, z: 0.0 },
            scenename: "scenes/props/box50cm.tscn",
          },
        },
      };
      assertSchema(validateCreateObject, msg, "create_object request");
      assertSchema(validateEnvelope, msg, "envelope");
      send(ws, msg);
    });
  });

  // ── get_all_items → items_chunk* → items_end ───────────────────────────────

  describe("get_all_items", () => {
    it("request conforms to schema before sending, responses conform to schema", async () => {
      const request = {
        event_type: "core",
        namespace: null,
        name: "get_all_items",
        payload: {},
      };
      assertSchema(validateGetAllItems, request, "get_all_items request");
      assertSchema(validateEnvelope, request, "envelope");

      send(ws, request);

      const messages = await collectUntil(
        ws,
        (msg: any) => msg.name === "items_end"
      );

      expect(messages.length).to.be.greaterThan(0, "Expected at least items_end message");

      for (const msg of messages) {
        // Every response must be a valid bridge envelope
        assertSchema(validateEnvelope, msg, `response envelope (name=${(msg as any).name})`);

        const name = (msg as any).name;
        if (name === "items_chunk") {
          assertSchema(validateItemsChunk, msg, "items_chunk response");
        } else if (name === "items_end") {
          assertSchema(validateItemsEnd, msg, "items_end response");
        }
      }
    });
  });

  // ── update_object ──────────────────────────────────────────────────────────

  describe("update_object", () => {
    it("message conforms to schema before sending", () => {
      const validateUpdateObject = loadSchema("bridge-persistence/update_object.schema.json");
      const msg = {
        event_type: "core",
        namespace: null,
        name: "update_object",
        payload: {
          object_type: "box50cm",
          object_uuid: testUuid,
          object_data: {
            position: { x: 5.0, y: 5.0, z: 5.0 },
          },
        },
      };
      assertSchema(validateUpdateObject, msg, "update_object request");
      assertSchema(validateEnvelope, msg, "envelope");
      send(ws, msg);
    });
  });
});
