import { test, after } from "node:test";
import { once } from "node:events";
import assert from "node:assert/strict";
import { start } from "./server.mjs";
import { classify } from "./mock-ai.mjs";

const server = start(0);
await once(server, "listening");

async function post(body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("invalid input returns 400 invalid_input", async () => {
  for (const body of [{}, { text: "" }, { text: 42 }, { text: null }, "not json"]) {
    const result = await post(body);
    assert.deepEqual(result, { status: 400, body: { status: "invalid_input" } });
  }
});

test("valid model response returns ready", async () => {
  const result = await post({ text: "Когда доставка?" });
  assert.deepEqual(result, {
    status: 200,
    body: { status: "ready", topic: "delivery", draft: "Спасибо за обращение. Уточним детали заявки." },
  });
});

test("model failure scenarios return manual_review", async () => {
  for (const text of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const result = await post({ text });
    assert.deepEqual(result, { status: 200, body: { status: "manual_review", topic: null, draft: null } });
  }
});

test("timeout is capped near 300ms", async () => {
  const startAt = Date.now();
  const result = await post({ text: "[timeout]" });
  assert.equal(result.body.status, "manual_review");
  const elapsed = Date.now() - startAt;
  // Порог не ровно 300 мс: к 300 мс таймаута добавляется планирование
  // fetch/HTTP на той же машине, поэтому допускаем запас до 800 мс.
  assert.ok(elapsed < 800, `expected under 800ms, got ${elapsed}ms`);
});

test("timeout signal is propagated and cancels classify", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(classify("[timeout]", { signal: controller.signal }), { name: "AbortError" });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});
