import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DATA_FILE || join(__dirname, "data", "handled.json");
const allowRegistration = process.env.ALLOW_REGISTRATION !== "false";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

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
    version: 2,
    settings: { leadTimeDays: 0 },
    users: [],
    sessions: [],
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
  store.version = Math.max(2, Number(store.version || 1));
  store.settings = { leadTimeDays: 0, ...(store.settings || {}) };
  store.users = Array.isArray(store.users) ? store.users : [];
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  store.categories = Array.isArray(store.categories) ? store.categories : [];
  store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
  store.logs = Array.isArray(store.logs) ? store.logs : [];
  for (const task of store.tasks) {
    if (!Array.isArray(task.sharedWith)) task.sharedWith = [];
  }
  return store;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders
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

function cleanEmail(value) {
  return cleanString(value).toLowerCase();
}

function cleanInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cookieMap(req) {
  const cookies = new Map();
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name) cookies.set(name, decodeURIComponent(valueParts.join("=")));
  }
  return cookies;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, keyHex] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !keyHex) return false;
  const stored = Buffer.from(keyHex, "hex");
  const key = await scrypt(password, salt, stored.length);
  return stored.length === key.length && timingSafeEqual(stored, key);
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name || user.email } : null;
}

function authCookie(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `handled_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires}`;
}

function clearAuthCookie() {
  return "handled_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function currentUser(store, req) {
  const token = cookieMap(req).get("handled_session");
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const session = store.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > now);
  if (!session) return null;
  return store.users.find(user => user.id === session.userId) || null;
}

async function createSession(store, user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionTtlMs;
  store.sessions = store.sessions.filter(session => session.expiresAt > Date.now());
  store.sessions.push({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt: new Date().toISOString()
  });
  await saveStore(store);
  return authCookie(token, expiresAt);
}

function removeSession(store, req) {
  const token = cookieMap(req).get("handled_session");
  if (!token) return;
  const tokenHash = hashToken(token);
  store.sessions = store.sessions.filter(session => session.tokenHash !== tokenHash);
}

function ensureFirstUserOwnsLegacyData(store, user) {
  if (store.users.length !== 1) return;
  for (const category of store.categories) {
    if (!category.ownerId) category.ownerId = user.id;
  }
  for (const task of store.tasks) {
    if (!task.ownerId) task.ownerId = user.id;
    if (!Array.isArray(task.sharedWith)) task.sharedWith = [];
  }
}

function canSeeTask(task, user) {
  return task.ownerId === user.id || task.sharedWith?.includes(user.id);
}

function canOwnCategory(category, user) {
  return category.ownerId === user.id;
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

function visibleTasks(store, user) {
  return store.tasks.filter(task => canSeeTask(task, user));
}

function serialize(store, user) {
  const tasks = visibleTasks(store, user);
  const taskIds = new Set(tasks.map(task => task.id));
  const categoriesById = new Map(store.categories.map(category => [category.id, category]));
  const usersById = new Map(store.users.map(item => [item.id, item]));
  return {
    user: publicUser(user),
    settings: store.settings,
    users: store.users.map(publicUser).sort((a, b) => a.email.localeCompare(b.email, "nl")),
    categories: store.categories
      .filter(category => canOwnCategory(category, user))
      .sort((a, b) => a.name.localeCompare(b.name, "nl")),
    tasks: tasks.map(task => ({
      ...task,
      category: task.categoryId ? categoriesById.get(task.categoryId) || null : null,
      owner: publicUser(usersById.get(task.ownerId)),
      sharedUsers: (task.sharedWith || []).map(id => publicUser(usersById.get(id))).filter(Boolean),
      isOwner: task.ownerId === user.id,
      logCount: store.logs.filter(log => log.taskId === task.id).length
    })),
    logs: store.logs.filter(log => taskIds.has(log.taskId))
  };
}

function validateTaskPayload(payload, store, user, existing = {}) {
  const title = cleanString(payload.title, existing.title);
  if (!title) throw Object.assign(new Error("Titel is verplicht"), { status: 400 });
  const intervalValue = cleanInt(payload.intervalValue, existing.intervalValue || 1, 1, 365);
  const intervalUnit = units.has(payload.intervalUnit) ? payload.intervalUnit : existing.intervalUnit || "weeks";
  const requestedCategoryId = payload.categoryId === "" ? null : payload.categoryId ?? existing.categoryId ?? null;
  const categoryId = requestedCategoryId && store.categories.some(category => category.id === requestedCategoryId && category.ownerId === user.id)
    ? requestedCategoryId
    : null;
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

async function handleAuth(req, res, path, store) {
  if (req.method === "GET" && path === "/api/auth/me") {
    return sendJson(res, 200, {
      user: publicUser(currentUser(store, req)),
      hasUsers: store.users.length > 0,
      allowRegistration
    });
  }

  if (req.method === "POST" && path === "/api/auth/register") {
    if (!allowRegistration) return sendJson(res, 403, { error: "Registreren staat uit." });
    const payload = await readBody(req);
    const email = cleanEmail(payload.email);
    const password = String(payload.password || "");
    const name = cleanString(payload.name, email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { error: "Ongeldig e-mailadres." });
    if (password.length < 8) return sendJson(res, 400, { error: "Wachtwoord moet minimaal 8 tekens zijn." });
    if (store.users.some(user => user.email === email)) return sendJson(res, 400, { error: "Dit e-mailadres is al geregistreerd." });

    const user = {
      id: randomUUID(),
      email,
      name,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    ensureFirstUserOwnsLegacyData(store, user);
    const cookie = await createSession(store, user);
    return sendJson(res, 201, { user: publicUser(user) }, { "Set-Cookie": cookie });
  }

  if (req.method === "POST" && path === "/api/auth/login") {
    const payload = await readBody(req);
    const email = cleanEmail(payload.email);
    const password = String(payload.password || "");
    const user = store.users.find(item => item.email === email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return sendJson(res, 400, { error: "E-mail of wachtwoord klopt niet." });
    }
    const cookie = await createSession(store, user);
    return sendJson(res, 200, { user: publicUser(user) }, { "Set-Cookie": cookie });
  }

  if (req.method === "POST" && path === "/api/auth/logout") {
    removeSession(store, req);
    await saveStore(store);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": clearAuthCookie() });
  }

  return null;
}

async function handleApi(req, res, path) {
  const store = await loadStore();

  const authResponse = await handleAuth(req, res, path, store);
  if (authResponse !== null) return authResponse;

  const user = currentUser(store, req);
  if (!user) return sendJson(res, 401, { error: "Niet ingelogd" });

  if (req.method === "GET" && path === "/api/state") {
    return sendJson(res, 200, serialize(store, user));
  }

  if (req.method === "PUT" && path === "/api/settings") {
    const payload = await readBody(req);
    store.settings.leadTimeDays = cleanInt(payload.leadTimeDays, 0, 0, 60);
    await saveStore(store);
    return sendJson(res, 200, serialize(store, user));
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
        ownerId: user.id,
        sharedWith: [],
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
    return sendJson(res, 201, serialize(store, user));
  }

  if (req.method === "POST" && path === "/api/categories") {
    const payload = await readBody(req);
    const category = {
      id: randomUUID(),
      ownerId: user.id,
      ...validateCategoryPayload(payload),
      createdAt: new Date().toISOString()
    };
    store.categories.push(category);
    await saveStore(store);
    return sendJson(res, 201, serialize(store, user));
  }

  const categoryMatch = path.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch) {
    const category = store.categories.find(item => item.id === categoryMatch[1] && item.ownerId === user.id);
    if (!category) return sendJson(res, 404, { error: "Categorie niet gevonden" });
    if (req.method === "PUT") {
      Object.assign(category, validateCategoryPayload(await readBody(req), category));
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }
    if (req.method === "DELETE") {
      store.categories = store.categories.filter(item => item.id !== category.id);
      for (const task of store.tasks) {
        if (task.categoryId === category.id) task.categoryId = null;
      }
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }
  }

  if (req.method === "POST" && path === "/api/tasks") {
    const task = {
      id: randomUUID(),
      ownerId: user.id,
      sharedWith: [],
      ...validateTaskPayload(await readBody(req), store, user),
      lastDone: null,
      nextDue: null,
      notificationId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    store.tasks.push(task);
    await saveStore(store);
    return sendJson(res, 201, serialize(store, user));
  }

  const taskShareMatch = path.match(/^\/api\/tasks\/([^/]+)\/share(?:\/([^/]+))?$/);
  if (taskShareMatch) {
    const task = store.tasks.find(item => item.id === taskShareMatch[1] && item.ownerId === user.id);
    if (!task) return sendJson(res, 404, { error: "Taak niet gevonden" });

    if (req.method === "POST" && !taskShareMatch[2]) {
      const payload = await readBody(req);
      const email = cleanEmail(payload.email);
      const targetUser = store.users.find(item => item.email === email);
      if (!targetUser) return sendJson(res, 404, { error: "Gebruiker niet gevonden." });
      if (targetUser.id === user.id) return sendJson(res, 400, { error: "Je kunt niet met jezelf delen." });
      if (!task.sharedWith.includes(targetUser.id)) task.sharedWith.push(targetUser.id);
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }

    if (req.method === "DELETE" && taskShareMatch[2]) {
      task.sharedWith = task.sharedWith.filter(id => id !== taskShareMatch[2]);
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(\/done)?$/);
  if (taskMatch) {
    const task = store.tasks.find(item => item.id === taskMatch[1] && canSeeTask(item, user));
    if (!task) return sendJson(res, 404, { error: "Taak niet gevonden" });

    if (req.method === "PUT" && !taskMatch[2]) {
      if (task.ownerId !== user.id) return sendJson(res, 403, { error: "Alleen de eigenaar kan deze taak bewerken." });
      Object.assign(task, validateTaskPayload(await readBody(req), store, user, task));
      if (task.lastDone) task.nextDue = addIntervalAtNine(new Date(task.lastDone), task.intervalValue, task.intervalUnit);
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }

    if (req.method === "DELETE" && !taskMatch[2]) {
      if (task.ownerId !== user.id) return sendJson(res, 403, { error: "Alleen de eigenaar kan deze taak verwijderen." });
      store.tasks = store.tasks.filter(item => item.id !== task.id);
      store.logs = store.logs.filter(log => log.taskId !== task.id);
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
    }

    if (req.method === "POST" && taskMatch[2]) {
      const now = new Date();
      const daysLate = task.nextDue ? Math.max(0, wholeDaysBetween(task.nextDue, now.toISOString())) : 0;
      store.logs.push({
        id: randomUUID(),
        taskId: task.id,
        userId: user.id,
        doneAt: now.toISOString(),
        dueAt: task.nextDue,
        daysLate
      });
      task.lastDone = now.toISOString();
      task.nextDue = addIntervalAtNine(now, task.intervalValue, task.intervalUnit);
      await saveStore(store);
      return sendJson(res, 200, serialize(store, user));
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
