// Tiny SPA: history.pushState route changes between Overview and Reports, plus a button that loads slowly.
const TITLES = { overview: "Dashboard – Acme Books", reports: "Reports – Acme Books" };
const PATHS = { overview: "/dashboard/", reports: "/dashboard/reports" };
const view = document.getElementById("view");
const heading = document.getElementById("page-heading");
const status = document.getElementById("dash-status");

const BOOKS = [
  ["Dune", "Frank Herbert", 12],
  ["Middlemarch", "George Eliot", 4],
  ["Kindred", "Octavia Butler", 9],
];

function overview() {
  view.innerHTML = `
    <div class="stats">
      <div class="stat"><b>128</b><span>Invoices this month</span></div>
      <div class="stat"><b>$14,320</b><span>Revenue</span></div>
      <div class="stat" data-testid="stat-overdue"><b>7</b><span>Overdue</span></div>
    </div>
    <section class="card" aria-labelledby="books-h">
      <h2 id="books-h">Books</h2>
      <table>
        <thead><tr><th scope="col">Title</th><th scope="col">Author</th><th scope="col">In stock</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
        <tbody>${BOOKS.map(([t, a, n]) => `<tr><td>${t}</td><td>${a}</td><td>${n}</td><td><button class="btn edit" type="button" aria-label="Edit ${t}">Edit</button></td></tr>`).join("")}</tbody>
      </table>
    </section>
    <section class="card" aria-labelledby="tools-h">
      <h2 id="tools-h">Tools</h2>
      <div class="row">
        <a id="help-link" class="btn" href="/help.html" target="_blank" rel="noopener">Help centre</a>
        <span id="export-slot" class="muted">Preparing export…</span>
      </div>
    </section>`;
  // The export button only appears after the (simulated) report finishes generating.
  setTimeout(() => {
    const slot = document.getElementById("export-slot");
    if (!slot) return;
    const b = document.createElement("button");
    b.id = "export-csv";
    b.type = "button";
    b.className = "btn primary";
    b.textContent = "Export CSV";
    b.addEventListener("click", () => (status.textContent = "Export started"));
    slot.replaceWith(b);
  }, 1200);
}

function reports() {
  view.innerHTML = `
    <section class="card" aria-labelledby="rep-h">
      <h2 id="rep-h">Quarterly summary</h2>
      <p class="muted">Revenue is up 8% on last quarter.</p>
      <button id="download-report" class="btn primary" type="button" data-testid="download-report">Download report</button>
    </section>`;
  document.getElementById("download-report").addEventListener("click", () => (status.textContent = "Report downloaded"));
}

function render(route) {
  const r = route === "reports" ? "reports" : "overview";
  heading.textContent = r === "reports" ? "Reports" : "Overview";
  document.title = TITLES[r];
  for (const a of document.querySelectorAll("nav a[data-route]")) {
    if (a.dataset.route === r) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  status.textContent = "";
  (r === "reports" ? reports : overview)();
}

function routeFromPath() {
  return location.pathname.endsWith("/reports") ? "reports" : "overview";
}

document.querySelector("nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-route]");
  if (!a) return;
  e.preventDefault();
  const route = a.dataset.route;
  history.pushState({ route }, "", PATHS[route]);
  render(route);
});
window.addEventListener("popstate", () => render(routeFromPath()));

document.getElementById("add-book").addEventListener("click", () => (status.textContent = "Book added"));
document.getElementById("notifications-btn").addEventListener("click", () => (status.textContent = "No new notifications"));
document.getElementById("search-btn").addEventListener("click", () => (status.textContent = "Search is not part of this fixture"));

render(routeFromPath());
