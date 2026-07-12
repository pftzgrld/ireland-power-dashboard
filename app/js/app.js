/* app.js — controller: load data, paint tiles, wire tabs. */

function renderTiles() {
  const tiles = M.tiles();
  const html = tiles.map((t) => `
    <div class="tile">
      <div class="k">${t.k}</div>
      <div class="v">${t.v}<span class="u">${t.u || ""}</span></div>
      ${t.sub ? `<div class="sub2">${t.sub}</div>` : ""}
    </div>`).join("");
  const el = document.getElementById("tiles");
  if (el) el.innerHTML = html;

  // renewables tab shares the wind-relevant subset
  const ren = document.getElementById("tiles-ren");
  if (ren) {
    ren.innerHTML = tiles.filter((t) =>
      ["Wind output", "Wind share", "SNSP", "System demand"].includes(t.k))
      .map((t) => `<div class="tile"><div class="k">${t.k}</div>
        <div class="v">${t.v}<span class="u">${t.u || ""}</span></div></div>`).join("");
  }
}

function renderCurtailment() {
  const r = DATA.region;
  const tiles = [
    { k: "Wind dispatched down", v: CURTAIL.wind[r], u: "%", sub: `${r} · 2024` },
    { k: "Wind energy lost", v: (CURTAIL.windGWh[r] / 1000).toFixed(2), u: "TWh", sub: "dispatched down, 2024" },
    { k: "Solar dispatched down", v: CURTAIL.solar[r], u: "%", sub: "2024" },
  ];
  const el = document.getElementById("curtail-tiles");
  if (el) el.innerHTML = tiles.map((t) => `<div class="tile">
    <div class="k">${t.k}</div>
    <div class="v">${t.v}<span class="u">${t.u}</span></div>
    <div class="sub2">${t.sub}</div></div>`).join("");

  const ctx = document.getElementById("curtail-context");
  if (ctx) ctx.innerHTML = `<h3>Where the constraints are</h3>
    <p><strong>Curtailment</strong> = wind cut for system-wide reasons (oversupply,
    the ~75% SNSP limit). <strong>Constraint</strong> = wind cut for local network
    limits — this is the locational part.</p>
    <p>The split is stark by jurisdiction: <strong>NI loses 29.6%</strong> of
    available wind vs <strong>ROI's 10.1%</strong> (2024) — NI is far more
    network-constrained. Dispatch-down is concentrated in high-wind, weak-grid
    regions (the north and west).</p>
    <p>There is no live locational feed (the SEM is a single price zone). The live
    map of where the grid has capacity vs. is constrained is ESB Networks':</p>
    <p><a href="https://www.esbnetworks.ie/services/get-connected/renewable-connection/network-capacity-heatmap"
      target="_blank" rel="noopener">ESB Networks capacity heatmap →</a></p>
    <p class="note">Figures: ${CURTAIL.source} (Apr 2025). Annual, not live.</p>`;
}

function renderHeader() {
  const meta = DATA.meta();
  const last = document.getElementById("last-updated");
  // latest observed timestamp across demand
  const dl = DATA.latest(M.demand());
  if (dl.t) {
    const d = new Date(dl.t);
    last.textContent = d.toLocaleString("en-IE",
      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  const gen = document.getElementById("foot-gen");
  if (meta.generated_utc) {
    gen.textContent = "ETL " + new Date(meta.generated_utc).toLocaleString("en-IE",
      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
}

function loadMethodology() {
  fetch("methodology.md", { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : Promise.reject()))
    .then((md) => {
      document.getElementById("methodology-body").innerHTML = miniMarkdown(md);
    })
    .catch(() => {
      document.getElementById("methodology-body").innerHTML =
        "<h3>Methodology</h3><p>See <code>methodology.md</code> in the project root.</p>";
    });
}

/* tiny markdown -> html (headings, tables, lists, code, bold) */
function miniMarkdown(md) {
  const lines = md.split("\n");
  let html = "", inTable = false, inList = false;
  const inline = (s) => s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  const closeTable = () => { if (inTable) { html += "</table>"; inTable = false; } };
  lines.forEach((raw) => {
    const l = raw.trimEnd();
    if (/^\|/.test(l)) {
      if (/^\|[\s:|-]+\|?$/.test(l.replace(/[^|:\-\s]/g, ""))) return; // separator
      const cells = l.split("|").slice(1, -1).map((c) => c.trim());
      if (!inTable) { html += "<table>"; inTable = true;
        html += "<tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr>";
      } else {
        html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      }
      return;
    }
    closeTable();
    if (/^#{1,4}\s/.test(l)) {
      closeList();
      const lvl = l.match(/^#+/)[0].length;
      html += `<h${Math.min(lvl + 1, 4)}>${inline(l.replace(/^#+\s/, ""))}</h${Math.min(lvl + 1, 4)}>`;
    } else if (/^[-*]\s/.test(l)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(l.replace(/^[-*]\s/, ""))}</li>`;
    } else if (l === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(l)}</p>`;
    }
  });
  closeList(); closeTable();
  return html;
}

function wireRegion() {
  const sw = document.getElementById("region-switch");
  const avail = DATA.regions();
  sw.querySelectorAll(".rg").forEach((btn) => {
    // hide region buttons with no data in this dataset
    if (!avail.includes(btn.dataset.region)) { btn.style.display = "none"; return; }
    btn.classList.toggle("active", btn.dataset.region === DATA.region);
    btn.addEventListener("click", () => {
      DATA.setRegion(btn.dataset.region);
      sw.querySelectorAll(".rg").forEach((b) =>
        b.classList.toggle("active", b.dataset.region === DATA.region));
      renderHeader();
      renderTiles();
      renderCurtailment();
      renderAll();
      setTimeout(() => Object.values(CHARTS).forEach((c) => c && c.resize()), 20);
    });
  });
}

function wireTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel-tab").forEach((p) =>
        p.classList.toggle("active", p.dataset.tab === name));
      // charts need a resize when their container becomes visible
      setTimeout(() => Object.values(CHARTS).forEach((c) => c && c.resize()), 20);
    });
  });
}

async function boot() {
  wireTabs();
  try {
    await DATA.load();
  } catch (e) {
    document.getElementById("main").insertAdjacentHTML("afterbegin",
      `<div class="card wide"><p class="note">⚠ ${e.message}</p></div>`);
    return;
  }
  wireRegion();
  renderHeader();
  renderTiles();
  renderCurtailment();
  renderAll();
  loadMethodology();
}

boot();
