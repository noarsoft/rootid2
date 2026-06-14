// benchmark/dashboard/app.js

const DEFAULT_JSON = "/results/wiki-benchmark-summary-latest.json";

const charts = {};

function $(id) {
  return document.getElementById(id);
}

function has(id) {
  return Boolean($(id));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function maybeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 4) {
  if (value === null || value === undefined || value === "") return "-";

  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

function bytesToMb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n / 1024 / 1024;
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function getStorageBytes(method) {
  return (
    method.storage?.database_bytes ||
    method.storage?.data_table_bytes ||
    method.storage?.revision_table_bytes ||
    method.storage?.jsonb_table_bytes ||
    method.storage?.collection_bytes ||
    method.storage?.storage_size ||
    null
  );
}

function getStorageLabel(method) {
  const storage = method.storage || {};

  if (storage.database_bytes) return "database_bytes";
  if (storage.data_table_bytes) return "data_table_bytes";
  if (storage.revision_table_bytes) return "revision_table_bytes";
  if (storage.jsonb_table_bytes) return "jsonb_table_bytes";
  if (storage.collection_bytes) return "collection_bytes";
  if (storage.storage_size) return "storage_size";

  return "-";
}

function makeBarChart(canvasId, labels, data, label, yTitle, options = {}) {
  if (!has(canvasId)) {
    console.warn(`[dashboard] canvas not found: ${canvasId}`);
    return;
  }

  destroyChart(canvasId);

  charts[canvasId] = new Chart($(canvasId), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: options.horizontal ? "y" : "x",
      plugins: {
        legend: {
          display: true,
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${fmt(context.raw)}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: yTitle,
          },
        },
        x: {
          ticks: {
            autoSkip: false,
          },
        },
      },
    },
  });
}

function makeGroupedBarChart(canvasId, labels, datasets, yTitle) {
  if (!has(canvasId)) {
    console.warn(`[dashboard] canvas not found: ${canvasId}`);
    return;
  }

  destroyChart(canvasId);

  charts[canvasId] = new Chart($(canvasId), {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((item) => ({
        label: item.label,
        data: item.data,
        borderWidth: 1,
        borderRadius: 8,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${fmt(context.raw)}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: yTitle,
          },
        },
        x: {
          ticks: {
            autoSkip: false,
          },
        },
      },
    },
  });
}

async function loadReport(jsonPath) {
  if (has("jsonPath")) {
    $("jsonPath").textContent = jsonPath;
  }

  const res = await fetch(jsonPath);

  if (!res.ok) {
    throw new Error(`Cannot load benchmark JSON: ${jsonPath}`);
  }

  return res.json();
}

function renderStats(report) {
  const methods = report.methods || [];
  const first = methods[0] || {};
  const dataset = first.dataset || {};

  if (has("runInfo")) {
    $("runInfo").textContent =
      `run_id: ${report.run_id || "-"} | methods: ${methods.length}`;
  }

  if (has("statPages")) {
    $("statPages").textContent = fmt(dataset.pages, 0);
  }

  if (has("statRevisions")) {
    $("statRevisions").textContent = fmt(dataset.revisions, 0);
  }

  if (has("statMethods")) {
    $("statMethods").textContent = fmt(methods.length, 0);
  }

  if (has("statGenerated")) {
    $("statGenerated").textContent =
      report.generated_at ? new Date(report.generated_at).toLocaleString() : "-";
  }
}

function renderCharts(report) {
  const methods = report.methods || [];
  const labels = methods.map((m) => m.method);

  makeBarChart(
    "insertChart",
    labels,
    methods.map((m) => num(m.insert?.execute_ms)),
    "Insert time",
    "ms"
  );

  makeBarChart(
    "throughputChart",
    labels,
    methods.map((m) => num(m.insert?.revisions_per_sec)),
    "Insert throughput",
    "revisions/sec"
  );

  makeBarChart(
    "latestReadChart",
    labels,
    methods.map((m) => num(m.read?.latest?.avg_ms_per_read)),
    "Avg latest read",
    "ms/read"
  );

  makeBarChart(
    "historyReadChart",
    labels,
    methods.map((m) => num(m.read?.history?.avg_ms_per_history)),
    "Avg history read",
    "ms/history"
  );

  makeBarChart(
    "storageChart",
    labels,
    methods.map((m) => bytesToMb(getStorageBytes(m)) || 0),
    "Storage",
    "MB"
  );

  makeBarChart(
    "updateChart",
    labels,
    methods.map((m) => num(m.update?.execute_ms)),
    "Update time",
    "ms"
  );

  makeBarChart(
    "deleteChart",
    labels,
    methods.map((m) => num(m.delete?.execute_ms)),
    "Delete time",
    "ms"
  );

  makeGroupedBarChart(
    "latestBeforeAfterChart",
    labels,
    [
      {
        label: "Before update",
        data: methods.map((m) => num(m.read?.latest?.avg_ms_per_read)),
      },
      {
        label: "After update",
        data: methods.map((m) => num(m.read_after_update?.latest?.avg_ms_per_read)),
      },
    ],
    "ms/read"
  );

  makeGroupedBarChart(
    "historyBeforeAfterChart",
    labels,
    [
      {
        label: "Before update",
        data: methods.map((m) => num(m.read?.history?.avg_ms_per_history)),
      },
      {
        label: "After update",
        data: methods.map((m) => num(m.read_after_update?.history?.avg_ms_per_history)),
      },
    ],
    "ms/history"
  );

  const rootid = methods.find((m) => m.method_key === "rootid");

  makeBarChart(
    "schemaChart",
    [
      "Create schema v1",
      "Update schema v2",
      "Compare avg",
      "Migrate avg",
    ],
    [
      num(rootid?.schema?.create_schema_v1_ms),
      num(rootid?.schema?.update_schema_v2_ms),
      num(rootid?.schema?.compare_with_latest_schema?.avg_ms_per_compare),
      num(rootid?.schema?.migrate_to_latest_schema?.avg_ms_per_migrate),
    ],
    "Milliseconds",
    "ms",
    { horizontal: true }
  );
}

function renderTable(report) {
  const tbody = document.querySelector("#summaryTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const methods = report.methods || [];

  for (const m of methods) {
    const storageBytes = getStorageBytes(m);
    const storageMb = bytesToMb(storageBytes);
    const storageLabel = getStorageLabel(m);

    const updateText =
      m.update?.enabled && maybeNum(m.update?.execute_ms) !== null
        ? fmt(m.update.execute_ms)
        : "-";

    const deleteText =
      m.delete?.enabled && maybeNum(m.delete?.execute_ms) !== null
        ? fmt(m.delete.execute_ms)
        : "-";

    const note = [
      m.insert?.note || "",
      m.update?.enabled ? "update enabled" : "update off",
      m.delete?.enabled ? "delete enabled" : "delete off",
    ]
      .filter(Boolean)
      .join(" | ");

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><strong>${m.method || "-"}</strong></td>
      <td class="text-end">${fmt(m.input_loading?.execute_ms)}</td>
      <td class="text-end">${fmt(m.insert?.execute_ms)}</td>
      <td class="text-end">${fmt(m.insert?.revisions_per_sec)}</td>
      <td class="text-end">${fmt(m.read?.latest?.avg_ms_per_read)}</td>
      <td class="text-end">${fmt(m.read?.history?.avg_ms_per_history)}</td>
      <td class="text-end">${updateText}</td>
      <td class="text-end">${deleteText}</td>
      <td class="text-end">
        ${fmt(storageBytes, 0)}
        <br />
        <span class="text-muted small">${fmt(storageMb)} MB / ${storageLabel}</span>
      </td>
      <td class="small text-muted">${note || "-"}</td>
    `;

    tbody.appendChild(tr);
  }
}

function renderDashboard(report) {
  renderStats(report);
  renderCharts(report);
  renderTable(report);
}

async function loadAndRender(jsonPath) {
  try {
    const report = await loadReport(jsonPath);
    renderDashboard(report);
  } catch (err) {
    console.error(err);

    if (has("runInfo")) {
      $("runInfo").textContent = "Load failed";
    }

    alert(
      `${err.message}\n\nตรวจว่าไฟล์ JSON มีอยู่จริงใน benchmark/results และเปิดด้วย npm run bench:dashboard`
    );
  }
}

function getInitialJsonPath() {
  const params = new URLSearchParams(window.location.search);

  const fromQuery = params.get("json");
  if (fromQuery) return fromQuery;

  if (has("jsonPathInput")) {
    return $("jsonPathInput").value.trim() || DEFAULT_JSON;
  }

  return DEFAULT_JSON;
}

function bindEvents() {
  if (has("loadJsonBtn") && has("jsonPathInput")) {
    $("loadJsonBtn").addEventListener("click", () => {
      const jsonPath = $("jsonPathInput").value.trim() || DEFAULT_JSON;
      loadAndRender(jsonPath);
    });
  }
}

function main() {
  bindEvents();

  const jsonPath = getInitialJsonPath();

  if (has("jsonPathInput")) {
    $("jsonPathInput").value = jsonPath;
  }

  loadAndRender(jsonPath);
}

main();