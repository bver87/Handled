const state = {
  settings: { leadTimeDays: 0 },
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

const app = document.querySelector("#app");
const dialog = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Actie mislukt");
  Object.assign(state, payload);
  render();
}

async function load() {
  await api("/api/state");
}

function render() {
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
            ${state.categories.map(category => categoryRow(category, tasksForCategory(category.id))).join("")}
            ${state.categories.length ? "" : `<div class="empty">Nog geen categorieën.</div>`}
          </div>
        </aside>

        <section class="panel">
          <div class="panel-head">
            <div class="detail-title">
              <h2>${escapeHtml(selectedCategory?.name || "Alle taken")}</h2>
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

function categoryRow(category, tasks) {
  const counts = aggregateCounts(tasks);
  const active = state.selectedCategoryId === category.id ? " active" : "";
  return `
    <button class="category-row${active}" data-action="select-category" data-id="${category.id}">
      <span class="category-main">
        <span class="category-icon" style="color: var(--${category.colorName})">${iconLabel(category.icon)}</span>
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
  const category = state.categories.find(item => item.id === task.categoryId);
  return `
    <article class="task-row">
      <div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span>${timeSinceText(task.lastDone)}</span>
          <span>Volgende: ${nextDueText(task.nextDue)}</span>
          <span>Elke ${task.intervalValue} ${unitLabel(task.intervalUnit)}</span>
          ${category ? `<span>${escapeHtml(category.name)}</span>` : ""}
        </div>
        <span class="status ${status.color}">${status.label}</span>
      </div>
      <div class="actions">
        <button class="secondary" data-action="logs" data-id="${task.id}">Logboek</button>
        <button class="secondary" data-action="edit-task" data-id="${task.id}">Bewerk</button>
        <button class="primary" data-action="done" data-id="${task.id}">Net gedaan</button>
        <button class="danger" data-action="delete-task" data-id="${task.id}">Verwijder</button>
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
  return `
    <div class="log-row ${late ? "late" : "ontime"}">
      <div>
        <div class="task-title">${formatDateTime(log.doneAt)}</div>
        <div class="task-meta">${late ? `${log.daysLate} dag(en) te laat` : "Op tijd"}</div>
      </div>
    </div>
  `;
}

function openTaskModal(task = null) {
  const selectedCategoryId = task?.categoryId || (state.selectedCategoryId !== "all" ? state.selectedCategoryId : "");
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>${task ? "Taak wijzigen" : "Nieuwe taak"}</h3>
      <button class="icon-button" value="cancel" formnovalidate>×</button>
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
      <button class="secondary" value="cancel" formnovalidate>Annuleer</button>
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
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>${category ? "Categorie bewerken" : "Categorie toevoegen"}</h3>
      <button class="icon-button" value="cancel" formnovalidate>×</button>
    </div>
    <div class="form-body">
      <label>Naam
        <input name="name" required value="${escapeAttribute(category?.name || "")}" autocomplete="off">
      </label>
      <label>Icoon
        <select name="icon">${icons.map(icon => option(icon, icon, category?.icon || "folder")).join("")}</select>
      </label>
      <label>Kleur
        <select name="colorName">${colors.map(([value, label]) => option(value, label, category?.colorName || "blue")).join("")}</select>
      </label>
    </div>
    <div class="modal-actions">
      <button class="secondary" value="cancel" formnovalidate>Annuleer</button>
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

function openSettingsModal() {
  modalForm.innerHTML = `
    <div class="modal-head">
      <h3>Instellingen</h3>
      <button class="icon-button" value="cancel" formnovalidate>×</button>
    </div>
    <div class="form-body">
      <label>Herinnering vooraf in dagen
        <input name="leadTimeDays" type="number" min="0" max="60" value="${state.settings.leadTimeDays || 0}">
      </label>
    </div>
    <div class="modal-actions">
      <button class="secondary" value="cancel" formnovalidate>Annuleer</button>
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

app.addEventListener("click", event => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === "select-category") {
    state.selectedCategoryId = id;
    render();
  }
  if (action === "add-task") openTaskModal();
  if (action === "edit-task") openTaskModal(state.tasks.find(task => task.id === id));
  if (action === "add-category") openCategoryModal();
  if (action === "edit-category") openCategoryModal(state.categories.find(category => category.id === id));
  if (action === "settings") openSettingsModal();
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

function tasksForSelectedCategory() {
  if (state.selectedCategoryId === "all") return state.tasks;
  return tasksForCategory(state.selectedCategoryId);
}

function tasksForCategory(categoryId) {
  return state.tasks.filter(task => task.categoryId === categoryId);
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

function iconLabel(icon) {
  const parts = icon.split(/[.-]/).filter(Boolean);
  return (parts[0]?.slice(0, 2) || "ca").toUpperCase();
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
