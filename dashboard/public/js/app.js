/* ═══════════════════════════════════════════════════════════════════
   QueueCTL Dashboard — Client SPA
   Hash-based routing, API service, page renderers, auto-refresh
   ═══════════════════════════════════════════════════════════════════ */

// ── API Service ──────────────────────────────────────────────────────
const API = {
    base: window.location.origin,

    async get(path) {
        const res = await fetch(`${this.base}${path}`);
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        return res.json();
    },

    async post(path, body) {
        const res = await fetch(`${this.base}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    },

    async put(path, body) {
        const res = await fetch(`${this.base}${path}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    },

    // Endpoints
    status: () => API.get("/api/status"),
    jobs: (state) => API.get(`/api/jobs${state ? `?state=${state}` : ""}`),
    jobDetail: (id) => API.get(`/api/jobs/${encodeURIComponent(id)}`),
    config: () => API.get("/api/config"),
    setConfig: (key, value) => API.put(`/api/config/${key}`, { value }),
    dlq: () => API.get("/api/dlq"),
    retryDlq: (id) => API.post(`/api/dlq/${encodeURIComponent(id)}/retry`),
    enqueue: (job) => API.post("/api/enqueue", job),
    workers: () => API.get("/api/workers"),
};

// ── Utilities ────────────────────────────────────────────────────────
function relativeTime(dateStr) {
    if (!dateStr) return "—";
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    if (diff < 0) return "just now";
    const seconds = Math.floor(diff / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(str) {
    if (typeof str !== "string") return String(str ?? "");
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, len = 30) {
    if (!str) return "—";
    return str.length > len ? str.slice(0, len) + "…" : str;
}

function formatIndianTime(dateStr) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: true,
        day: "numeric",
        month: "numeric",
        year: "numeric"
    });
}

// ── Toast Notifications ──────────────────────────────────────────────
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const icons = { success: "check", error: "alert-triangle", info: "info" };
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon-wrapper"><i data-lucide="${icons[type] || "info"}"></i></span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    if (window.lucide) {
        window.lucide.createIcons();
    }
    setTimeout(() => {
        toast.classList.add("exit");
        toast.addEventListener("animationend", () => toast.remove());
    }, 3500);
}

// ── Modal ────────────────────────────────────────────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalBody = document.getElementById("modal-body");
const modalTitle = document.getElementById("modal-title");

function openModal(title, contentHtml, isLarge = false) {
    modalTitle.textContent = title;
    modalBody.innerHTML = contentHtml;
    const modalEl = document.getElementById("modal");
    if (isLarge) {
        modalEl.classList.add("modal-large");
    } else {
        modalEl.classList.remove("modal-large");
    }
    modalOverlay.classList.add("open");
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function closeModal() {
    modalOverlay.classList.remove("open");
}

document.getElementById("modal-close").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

// ── Router ───────────────────────────────────────────────────────────
const pages = {
    overview: { title: "Overview", render: renderOverview },
    jobs: { title: "Jobs", render: renderJobs },
    dlq: { title: "Dead Letter Queue", render: renderDLQ },
    workers: { title: "Workers", render: renderWorkers },
    config: { title: "Configuration", render: renderConfig },
    enqueue: { title: "Enqueue Job", render: renderEnqueue },
};

let currentPage = "overview";
let autoRefreshEnabled = true;
let refreshTimer = null;
let currentJobFilter = "";

function navigate(page) {
    if (!pages[page]) page = "overview";
    currentPage = page;

    // Update nav active state
    document.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === page);
    });

    // Update title
    document.getElementById("page-title").textContent = pages[page].title;

    // Render page
    renderCurrentPage();

    // Restart auto-refresh
    startAutoRefresh();
}

async function renderCurrentPage() {
    const content = document.getElementById("page-content");
    content.style.animation = "none";
    // Trigger reflow to restart animation
    content.offsetHeight;
    content.style.animation = "fadeIn var(--duration-slow) var(--ease-out)";
    try {
        await pages[currentPage].render(content);
        if (window.lucide) {
            window.lucide.createIcons();
        }
    } catch (err) {
        console.error("Render error:", err);
    }
}

// Hash-based routing
function handleHash() {
    const hash = window.location.hash.slice(1) || "overview";
    navigate(hash);
}

window.addEventListener("hashchange", handleHash);

// Nav clicks
document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => {
        // Close sidebar on mobile
        document.getElementById("sidebar").classList.remove("open");
    });
});

// Sidebar toggle (mobile)
document.getElementById("sidebar-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
});

// Auto-refresh toggle
document.getElementById("refresh-switch").addEventListener("click", () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    document
        .getElementById("refresh-switch")
        .classList.toggle("active", autoRefreshEnabled);
    if (autoRefreshEnabled) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
});

function startAutoRefresh() {
    stopAutoRefresh();
    if (autoRefreshEnabled) {
        refreshTimer = setInterval(() => {
            if (currentPage !== "enqueue" && currentPage !== "config") {
                renderCurrentPage();
            }
        }, 5000);
    }
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// ══════════════════════════════════════════════════════════════════
// PAGE RENDERERS
// ══════════════════════════════════════════════════════════════════

// ── Overview ─────────────────────────────────────────────────────────
function renderRankIndicator(rank, state, priority) {
    if (state !== "pending" && state !== "processing") {
        return `<span class="rank-indicator normal" title="Priority: ${priority}">—</span>`;
    }
    const ordinals = ["first", "second", "third"];
    const labels = ["1st", "2nd", "3rd"];
    if (rank <= 3) {
        const idx = rank - 1;
        return `<span class="rank-indicator ${ordinals[idx]}" title="Queue Rank: ${rank} (Priority: ${priority})">${labels[idx]}</span>`;
    }
    return `<span class="rank-indicator normal" title="Queue Rank: ${rank} (Priority: ${priority})">${rank}th</span>`;
}

async function renderOverview(container) {
    try {
        const [status, jobs] = await Promise.all([
            API.status(),
            API.jobs(),
        ]);

        // Sort: Active jobs (processing/pending) first.
        // - Ready jobs (state='processing' or pending ready) come before future scheduled jobs.
        // - Ready jobs are sorted by priority DESC, created_at ASC (matching SQL claim logic).
        // - Future jobs are sorted by run_at ASC, priority DESC.
        // Completed/failed/dead are sorted by updated_at DESC.
        const sortedJobs = [...jobs].sort((a, b) => {
            const isAActive = a.state === "processing" || a.state === "pending";
            const isBActive = b.state === "processing" || b.state === "pending";
            if (isAActive && !isBActive) return -1;
            if (!isAActive && isBActive) return 1;
            if (isAActive && isBActive) {
                if (a.state === "processing" && b.state !== "processing") return -1;
                if (a.state !== "processing" && b.state === "processing") return 1;

                const now = Date.now();
                const isAFuture = a.state === "pending" && a.run_at && new Date(a.run_at).getTime() > now;
                const isBFuture = b.state === "pending" && b.run_at && new Date(b.run_at).getTime() > now;

                // 1. Ready jobs come before future scheduled jobs
                if (!isAFuture && isBFuture) return -1;
                if (isAFuture && !isBFuture) return 1;

                // 2. If both are ready, sort by priority DESC, then created_at ASC
                if (!isAFuture && !isBFuture) {
                    if (b.priority !== a.priority) {
                        return b.priority - a.priority;
                    }
                    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                }

                // 3. If both are future, sort by run_at ASC, then priority DESC
                const timeA = new Date(a.run_at).getTime();
                const timeB = new Date(b.run_at).getTime();
                if (timeA !== timeB) {
                    return timeA - timeB;
                }
                return b.priority - a.priority;
            }
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

        const recentJobs = sortedJobs.slice(0, 8);
        const total = status.pending + status.processing + status.completed + status.failed + status.dead;

        let activeRank = 0;

        container.innerHTML = `
            <div class="stats-grid">
                ${statusCard("Pending", status.pending, "pending", "clock")}
                ${statusCard("Processing", status.processing, "processing", "play")}
                ${statusCard("Completed", status.completed, "completed", "check-circle-2")}
                ${statusCard("Failed", status.failed, "failed", "alert-circle")}
                ${statusCard("Dead", status.dead, "dead", "skull")}
                ${statusCard("Workers", status.workers, "workers", "cpu")}
            </div>

            <div class="overview-grid">
                <div class="activity-card">
                    <div class="activity-header" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                            <span class="activity-title">Execution Queue & Activity</span>
                            <a href="#jobs" class="view-all-link">View all →</a>
                        </div>
                        <span style="font-size:0.75rem; color:var(--text-muted);">💡 Click on any job row below to view details and execution logs</span>
                    </div>
                    <div class="data-table-wrapper">
                        ${recentJobs.length === 0
                            ? emptyState("folder-open", "No jobs yet", "Enqueue a job to get started")
                            : `<table class="data-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50px; text-align: center;">Rank</th>
                                        <th>ID</th>
                                        <th>Command</th>
                                        <th>Priority</th>
                                        <th>Status</th>
                                        <th>Scheduled Run</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${recentJobs.map((j) => {
                                        let rankHtml = "";
                                        if (j.state === "pending" || j.state === "processing") {
                                            activeRank++;
                                            rankHtml = renderRankIndicator(activeRank, j.state, j.priority);
                                        } else {
                                            rankHtml = renderRankIndicator(null, j.state, j.priority);
                                        }
                                        return `
                                            <tr class="clickable-row" onclick="showJobDetail('${escapeHtml(j.id)}')">
                                                <td style="text-align: center; padding-left: 0; padding-right: 0;">${rankHtml}</td>
                                                <td class="cell-id">${escapeHtml(truncate(j.id, 20))}</td>
                                                <td class="cell-command">${escapeHtml(truncate(j.command, 30))}</td>
                                                <td>${renderPriorityBadge(j.priority)}</td>
                                                <td><span class="status-badge ${j.state}">${j.state}</span></td>
                                                <td class="cell-time">${formatIndianTime(j.run_at)}</td>
                                                <td class="cell-time">${relativeTime(j.updated_at)}</td>
                                            </tr>
                                        `;
                                    }).join("")}
                                </tbody>
                            </table>`
                        }
                    </div>
                </div>

                <div class="chart-card">
                    <div class="chart-card-title">Job Distribution</div>
                    <div class="donut-container">
                        ${renderDonutChart(status, total)}
                        <div class="chart-legend">
                            ${legendItem("Pending", "--status-pending")}
                            ${legendItem("Processing", "--status-processing")}
                            ${legendItem("Completed", "--status-completed")}
                            ${legendItem("Failed", "--status-failed")}
                            ${legendItem("Dead", "--status-dead")}
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = errorState(err.message);
    }
}

function statusCard(label, value, cls, icon) {
    return `
        <div class="stat-card ${cls}">
            <div class="stat-card-header">
                <span class="stat-label">${label}</span>
                <span class="stat-icon"><i data-lucide="${icon}"></i></span>
            </div>
            <div class="stat-value">${value}</div>
        </div>
    `;
}

function renderDonutChart(status, total) {
    if (total === 0) {
        return `
            <div class="donut-chart">
                <svg width="200" height="200" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="80" fill="none" stroke="var(--bg-elevated)" stroke-width="24"/>
                </svg>
                <div class="donut-center">
                    <div class="donut-total">0</div>
                    <div class="donut-total-label">Total Jobs</div>
                </div>
            </div>
        `;
    }

    const segments = [
        { value: status.completed, color: "var(--status-completed)" },
        { value: status.pending, color: "var(--status-pending)" },
        { value: status.processing, color: "var(--status-processing)" },
        { value: status.failed, color: "var(--status-failed)" },
        { value: status.dead, color: "var(--status-dead)" },
    ];

    const circumference = 2 * Math.PI * 80;
    let offset = 0;
    let circles = "";

    for (const seg of segments) {
        if (seg.value === 0) continue;
        const pct = seg.value / total;
        const dashLen = pct * circumference;
        const gap = circumference - dashLen;
        circles += `<circle cx="100" cy="100" r="80" fill="none"
            stroke="${seg.color}" stroke-width="24"
            stroke-dasharray="${dashLen} ${gap}"
            stroke-dashoffset="${-offset}"
            stroke-linecap="butt"/>`;
        offset += dashLen;
    }

    return `
        <div class="donut-chart">
            <svg width="200" height="200" viewBox="0 0 200 200">
                ${circles}
            </svg>
            <div class="donut-center">
                <div class="donut-total">${total}</div>
                <div class="donut-total-label">Total Jobs</div>
            </div>
        </div>
    `;
}

function legendItem(label, colorVar) {
    return `<div class="legend-item"><span class="legend-dot" style="background:var(${colorVar})"></span>${label}</div>`;
}

// ── Jobs ─────────────────────────────────────────────────────────────
function renderPriorityBadge(priority) {
    const p = Number(priority || 0);
    let cls = "low";
    if (p >= 20) cls = "high";
    else if (p >= 10) cls = "medium";
    return `<span class="priority-badge ${cls}">${p}</span>`;
}

async function renderJobs(container) {
    try {
        const jobs = await API.jobs(currentJobFilter || undefined);
        const states = ["", "pending", "processing", "completed", "failed", "dead"];
        const stateLabels = ["All", "Pending", "Processing", "Completed", "Failed", "Dead"];

        container.innerHTML = `
            <div class="table-card">
                <div class="table-header" style="flex-wrap: wrap; gap: 8px;">
                    <div>
                        <span class="table-title">All Jobs</span>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">💡 Click on any job row below to view details and execution logs</div>
                    </div>
                    <div class="filter-pills">
                        ${states.map((s, i) => `
                            <button class="filter-pill ${currentJobFilter === s ? "active" : ""}"
                                onclick="filterJobs('${s}')">${stateLabels[i]}</button>
                        `).join("")}
                    </div>
                </div>
                <div class="data-table-wrapper">
                    ${jobs.length === 0
                        ? emptyState("search", "No jobs found", currentJobFilter ? "Try a different filter" : "Enqueue a job to get started")
                        : `<table class="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Command</th>
                                    <th>Priority</th>
                                    <th>Status</th>
                                    <th>Attempts</th>
                                    <th>Worker</th>
                                    <th>Scheduled Run</th>
                                    <th>Created</th>
                                    <th>Updated</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${jobs.map((j) => `
                                    <tr class="clickable-row" onclick="showJobDetail('${escapeHtml(j.id)}')">
                                        <td class="cell-id" title="${escapeHtml(j.id)}">${escapeHtml(truncate(j.id, 20))}</td>
                                        <td class="cell-command" title="${escapeHtml(j.command)}">${escapeHtml(truncate(j.command, 35))}</td>
                                        <td>${renderPriorityBadge(j.priority)}</td>
                                        <td><span class="status-badge ${j.state}">${j.state}</span></td>
                                        <td style="color:var(--text-secondary)">${j.attempts}/${j.max_retries}</td>
                                        <td class="cell-id" title="${escapeHtml(j.worker_id || '')}">${j.worker_id ? escapeHtml(truncate(j.worker_id, 12)) : "—"}</td>
                                        <td class="cell-time">${formatIndianTime(j.run_at)}</td>
                                        <td class="cell-time">${relativeTime(j.created_at)}</td>
                                        <td class="cell-time">${relativeTime(j.updated_at)}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>`
                    }
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = errorState(err.message);
    }
}

// Global job filter function
window.filterJobs = function (state) {
    currentJobFilter = state;
    renderCurrentPage();
};

// Global job detail function
window.showJobDetail = async function (id) {
    try {
        const job = await API.jobDetail(id);
        const rows = [
            ["ID", job.id],
            ["Command", job.command],
            ["Priority", job.priority],
            ["State", `<span class="status-badge ${job.state}">${job.state}</span>`],
            ["Attempts", `${job.attempts} / ${job.max_retries}`],
            ["Worker ID", job.worker_id || "—"],
            ["Exit Code", job.exit_code !== null && job.exit_code !== undefined ? job.exit_code : "—"],
            ["Scheduled Run (IST)", formatIndianTime(job.run_at)],
            ["Next Retry (IST)", job.next_retry_at ? formatIndianTime(job.next_retry_at) : "—"],
            ["Created At (IST)", formatIndianTime(job.created_at)],
            ["Updated At (IST)", formatIndianTime(job.updated_at)],
        ];

        const detailsHtml = `
            <div class="modal-details-list">
                ${rows.map(([label, value]) => `
                    <div class="modal-detail-row">
                        <span class="modal-detail-label">${label}</span>
                        <span class="modal-detail-value">${
                            label === "State" ? value : escapeHtml(value)
                        }</span>
                    </div>
                `).join("")}
            </div>
        `;

        const stdoutHtml = job.stdout 
            ? `<pre class="log-terminal stdout">${escapeHtml(job.stdout)}</pre>`
            : `<div class="log-empty">No stdout logs available for this job.</div>`;

        const stderrHtml = job.stderr 
            ? `<pre class="log-terminal stderr">${escapeHtml(job.stderr)}</pre>`
            : `<div class="log-empty">No stderr logs available for this job.</div>`;

        const modalHtml = `
            <div class="modal-tabs">
                <div class="modal-tab " data-tab="details">Details</div>
                <div class="modal-tab active" data-tab="stdout">Stdout Log</div>
                <div class="modal-tab" data-tab="stderr">Stderr Log</div>
            </div>
            <div class="modal-tab-contents">
                <div class="tab-content " id="tab-details">${detailsHtml}</div>
                <div class="tab-content active" id="tab-stdout">${stdoutHtml}</div>
                <div class="tab-content" id="tab-stderr">${stderrHtml}</div>
            </div>
        `;

        openModal("Job Details & Logs", modalHtml, true);

        // Bind tab click handlers
        const tabs = document.querySelectorAll(".modal-tab");
        tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                tabs.forEach(t => t.classList.remove("active"));
                document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
                
                tab.classList.add("active");
                const targetTab = tab.dataset.tab;
                document.getElementById(`tab-${targetTab}`).classList.add("active");
            });
        });
    } catch (err) {
        showToast(err.message, "error");
    }
};

// ── Dead Letter Queue ────────────────────────────────────────────────
async function renderDLQ(container) {
    try {
        const jobs = await API.dlq();

        container.innerHTML = `
            <div class="table-card">
                <div class="table-header">
                    <div>
                        <span class="table-title">Dead Letter Queue</span>
                        <div class="section-subtitle">Jobs that have exhausted all retry attempts. Click on a job row to view details & error logs.</div>
                    </div>
                </div>
                <div class="data-table-wrapper">
                    ${jobs.length === 0
                        ? emptyState("check-circle-2", "DLQ is empty", "No permanently failed jobs")
                        : `<table class="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Command</th>
                                    <th>Attempts</th>
                                    <th>Failed At</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${jobs.map((j) => `
                                    <tr class="clickable-row" onclick="showJobDetail('${escapeHtml(j.id)}')">
                                        <td class="cell-id" title="${escapeHtml(j.id)}">${escapeHtml(truncate(j.id, 24))}</td>
                                        <td class="cell-command" title="${escapeHtml(j.command)}">${escapeHtml(truncate(j.command, 35))}</td>
                                        <td style="color:var(--text-secondary)">${j.attempts}/${j.max_retries}</td>
                                        <td class="cell-time">${relativeTime(j.updated_at)}</td>
                                        <td>
                                            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); retryDlqJob('${escapeHtml(j.id)}')">
                                                ↻ Retry
                                            </button>
                                        </td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>`
                    }
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = errorState(err.message);
    }
}

window.retryDlqJob = async function (id) {
    try {
        await API.retryDlq(id);
        showToast(`Job "${truncate(id, 20)}" requeued successfully`, "success");
        renderCurrentPage();
    } catch (err) {
        showToast(err.message, "error");
    }
};

// ── Workers ──────────────────────────────────────────────────────────
async function renderWorkers(container) {
    try {
        const { workers, supervisors } = await API.workers();

        container.innerHTML = `
            ${supervisors.length > 0 ? `
                <div class="section-header">
                    <div>
                        <div class="section-title">Supervisors</div>
                        <div class="section-subtitle">${supervisors.length} active supervisor process${supervisors.length !== 1 ? 'es' : ''}</div>
                    </div>
                </div>
                <div class="worker-grid" style="margin-bottom:var(--space-xl)">
                    ${supervisors.map((s) => `
                        <div class="supervisor-card">
                            <div class="worker-card-header">
                                <span class="worker-pulse"></span>
                                <span class="worker-id-text">PID ${s.pid}</span>
                            </div>
                            <div class="worker-meta">
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">Workers</span>
                                    <span class="worker-meta-value">${s.worker_count}</span>
                                </div>
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">Started</span>
                                    <span class="worker-meta-value">${relativeTime(s.started_at)}</span>
                                </div>
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">Shutdown</span>
                                    <span class="worker-meta-value">${s.shutdown_requested ? '<span style="color:var(--status-failed)">Requested</span>' : '<span style="color:var(--status-completed)">No</span>'}</span>
                                </div>
                            </div>
                        </div>
                    `).join("")}
                </div>
            ` : ''}

            <div class="section-header">
                <div>
                    <div class="section-title">Workers</div>
                    <div class="section-subtitle">${workers.length} active worker${workers.length !== 1 ? 's' : ''}</div>
                </div>
            </div>

            ${workers.length === 0
                ? `<div class="table-card">${emptyState("server", "No active workers", "Start workers with: queuectl worker start --count 3")}</div>`
                : `<div class="worker-grid">
                    ${workers.map((w) => `
                        <div class="worker-card">
                            <div class="worker-card-header">
                                <span class="worker-pulse"></span>
                                <span class="worker-id-text" title="${escapeHtml(w.id)}">${escapeHtml(truncate(w.id, 24))}</span>
                            </div>
                            <div class="worker-meta">
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">PID</span>
                                    <span class="worker-meta-value">${w.pid}</span>
                                </div>
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">Last Heartbeat</span>
                                    <span class="worker-meta-value">${relativeTime(w.last_heartbeat)}</span>
                                </div>
                                <div class="worker-meta-row">
                                    <span class="worker-meta-label">Started</span>
                                    <span class="worker-meta-value">${relativeTime(w.started_at)}</span>
                                </div>
                            </div>
                        </div>
                    `).join("")}
                </div>`
            }
        `;
    } catch (err) {
        container.innerHTML = errorState(err.message);
    }
}

// ── Configuration ────────────────────────────────────────────────────
async function renderConfig(container) {
    try {
        const config = await API.config();
        const descriptions = {
            "max-retries": "Maximum number of retry attempts before a job moves to the Dead Letter Queue",
            "backoff-base": "Base for exponential backoff calculation (delay = base ^ attempts)",
            "recovery-interval": "Interval (ms) between recovery checks for crashed workers",
            "worker-timeout": "Time (ms) after which a worker with no heartbeat is considered dead",
        };

        container.innerHTML = `
            <div class="section-header">
                <div>
                    <div class="section-title">Queue Configuration</div>
                    <div class="section-subtitle">Stored persistently in SQLite</div>
                </div>
            </div>
            <div class="config-grid">
                ${Object.entries(config).map(([key, value]) => `
                    <div class="config-card">
                        <div class="config-card-key">${escapeHtml(key)}</div>
                        <div class="config-card-value" id="config-display-${key}">${value}</div>
                        <div class="form-hint" style="margin-bottom:var(--space-md)">${descriptions[key] || ""}</div>
                        <div class="config-edit-row">
                            <input type="number" class="form-input" id="config-input-${key}" value="${value}" />
                            <button class="btn btn-primary btn-sm" onclick="updateConfig('${key}')">Save</button>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    } catch (err) {
        container.innerHTML = errorState(err.message);
    }
}

window.updateConfig = async function (key) {
    const input = document.getElementById(`config-input-${key}`);
    if (!input) return;
    try {
        await API.setConfig(key, Number(input.value));
        showToast(`${key} updated to ${input.value}`, "success");
        // Update display
        const display = document.getElementById(`config-display-${key}`);
        if (display) display.textContent = input.value;
    } catch (err) {
        showToast(err.message, "error");
    }
};

// ── Enqueue ──────────────────────────────────────────────────────────
async function renderEnqueue(container) {
    container.innerHTML = `
        <div class="form-card">
            <div class="form-card-title">Enqueue a New Job</div>
            <div class="form-group">
                <label class="form-label" for="enqueue-id">Job ID (optional)</label>
                <input type="text" class="form-input" id="enqueue-id" placeholder="Auto-generated UUID if left blank" />
                <div class="form-hint">Leave blank for auto-generated UUID</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="enqueue-priority">Priority (optional)</label>
                <input type="number" class="form-input" id="enqueue-priority" value="0" placeholder="0" />
                <div class="form-hint">Higher number = higher execution priority</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="enqueue-command">Command *</label>
                <textarea class="form-input" id="enqueue-command" placeholder='echo "Hello World"' rows="3"></textarea>
                <div class="form-hint">Shell command to execute</div>
            </div>
            <button class="btn btn-primary" id="enqueue-submit" onclick="submitEnqueue()">
                ⊕ Enqueue Job
            </button>
        </div>
    `;
}

window.submitEnqueue = async function () {
    const id = document.getElementById("enqueue-id").value.trim();
    const command = document.getElementById("enqueue-command").value.trim();
    const priority = Number(document.getElementById("enqueue-priority").value || 0);
    console.log(priority)
    if (!command) {
        showToast("Command is required", "error");
        return;
    }

    try {
        const result = await API.enqueue({ id: id || undefined, command, priority });
        showToast(`Job "${truncate(result.job.id, 20)}" enqueued!`, "success");
        document.getElementById("enqueue-id").value = "";
        document.getElementById("enqueue-command").value = "";
        document.getElementById("enqueue-priority").value = "0";
    } catch (err) {
        showToast(err.message, "error");
    }
};

// ── Shared Helpers ───────────────────────────────────────────────────
function emptyState(icon, text, sub) {
    return `
        <div class="empty-state">
            <div class="empty-state-icon">
                <i data-lucide="${icon}"></i>
            </div>
            <div class="empty-state-text">${text}</div>
            ${sub ? `<div class="empty-state-sub">${sub}</div>` : ""}
        </div>
    `;
}

function errorState(message) {
    return `
        <div class="table-card">
            <div class="empty-state">
                <div class="empty-state-icon text-danger">
                    <i data-lucide="alert-octagon"></i>
                </div>
                <div class="empty-state-text">Error loading data</div>
                <div class="empty-state-sub">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

// ── Connection Status Checker ────────────────────────────────────────
async function checkConnection() {
    const dot = document.querySelector("#connection-status .status-dot");
    const label = document.querySelector("#connection-status span:last-child");
    try {
        await API.status();
        dot.className = "status-dot live";
        label.textContent = "Connected";
    } catch {
        dot.className = "status-dot";
        label.textContent = "Disconnected";
    }
}

setInterval(checkConnection, 10000);

// ── Init ─────────────────────────────────────────────────────────────
handleHash();
checkConnection();
