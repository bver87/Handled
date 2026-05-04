const state = {
  user: null,
  hasUsers: false,
  allowRegistration: true,
  settings: { leadTimeDays: 0 },
  users: [],
  categories: [],
  tasks: [],
  logs: [],
  selectedCategoryId: "all",
  selectedTaskId: null
};

const units = [
  ["days", "dagen"],
  ["weeks", "weken"],
  ["months", "maanden"],
  ["years", "jaren"]
];

const colors = [
  ["blue", "Blauw"],
  ["green", "Groen"],
  ["orange", "Oranje"],
  ["red", "Rood"],
  ["purple", "Paars"],
  ["teal", "Turquoise"],
  ["gray", "Grijs"]
];

const icons = [
  "folder", "house", "wrench", "clock", "heart", "person.2", "leaf", "tree",
  "car", "cart", "creditcard", "gift", "graduationcap", "flame", "bandage",
  "stethoscope", "airplane", "washer", "dryer", "drop", "bolt", "eurosign.circle"
];

const iconNames = {
  "tray.full": "Alle taken",
  "person.2": "Personen",
  "eurosign.circle": "Euro",
  folder: "Map",
  house: "Huis",
  wrench: "Gereedschap",
  clock: "Klok",
  heart: "Hart",
  leaf: "Blad",
  tree: "Boom",
  car: "Auto",
  cart: "Winkelwagen",
  creditcard: "Betaalkaart",
  gift: "Cadeau",
  graduationcap: "Studie",
  flame: "Vlam",
  bandage: "Zorg",
  stethoscope: "Medisch",
  airplane: "Vliegtuig",
  washer: "Wasmachine",
  dryer: "Droger",
  drop: "Druppel",
  bolt: "Bliksem"
};

const app = document.querySelector("#app");
const dialog = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      state.user = null;
      renderAuth();
    }
    throw new Error(payload.error || "Actie mislukt");
  }
  return payload;
}

async function api(path, options = {}) {
  const payload = await requestJson(path, options);
  Object.assign(state, payload);
  render();
}

async function load() {
  const auth = await requestJson("/api/auth/me");
  Object.assign(state, auth);
  if (!state.user) {
    const resetToken = new URLSearchParams(window.location.search).get("reset");
    if (resetToken) {
      renderAuth("reset", "", resetToken);
      return;
    }
    renderAuth();
    return;
  }
  await api("/api/state");
}

function renderAuth(mode = state.hasUsers ? "login" : "register", error = "", token = "") {
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const title = isReset ? "Kies een nieuw wachtwoord" : isForgot ? "Wachtwoord vergeten" : isRegister ? "Maak je account aan." : "Log in op je overzicht.";
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="auth-brand">
          <img src="/handled.png" alt="">
          <div>
            <h1>Handled</h1>
            <p>${title}</p>
          </div>
        </div>
        ${error ? `<div class="form-error">${escapeHtml(error)}</div>` : ""}
        <form class="auth-form" data-auth-form="${authFormMode(mode)}">
          ${isReset ? `<input type="hidden" name="token" value="${escapeAttribute(token)}">` : ""}
          ${isRegister ? `
            <label>Naam
              <input name="name" autocomplete="name" required>
            </label>
          ` : ""}
          ${!isReset ? `
            <label>E-mail
              <input name="email" type="email" autocomplete="email" required>
            </label>
          ` : ""}
          ${!isForgot ? `
            <label>${isReset ? "Nieuw wachtwoord" : "Wachtwoord"}
              <input name="password" type="password" autocomplete="${isRegister || isReset ? "new-password" : "current-password"}" minlength="8" required>
            </label>
          ` : ""}
          <button class="primary" type="submit">${authSubmitLabel(mode)}</button>
        </form>
        <div class="auth-links">
          ${!isForgot && !isReset ? `<button class="ghost auth-switch" data-auth-mode="forgot">Wachtwoord vergeten</button>` : ""}
          ${state.allowRegistration && !isReset ? `
            <button class="ghost auth-switch" data-auth-mode="${isRegister ? "login" : "register"}">
              ${isRegister ? "Ik heb al een account" : "Nieuw account maken"}
            </button>
          ` : ""}
          ${isForgot || isReset ? `<button class="ghost auth-switch" data-auth-mode="login">Terug naar inloggen</button>` : ""}
        </div>
      </section>
    </main>
  `;
}

function render() {
  if (!state.user) {
    renderAuth();
    return;
  }

  const selectedCategory = state.categories.find(category => category.id === state.selectedCategoryId);
  const visibleTasks = sortedTasks(tasksForSelectedCategory());
  const selectedTask = state.tasks.find(task => task.id === state.selectedTaskId);

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <button class="icon-button" data-action="settings" title="Instellingen">Set</button>
        <div class="brand">
          <img src="/handled.png" alt="">
          <h1>Handled</h1>
        </div>
        <span class="user-pill">${escapeHtml(state.user.email)}</span>
        <button class="secondary" data-action="logout">Uitloggen</button>
        <button class="secondary" data-action="add-category">Categorie</button>
        <button class="primary" data-action="add-task">Taak</button>
      </header>

      <section class="layout">
        <aside class="panel">
          <div class="panel-head">
            <h2>Categorieën</h2>
          </div>
          <div class="category-list">
            ${categoryRow({ id: "all", name: "Alle taken", icon: "tray.full", colorName: "blue" }, state.tasks)}
            ${categoryRow({ id: "shared", name: "Gedeeld met mij", icon: "person.2", colorName: "teal" }, sharedWithMeTasks())}
            ${state.categories.map(category => categoryRow(category, tasksForCategory(category.id))).join("")}
            ${state.categories.length ? "" : `<div class="empty">Nog geen eigen categorieën.</div>`}
          </div>
        </aside>

        <section class="panel">
          <div class="panel-head">
            <div class="detail-title">
              <h2>${escapeHtml(detailTitle(selectedCategory))}</h2>
              <span>${visibleTasks.length} ${visibleTasks.length === 1 ? "taak" : "taken"}</span>
            </div>
            ${selectedCategory ? `
              <div class="actions">
                <button class="secondary" data-action="edit-category" data-id="${selectedCategory.id}">Bewerk</button>
                <button class="danger" data-action="delete-category" data-id="${selectedCategory.id}">Verwijder</button>
              </div>
            ` : ""}
          </div>
          <div class="task-list">
            ${visibleTasks.length ? visibleTasks.map(taskRow).join("") : emptyTasks()}
          </div>
        </section>

        ${selectedTask ? logPanel(selectedTask) : ""}
      </section>
    </main>
  `;
}

function detailTitle(selectedCategory) {
  if (state.selectedCategoryId === "shared") return "Gedeeld met mij";
  return selectedCategory?.name || "Alle taken";
}

function categoryRow(category, tasks) {
  const counts = aggregateCounts(tasks);
  const active = state.selectedCategoryId === category.id ? " active" : "";
  return `
    <button class="category-row${active}" data-action="select-category" data-id="${category.id}">
      <span class="category-main">
        <span class="category-icon" style="color: var(--${category.colorName})">${iconSvg(category.icon)}</span>
        <span class="category-name">${escapeHtml(category.name)}</span>
        <span class="count">${tasks.length}</span>
      </span>
      <span class="status-grid">
        ${statusCell("gray", counts.gray)}
        ${statusCell("green", counts.green)}
        ${statusCell("orange", counts.orange)}
        ${statusCell("red", counts.red)}
      </span>
    </button>
  `;
}

function statusCell(color, value) {
  return `<span class="status-cell"><span class="dot ${color}"></span>${value}</span>`;
}

function taskRow(task) {
  const status = computeStatus(task);
  const category = task.category || state.categories.find(item => item.id === task.categoryId);
  const sharedLabel = task.isOwner && task.sharedUsers.length
    ? `Gedeeld met ${task.sharedUsers.map(user => user.email).join(", ")}`
    : "";
  const ownerLabel = task.isOwner ? "Eigen taak" : `Van ${task.owner?.email || "onbekend"}`;

  return `
    <article class="task-row">
      <div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span>${timeSinceText(task.lastDone)}</span>
          <span>Volgende: ${nextDueText(task.nextDue)}</span>
          <span>Elke ${task.intervalValue} ${unitLabel(task.intervalUnit)}</span>
          ${category ? `<span>${escapeHtml(category.name)}</span>` : ""}
          <span>${escapeHtml(ownerLabel)}</span>
          ${sharedLabel ? `<span>${escapeHtml(sharedLabel)}</span>` : ""}
        </div>
        <span class="status ${status.color}">${status.label}</span>
      </div>
      <div class="actions">
        <button class="secondary" data-action="logs" data-id="${task.id}">Logboek</button>
        ${task.isOwner ? `<button class="secondary" data-action="share-task" data-id="${task.id}">Delen</button>` : ""}
        ${task.isOwner ? `<button class="secondary" data-action="edit-task" data-id="${task.id}">Bewerk</button>` : ""}
        <button class="primary" data-action="done" data-id="${task.id}">Net gedaan</button>
        ${task.isOwner ? `<button class="danger" data-action="delete-task" data-id="${task.id}">Verwijder</button>` : ""}
      </div>
    </article>
  `;
}

function emptyTasks() {
  const exampleButton = state.tasks.length === 0
    ? `<button class="primary" data-action="examples">Voorbeeldtaken toevoegen</button>`
    : "";
  return `
    <div class="empty">
      <strong>Geen taken</strong>
      <p>Voeg een taak toe met de knop bovenin.</p>
      ${exampleButton}
    </div>
  `;
}

function logPanel(task) {
  const logs = state.logs
    .filter(log => log.taskId === task.id)
    .sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt))
    .slice(0, 30);
  const avgLate = average(logs.map(log => log.daysLate));
  const avgInterval = averageInterval(logs);

  return `
    <section class="panel log-panel">
      <div class="panel-head">
        <div class="detail-title">
          <h2>Logboek</h2>
          <span>${escapeHtml(task.title)}</span>
        </div>
        <button class="icon-button" data-action="close-logs" title="Sluit">×</button>
      </div>
      <div class="summary">
        <div class="metric"><span>Gemiddelde tijd tussen acties</span><strong>${avgInterval == null ? "—" : `${avgInterval.toFixed(1)} dagen`}</strong></div>
        <div class="metric"><span>Gemiddeld te laat</span><strong>${avgLate.toFixed(1)} dagen</strong></div>
      </div>
      <div class="log-list">
        ${logs.length ? logs.map(logRow).join("") : `<div class="empty">Nog geen logboek.</div>`}
      </div>
    </section>
  `;
}

function logRow(log) {
  const late = log.daysLate > 0;
  const user = state.users.find(item => item.id === log.userId);
  return `
    <div class="log-row ${late ? "late" : "ontime"}">
      <div>
        <div class="task-title">${formatDateTime(log.doneAt)}</div>
        <div class="task-meta">
          <span>${late ? `${log.daysLate} dag(en) te laat` : "Op tijd"}</span>
          ${user ? `<span>Door ${escapeHtml(user.email)}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

function openTaskModal(task = null) {
  const selectedCategoryId = task?.categoryId || (state.selectedCategoryId !== "all" && state.selectedCategoryId !== "shared" ? state.selectedCategoryId : "");
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>${task ? "Taak wijzigen" : "Nieuwe taak"}</h3>
      <button class="icon-button" type="button" data-modal-close>×</button>
    </div>
    <div class="form-body">
      <label>Titel
        <input name="title" required value="${escapeAttribute(task?.title || "")}" autocomplete="off">
      </label>
      <div class="form-grid">
        <label>Elke
          <input name="intervalValue" type="number" min="1" max="365" required value="${task?.intervalValue || 1}">
        </label>
        <label>Interval
          <select name="intervalUnit">${units.map(([value, label]) => option(value, label, task?.intervalUnit || "weeks")).join("")}</select>
        </label>
      </div>
      <label>Categorie
        <select name="categoryId">
          <option value="">Geen categorie</option>
          ${state.categories.map(category => option(category.id, category.name, selectedCategoryId)).join("")}
        </select>
      </label>
    </div>
    <div class="modal-actions">
      <button class="secondary" type="button" data-modal-close>Annuleer</button>
      <button class="primary" value="default">Bewaar</button>
    </div>
  `;
  modalForm.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(modalForm));
    const method = task ? "PUT" : "POST";
    const path = task ? `/api/tasks/${task.id}` : "/api/tasks";
    api(path, { method, body: data }).then(() => dialog.close()).catch(showError);
  };
  dialog.showModal();
}

function openCategoryModal(category = null) {
  const selectedIcon = category?.icon || "folder";
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>${category ? "Categorie bewerken" : "Categorie toevoegen"}</h3>
      <button class="icon-button" type="button" data-modal-close>×</button>
    </div>
    <div class="form-body">
      <label>Naam
        <input name="name" required value="${escapeAttribute(category?.name || "")}" autocomplete="off">
      </label>
      <label>Icoon
        <input type="hidden" name="icon" value="${escapeAttribute(selectedIcon)}">
        <span class="icon-picker">
          ${icons.map(icon => iconChoice(icon, selectedIcon)).join("")}
        </span>
      </label>
      <label>Kleur
        <select name="colorName">${colors.map(([value, label]) => option(value, label, category?.colorName || "blue")).join("")}</select>
      </label>
    </div>
    <div class="modal-actions">
      <button class="secondary" type="button" data-modal-close>Annuleer</button>
      <button class="primary" value="default">Bewaar</button>
    </div>
  `;
  modalForm.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(modalForm));
    const method = category ? "PUT" : "POST";
    const path = category ? `/api/categories/${category.id}` : "/api/categories";
    api(path, { method, body: data }).then(() => dialog.close()).catch(showError);
  };
  dialog.showModal();
}

function openShareModal(task) {
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>Taak delen</h3>
      <button class="icon-button" type="button" data-modal-close>×</button>
    </div>
    <div class="form-body">
      <p class="muted-line">${escapeHtml(task.title)}</p>
      <label>E-mail van gebruiker
        <input name="email" type="email" required autocomplete="off">
      </label>
      ${task.sharedUsers.length ? `
        <div class="shared-list">
          ${task.sharedUsers.map(user => `
            <span class="shared-user">
              ${escapeHtml(user.email)}
              <button type="button" data-unshare="${escapeAttribute(user.id)}" data-task-id="${escapeAttribute(task.id)}">×</button>
            </span>
          `).join("")}
        </div>
      ` : ""}
    </div>
    <div class="modal-actions">
      <button class="secondary" type="button" data-modal-close>Annuleer</button>
      <button class="primary" value="default">Delen</button>
    </div>
  `;
  modalForm.onsubmit = event => {
    event.preventDefault();
    api(`/api/tasks/${task.id}/share`, {
      method: "POST",
      body: Object.fromEntries(new FormData(modalForm))
    }).then(() => dialog.close()).catch(showError);
  };
  dialog.showModal();
}

function openSettingsModal() {
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>Instellingen</h3>
      <button class="icon-button" type="button" data-modal-close>×</button>
    </div>
    <div class="form-body">
      <label>Herinnering vooraf in dagen
        <input name="leadTimeDays" type="number" min="0" max="60" value="${state.settings.leadTimeDays || 0}">
      </label>
    </div>
    <div class="modal-actions">
      <button class="secondary" type="button" data-modal-close>Annuleer</button>
      <button class="primary" value="default">Bewaar</button>
    </div>
  `;
  modalForm.onsubmit = event => {
    event.preventDefault();
    api("/api/settings", { method: "PUT", body: Object.fromEntries(new FormData(modalForm)) })
      .then(() => dialog.close())
      .catch(showError);
  };
  dialog.showModal();
}

app.addEventListener("submit", event => {
  const form = event.target.closest("[data-auth-form]");
  if (!form) return;
  event.preventDefault();
  const mode = form.dataset.authForm;
  requestJson(`/api/auth/${mode}`, {
    method: "POST",
    body: Object.fromEntries(new FormData(form))
  })
    .then(payload => {
      if (mode === "forgot") {
        renderAuth("forgot", payload.message || "Controleer de serverlogs voor de resetlink.");
        return;
      }
      if (mode === "reset") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      load();
    })
    .catch(error => renderAuth(mode, error.message));
});

app.addEventListener("click", event => {
  const authMode = event.target.closest("[data-auth-mode]");
  if (authMode) {
    renderAuth(authMode.dataset.authMode);
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === "select-category") {
    state.selectedCategoryId = id;
    render();
  }
  if (action === "add-task") openTaskModal();
  if (action === "edit-task") openTaskModal(state.tasks.find(task => task.id === id));
  if (action === "share-task") openShareModal(state.tasks.find(task => task.id === id));
  if (action === "add-category") openCategoryModal();
  if (action === "edit-category") openCategoryModal(state.categories.find(category => category.id === id));
  if (action === "settings") openSettingsModal();
  if (action === "logout") requestJson("/api/auth/logout", { method: "POST" }).then(() => load()).catch(showError);
  if (action === "done") api(`/api/tasks/${id}/done`, { method: "POST" }).catch(showError);
  if (action === "logs") {
    state.selectedTaskId = id;
    render();
  }
  if (action === "close-logs") {
    state.selectedTaskId = null;
    render();
  }
  if (action === "examples") api("/api/example-tasks", { method: "POST" }).catch(showError);
  if (action === "delete-task" && confirm("Taak verwijderen?")) {
    api(`/api/tasks/${id}`, { method: "DELETE" }).catch(showError);
  }
  if (action === "delete-category" && confirm("Categorie verwijderen? Taken blijven bestaan.")) {
    api(`/api/categories/${id}`, { method: "DELETE" }).catch(showError);
  }
});

modalForm.addEventListener("click", event => {
  if (event.target.closest("[data-modal-close]")) {
    dialog.close();
  }

  const iconButton = event.target.closest("[data-icon-choice]");
  if (iconButton) {
    modalForm.elements.icon.value = iconButton.dataset.iconChoice;
    modalForm.querySelectorAll("[data-icon-choice]").forEach(button => {
      button.classList.toggle("active", button === iconButton);
    });
  }

  const unshareButton = event.target.closest("[data-unshare]");
  if (unshareButton) {
    api(`/api/tasks/${unshareButton.dataset.taskId}/share/${unshareButton.dataset.unshare}`, { method: "DELETE" })
      .then(() => dialog.close())
      .catch(showError);
  }
});

function tasksForSelectedCategory() {
  if (state.selectedCategoryId === "all") return state.tasks;
  if (state.selectedCategoryId === "shared") return sharedWithMeTasks();
  return tasksForCategory(state.selectedCategoryId);
}

function tasksForCategory(categoryId) {
  return state.tasks.filter(task => task.categoryId === categoryId);
}

function sharedWithMeTasks() {
  return state.tasks.filter(task => !task.isOwner);
}

function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const pa = sortPriority(a);
    const pb = sortPriority(b);
    if (pa !== pb) return pa - pb;
    if (pa === 3) return a.title.localeCompare(b.title, "nl", { sensitivity: "base" });
    return new Date(a.nextDue || "9999-12-31") - new Date(b.nextDue || "9999-12-31");
  });
}

function sortPriority(task) {
  const status = computeStatus(task);
  return { red: 0, orange: 1, green: 2, gray: 3 }[status.color];
}

function computeStatus(task) {
  if (!task.lastDone || !task.nextDue) return { color: "gray", label: "Nog niet gestart" };
  const daysPastDue = wholeDaysBetween(task.nextDue, new Date().toISOString());
  if (daysPastDue > 0) return { color: "red", label: `${daysPastDue} dag(en) te laat` };
  const total = new Date(task.nextDue) - new Date(task.lastDone);
  const elapsed = Date.now() - new Date(task.lastDone).getTime();
  const progress = total <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / total));
  if (progress >= 0.9) return { color: "orange", label: "Bijna weer nodig" };
  return { color: "green", label: "Op schema" };
}

function aggregateCounts(tasks) {
  return tasks.reduce((counts, task) => {
    counts[computeStatus(task).color] += 1;
    return counts;
  }, { gray: 0, green: 0, orange: 0, red: 0 });
}

function wholeDaysBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((b - a) / 86400000);
}

function timeSinceText(date) {
  if (!date) return "Nog nooit gedaan";
  const days = wholeDaysBetween(date, new Date().toISOString());
  if (days === 0) return "Vandaag";
  if (days === 1) return "1 dag geleden";
  return `${days} dagen geleden`;
}

function nextDueText(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(date));
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageInterval(logs) {
  if (logs.length < 2) return null;
  const asc = [...logs].sort((a, b) => new Date(a.doneAt) - new Date(b.doneAt));
  const deltas = [];
  for (let index = 1; index < asc.length; index += 1) {
    const days = (new Date(asc[index].doneAt) - new Date(asc[index - 1].doneAt)) / 86400000;
    if (days > 0) deltas.push(days);
  }
  return deltas.length ? average(deltas) : null;
}

function unitLabel(value) {
  return units.find(([unit]) => unit === value)?.[1] || value;
}

function authFormMode(mode) {
  if (mode === "forgot") return "forgot";
  if (mode === "reset") return "reset";
  return mode === "register" ? "register" : "login";
}

function authSubmitLabel(mode) {
  if (mode === "forgot") return "Resetlink maken";
  if (mode === "reset") return "Wachtwoord wijzigen";
  return mode === "register" ? "Account maken" : "Inloggen";
}

function iconSvg(icon) {
  const paths = {
    "tray.full": '<path d="M4 14h4l2 3h4l2-3h4"/><path d="M5 4h14l2 10v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5L5 4Z"/>',
    "person.2": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "eurosign.circle": '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5a4.5 4.5 0 1 0 0 7"/><path d="M7 10.5h7"/><path d="M7 13.5h6"/>',
    folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z"/>',
    house: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.7-8.7a4 4 0 0 0-2-2Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
    leaf: '<path d="M21 3S6 4 4 14a6 6 0 0 0 6 7c10-2 11-18 11-18Z"/><path d="M4 20c4-6 9-9 17-17"/>',
    tree: '<path d="M12 22v-7"/><path d="M7 15h10l-3-4h2l-4-7-4 7h2l-3 4Z"/>',
    car: '<path d="M5 17h14l1-6-2-5H6l-2 5 1 6Z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/><path d="M4 11h16"/>',
    cart: '<circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/><path d="M3 4h2l2.4 11.5A2 2 0 0 0 9.4 17H17a2 2 0 0 0 2-1.6L20 8H6"/>',
    creditcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M3 12h18"/><path d="M7.5 8A2.5 2.5 0 1 1 12 6.5V8"/><path d="M16.5 8A2.5 2.5 0 1 0 12 6.5V8"/>',
    graduationcap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v6"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-7-4-10-2 2-3 4-3 6-2-1-3-3-3-5-2 2-4 5-4 9a7 7 0 0 0 7 7Z"/>',
    bandage: '<rect x="3" y="8" width="18" height="8" rx="3" transform="rotate(-35 12 12)"/><path d="M10 10h.01"/><path d="M14 14h.01"/><path d="M12 12h.01"/>',
    stethoscope: '<path d="M6 4v5a4 4 0 0 0 8 0V4"/><path d="M10 13v3a4 4 0 0 0 8 0v-2"/><circle cx="18" cy="12" r="2"/>',
    airplane: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/>',
    washer: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 7h.01"/><path d="M11 7h5"/>',
    dryer: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M9 13c2-2 4 2 6 0"/><path d="M8 7h.01"/><path d="M11 7h5"/>',
    drop: '<path d="M12 22a7 7 0 0 0 7-7c0-5-7-13-7-13S5 10 5 15a7 7 0 0 0 7 7Z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z"/>'
  };
  return `<svg class="symbol-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[icon] || paths.folder}</svg>`;
}

function iconChoice(icon, selectedIcon) {
  const active = icon === selectedIcon ? " active" : "";
  return `
    <button class="icon-choice${active}" type="button" data-icon-choice="${escapeAttribute(icon)}" title="${escapeAttribute(iconNames[icon] || icon)}">
      ${iconSvg(icon)}
    </button>
  `;
}

function option(value, label, selected) {
  return `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function showError(error) {
  alert(error.message || "Actie mislukt");
}

load().catch(showError);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
