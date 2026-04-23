import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(import.meta.dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("all schemas compile", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  for (const schemaPath of [
    "schemas/common.schema.json",
    "schemas/collector-events.schema.json",
    "schemas/analytics-snapshot.schema.json",
    "schemas/scenario.schema.json",
    "schemas/saved-view.schema.json"
  ]) {
    const schema = await readJson(schemaPath);
    assert.doesNotThrow(() => ajv.compile(schema), schemaPath);
  }
});

test("seed analytics snapshot matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/analytics-snapshot.schema.json");
  const fixture = await readJson("fixtures/analytics-snapshot.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed collector health matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/collector-events.schema.json");
  const fixture = await readJson("fixtures/collector-health.seed.json");
  const validate = ajv.compile(schema.$defs.CollectorHealth);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed collector health matches collector event union", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/collector-events.schema.json");
  const fixture = await readJson("fixtures/collector-health.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed scenario request matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/scenario.schema.json");
  const fixture = await readJson("fixtures/scenario-request.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed saved view matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/saved-view.schema.json");
  const fixture = await readJson("fixtures/saved-view.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});
