import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT_MS = 300;

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body?.text !== "string" || body.text.length === 0) return null;
  return body.text;
}

async function handleTriage(request, response) {
  const text = parseInput(await readBody(request));
  if (text === null) return json(response, 400, { status: "invalid_input" });

  let result;
  try {
    result = JSON.parse(await classify(text, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }));
  } catch {
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }

  if (ALLOWED_TOPICS.has(result?.topic) && typeof result?.draft === "string" && result.draft.trim().length > 0) {
    return json(response, 200, { status: "ready", topic: result.topic, draft: result.draft });
  }
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

export function start(port = Number(process.env.PORT || 3000)) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  }).listen(port, "127.0.0.1");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

