import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DATA_FILE || join(__dirname, "data", "handled.json");

const units = new Set(["days", "weeks", "months", "years"]);
let writeQueue = Promise.resolve();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function emptyStore() {
  return {
    version: 1,
    settings: { leadTimeDays: 0 },
    categories: [],
    tasks: [],
    logs: []
  };
}

async function loadStore() {
  try {
    const raw = await readFile(dataFile, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const store = emptyStore();
    await saveStore(store);
    return store;
  }
}

function saveStore(store) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(dataFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  });
  return writeQueue;
}

function normalizeStore(input) {
  const store = { ...emptyStore(), ...input };
  store.settings = { leadTimeDays: 0, ...(store.settings || {}) };
  store.categories = Array.isArray(store.categories) ? store.categories : [];
  store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
  store.logs = Array.isArray(store.logs) ? store.logs : [];
  return store;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function cleanString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function cleanInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function addIntervalAtNine(date, value, unit) {
  const next = new Date(date);
  if (unit === "days") next.setDate(next.getDate() + value);
  if (unit === "weeks") next.setDate(next.getDate() + value * 7);
  if (unit === "months") next.setMonth(next.getMonth() + value);
  if (unit === "years") next.setFullYear(next.getFullYear() + value);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

function wholeDaysBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((b - a) / 86_400_000);
}

function serialize(store) {
  const categoriesById = new Map(store.categories.map(category => [category.id, category]));
  return {
    settings: store.settings,
    categories: [...store.categories].sort((a, b) => a.name.localeCompare(b.name, "nl")),
    tasks: store.tasks.map(task => ({
      ...task,
      category: task.categoryId ? categoriesById.get(task.categoryId) || null : null,
      logCount: store.logs.filter(log => log.taskId === task.id).length
    })),
    logs: store.logs
  };
}

function validateTaskPayload(payload, existing = {}) {
  const title = cleanString(payload.title, existing.title);
  if (!title) throw Object.assign(new Error("Titel is verplicht"), { status: 400 });
  const intervalValue = cleanInt(payload.intervalValue, existing.intervalValue || 1, 1, 365);
  const intervalUnit = units.has(payload.intervalUnit) ? payload.intervalUnit : existing.intervalUnit || "weeks";
  const categoryId = payload.categoryId === "" ? null : payload.categoryId ?? existing.categoryId ?? null;
  return { title, intervalValue, intervalUnit, categoryId };
}

function validateCategoryPayload(payload, existing = {}) {
  const name = cleanString(payload.name, existing.name);
  if (!name) throw Object.assign(new Error("Naam is verplicht"), { status: 400 });
  return {
    name,
    icon: cleanString(payload.icon, existing.icon || "folder"),
    colorName: cleanString(payload.colorName, existing.colorName || "blue")
  };
}

async function handleApi(req, res, path) {
  const store = await loadStore();

  if (req.method === "GET" && path === "/api/state") {
    return sendJson(res, 200, serialize(store));
  }

  if (req.method === "PUT" && path === "/api/settings") {
    const payload = await readBody(req);
    store.settings.leadTimeDays = cleanInt(payload.leadTimeDays, 0, 0, 60);
    await saveStore(store);
    return sendJson(res, 200, serialize(store));
  }

  if (req.method === "POST" && path === "/api/example-tasks") {
    const now = new Date();
    const examples = [
      ["Waterfilter vervangen", 6, "months"],
      ["Tandartscontrole", 6, "months"],
      ["Ouders bellen", 2, "weeks"],
      ["Laptop back-up maken", 1, "months"],
      ["Belastingaangifte", 1, "years"]
    ];
    for (const [title, intervalValue, intervalUnit] of examples) {
      store.tasks.push({
        id: randomUUID(),
        title,
        intervalValue,
        intervalUnit,
        lastDone: now.toISOString(),
        nextDue: addIntervalAtNine(now, intervalValue, intervalUnit),
        categoryId: null,
        notificationId: randomUUID()
      });
    }
    await saveStore(store);
    return sendJson(res, 201, serialize(store));
  }

  if (req.method === "POST" && path === "/api/categories") {
    const payload = await readBody(req);
    const category = { id: randomUUID(), ...validateCategoryPayload(payload), createdAt: new Date().toISOString() };
    store.categories.push(category);
    await saveStore(store);
    return sendJson(res, 201, serialize(store));
  }

  const categoryMatch = path.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch) {
    const category = store.categories.find(item => item.id === categoryMatch[1]);
    if (!category) return sendJson(res, 404, { error: "Categorie niet gevonden" });
    if (req.method === "PUT") {
      Object.assign(category, validateCategoryPayload(await readBody(req), category));
      await saveStore(store);
      return sendJson(res, 200, serialize(store));
    }
    if (req.method === "DELETE") {
      store.categories = store.categories.filter(item => item.id !== category.id);
      for (const task of store.tasks) {
        if (task.categoryId === category.id) task.categoryId = null;
      }
      await saveStore(store);
      return sendJson(res, 200, serialize(store));
    }
  }

  if (req.method === "POST" && path === "/api/tasks") {
    const task = {
      id: randomUUID(),
      ...validateTaskPayload(await readBody(req)),
      lastDone: null,
      nextDue: null,
      notificationId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    store.tasks.push(task);
    await saveStore(store);
    return sendJson(res, 201, serialize(store));
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(\/done)?$/);
  if (taskMatch) {
    const task = store.tasks.find(item => item.id === taskMatch[1]);
    if (!task) return sendJson(res, 404, { error: "Taak niet gevonden" });

    if (req.method === "PUT" && !taskMatch[2]) {
      Object.assign(task, validateTaskPayload(await readBody(req), task));
      if (task.lastDone) task.nextDue = addIntervalAtNine(new Date(task.lastDone), task.intervalValue, task.intervalUnit);
      await saveStore(store);
      return sendJson(res, 200, serialize(store));
    }

    if (req.method === "DELETE" && !taskMatch[2]) {
      store.tasks = store.tasks.filter(item => item.id !== task.id);
      store.logs = store.logs.filter(log => log.taskId !== task.id);
      await saveStore(store);
      return sendJson(res, 200, serialize(store));
    }

    if (req.method === "POST" && taskMatch[2]) {
      const now = new Date();
      const daysLate = task.nextDue ? Math.max(0, wholeDaysBetween(task.nextDue, now.toISOString())) : 0;
      store.logs.push({
        id: randomUUID(),
        taskId: task.id,
        doneAt: now.toISOString(),
        dueAt: task.nextDue,
        daysLate
      });
      task.lastDone = now.toISOString();
      task.nextDue = addIntervalAtNine(now, task.intervalValue, task.intervalUnit);
      await saveStore(store);
      return sendJson(res, 200, serialize(store));
    }
  }

  return sendJson(res, 404, { error: "Niet gevonden" });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Niet gevonden");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Serverfout" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Handled draait op http://0.0.0.0:${port}`);
});
