function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0.0 MB";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeSpeed(value) {
    const text = String(value || "0 KB/S").trim();
    return text ? text.toUpperCase() : "0 KB/S";
}

async function apiGet(url) {
    const response = await fetch(url, { cache: "no-store" });
    return response.json();
}

async function apiPost(url, payload = {}) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return response.json();
}

const sourceKinds = ["video", "audio", "file", "playlist", "document", "browser"];
let currentSource = null;
let currentPlaylist = null;
let downloadsById = new Map();
let seenCaptureIds = new Set();

function normalizeSourceKind(kind) {
    const value = String(kind || "").toLowerCase();
    if (value === "video_file") return "video";
    if (value === "audio_file") return "audio";
    if (value === "archive" || value === "image") return "file";
    if (value === "page") return "browser";
    if (sourceKinds.includes(value)) return value;
    return "file";
}

function showView(viewId) {
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    $(`view-${viewId}`).classList.add("active");

    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    const targetBtn = Array.from(document.querySelectorAll(".nav-btn")).find(
        btn => btn.innerText.includes(viewId.toUpperCase())
    );
    if (targetBtn) targetBtn.classList.add("active");
}

function openModal(modalId) {
    $(modalId).style.display = "block";
}

function closeModal(modalId) {
    $(modalId).style.display = "none";
}

function showSystemNotice(message, tone = "info") {
    const notice = $("system-notice");
    notice.className = `system-notice show tone-${tone}`;
    $("system-notice-text").innerText = String(message || "").toUpperCase();
    window.clearTimeout(showSystemNotice.timeoutId);
    showSystemNotice.timeoutId = window.setTimeout(() => {
        notice.classList.remove("show");
    }, 4500);
}

function setActiveKind(kind, summary) {
    sourceKinds.forEach(name => {
        const dashPill = $(`pill-${name}`);
        const modalChip = $(`source-chip-${name}`);
        if (dashPill) dashPill.classList.toggle("active-kind", name === kind);
        if (modalChip) modalChip.classList.toggle("active-kind", name === kind);
    });
    if (summary) $("source-summary").innerText = summary.toUpperCase();
}

function setDetectionBanner(kind, note) {
    $("detected-kind").innerText = String(kind || "READY").toUpperCase();
    $("detected-note").innerText = String(note || "SOURCE DETAILS WILL APPEAR HERE").toUpperCase();
}

function clearVideoInfo() {
    $("video-info").classList.add("hidden");
    $("formats-list").innerHTML = "";
    currentSource = null;
    currentPlaylist = null;
    setDetectionBanner("READY", "SOURCE DETAILS WILL APPEAR HERE");
}

function ensureEmptyState() {
    const list = $("active-downloads");
    const hasRows = list.querySelector(".download-row");
    const empty = list.querySelector(".empty-state");
    if (!hasRows && !empty) {
        const node = document.createElement("div");
        node.className = "empty-state";
        node.innerText = "NO ACTIVE DOWNLOADS";
        list.appendChild(node);
    } else if (hasRows && empty) {
        empty.remove();
    }
}

function updateDashboardSummary(downloads) {
    const totalBytes = downloads.reduce((sum, item) => sum + (item.completed_bytes || 0), 0);
    $("total-downloaded").innerText = formatBytes(totalBytes).toUpperCase();
    const active = downloads.filter(item => item.status === "active");
    $("global-speed").innerText = active.length ? normalizeSpeed(active[0].speed) : "0 KB/S";
}

async function fetchInfo() {
    const url = $("url-input").value.trim();
    if (!url) {
        showSystemNotice("Paste a source URL first.", "warning");
        return;
    }

    const fetchBtn = $("fetch-btn");
    fetchBtn.disabled = true;
    fetchBtn.innerText = "SCANNING...";
    clearVideoInfo();

    try {
        const result = await apiPost("/api/info", { url });
        if (!result.ok || !result.info) {
            showSystemNotice(result.error || "Source scan failed.", "error");
            return;
        }
        displayInfo(result.info);
    } catch (error) {
        console.error(error);
        showSystemNotice(`Scan failed: ${error}`, "error");
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerText = "SCAN SOURCE";
    }
}

function displayInfo(info) {
    currentSource = info;
    $("video-info").classList.remove("hidden");
    $("video-title").innerText = String(info.title || "UNKNOWN SOURCE").toUpperCase();

    const kind = normalizeSourceKind(info.source_kind || info.type || "file");
    setActiveKind(kind, `Ready for ${kind} download`);
    setDetectionBanner(kind, info.type === "playlist" ? "Selective bulk download is enabled." : "Source detected and ready.");

    const list = $("formats-list");
    list.innerHTML = "";

    if (info.type === "playlist") {
        currentPlaylist = info;
        const isLargePlaylist = info.entries.length > 50 || info.title.toUpperCase().includes("MIX");
        renderPlaylistContent(isLargePlaylist ? 20 : info.entries.length, isLargePlaylist);
        return;
    }

    currentPlaylist = null;
    info.formats.forEach(format => {
        const row = document.createElement("div");
        row.className = "format-row";
        row.innerHTML = `
            <span class="col-res">${escapeHtml(format.resolution || "AUTO")}</span>
            <span class="col-type">${escapeHtml((format.type || "DOWNLOAD").toUpperCase())}</span>
            <span class="col-size">${escapeHtml((format.size || "UNKNOWN").toUpperCase())}</span>
            <div class="col-action">
                <button class="get-btn" type="button">GET</button>
            </div>
        `;
        row.querySelector(".get-btn").addEventListener("click", () => startDownload(format.id || "best", info.title));
        list.appendChild(row);
    });
}

function renderPlaylistContent(count, isLimited) {
    const list = $("formats-list");
    const displayEntries = currentPlaylist.entries.slice(0, count);
    list.innerHTML = `
        <div class="bulk-options">
            <div class="bulk-selection-header">
                <label class="custom-checkbox">
                    <input type="checkbox" id="select-all-playlist" checked onchange="toggleSelectAll(this)">
                    <span class="checkmark"></span>
                    SELECT ALL
                </label>
                <div class="playlist-meta">
                    <p>${currentPlaylist.entries.length} TRACKS FOUND</p>
                    ${isLimited ? `<span class="warning-text">PREVIEWING FIRST ${count}</span>` : `<span class="warning-text">FULL PLAYLIST READY</span>`}
                </div>
            </div>
            <div class="bulk-config">
                <div class="quality-selector">
                    <label>SELECT MODE:</label>
                    <select id="bulk-quality">
                        <option value="1080p">1080P VIDEO</option>
                        <option value="720p" selected>720P VIDEO</option>
                        <option value="480p">480P VIDEO</option>
                        <option value="360p">360P VIDEO</option>
                        <option value="audio">AUDIO ONLY</option>
                    </select>
                </div>
                <button class="primary-btn" type="button" onclick="startBulkDownload()">GET SELECTED</button>
            </div>
            ${isLimited ? `
                <div class="load-more-section">
                    <p class="small-hint">LARGE PLAYLIST DETECTED. LOAD THE FULL SET ONLY IF YOU NEED IT.</p>
                    <button class="load-all-btn" id="load-all-trigger" type="button" onclick="loadFullPlaylist()">LOAD FULL PLAYLIST</button>
                </div>
            ` : ""}
        </div>
        <div class="playlist-preview">
            ${displayEntries.map(entry => `
                <div class="playlist-item">
                    <label class="custom-checkbox">
                        <input type="checkbox" class="playlist-item-checkbox" data-url="${escapeHtml(entry.url || "")}" data-title="${escapeHtml(entry.title || "Unknown Title")}" checked onchange="refreshPlaylistSelection()">
                        <span class="checkmark"></span>
                        ${escapeHtml((entry.title || "Unknown Title").toUpperCase())}
                    </label>
                </div>
            `).join("")}
        </div>
    `;
    refreshPlaylistSelection();
}

function loadFullPlaylist() {
    const trigger = $("load-all-trigger");
    if (trigger) trigger.innerText = "LOADING...";
    window.setTimeout(() => renderPlaylistContent(currentPlaylist.entries.length, false), 60);
}

function toggleSelectAll(master) {
    document.querySelectorAll(".playlist-item-checkbox").forEach(cb => {
        cb.checked = master.checked;
    });
    refreshPlaylistSelection();
}

function refreshPlaylistSelection() {
    const checked = document.querySelectorAll(".playlist-item-checkbox:checked").length;
    const total = document.querySelectorAll(".playlist-item-checkbox").length;
    const master = $("select-all-playlist");
    if (!master) return;
    master.checked = total > 0 && checked === total;
    master.indeterminate = checked > 0 && checked < total;
}

async function startBulkDownload() {
    if (!currentPlaylist) return;
    const items = Array.from(document.querySelectorAll(".playlist-item-checkbox:checked"))
        .map(cb => ({
            id: Math.random().toString(36).slice(2, 11),
            url: cb.dataset.url || "",
            title: cb.dataset.title || "Unknown Title",
        }))
        .filter(item => item.url);

    if (!items.length) {
        showSystemNotice("Select at least one playlist item.", "warning");
        return;
    }

    closeModal("add-url-modal");
    showView("dashboard");
    const result = await apiPost("/api/bulk_download", {
        items,
        quality: $("bulk-quality").value,
    });
    if (result.ok) {
        showSystemNotice(`Queued ${items.length} playlist items.`, "success");
    } else {
        showSystemNotice(result.error || "Bulk start failed.", "error");
    }
}

async function startDownload(formatId, title) {
    const url = $("url-input").value.trim();
    if (!url) {
        showSystemNotice("Paste a source URL before downloading.", "warning");
        return;
    }
    closeModal("add-url-modal");
    showView("dashboard");
    const result = await apiPost("/api/download", {
        url,
        format_id: formatId,
        title,
    });
    if (result.ok) {
        showSystemNotice("Download queued.", "success");
    } else {
        showSystemNotice(result.error || "Download failed to start.", "error");
    }
}

function renderDownloadRow(item) {
    const existing = $(`dl-${item.id}`);
    const row = existing || document.createElement("div");
    row.className = "download-row";
    row.id = `dl-${item.id}`;
    row.setAttribute("data-status", item.status);

    const lightClass = item.status === "completed" ? "green" : item.status === "cancelled" ? "yellow" : item.status === "error" ? "red" : "blue";
    const actionHtml = item.status === "completed" && item.save_path
        ? `<button class="small-btn green-text" type="button" onclick="openFolderFromRow('${item.id}')">OPEN FOLDER</button>`
        : item.status === "active" || item.status === "queued"
            ? `<button class="small-btn" type="button" onclick="cancelDownload('${item.id}')">CANCEL</button>`
            : "";

    row.innerHTML = `
        <span class="col-status"><span class="light ${lightClass}"></span></span>
        <span class="col-name" title="${escapeHtml(item.title || "Download")}">${escapeHtml(String(item.title || "Download").toUpperCase())}</span>
        <div class="col-progress">
            <div class="progress-bar-container">
                <div class="progress-fill" style="width: ${Math.max(0, Math.min((item.progress || 0) * 100, 100))}%"></div>
            </div>
        </div>
        <span class="col-speed">${escapeHtml(normalizeSpeed(item.speed || "QUEUED"))}</span>
        <div class="col-actions">${actionHtml}</div>
    `;

    if (!existing) $("active-downloads").appendChild(row);
}

async function openFolderFromRow(downloadId) {
    const item = downloadsById.get(downloadId);
    if (item?.save_path) {
        await apiPost("/api/open_folder", { path: item.save_path });
    }
}

function syncDownloads(downloads) {
    const ids = new Set(downloads.map(item => item.id));
    for (const oldId of downloadsById.keys()) {
        if (!ids.has(oldId)) {
            const row = $(`dl-${oldId}`);
            if (row) row.remove();
            downloadsById.delete(oldId);
        }
    }

    downloads.forEach(item => {
        downloadsById.set(item.id, item);
        renderDownloadRow(item);
    });

    ensureEmptyState();
    updateDashboardSummary(downloads);
}

async function pollDownloads() {
    try {
        const result = await apiGet("/api/downloads");
        if (result.ok) syncDownloads(result.downloads || []);
    } catch (error) {
        console.error(error);
    }
}

async function cancelDownload(id) {
    await apiPost("/api/cancel", { download_id: id });
}

async function cancelAllDownloads() {
    showConfirm("Cancel all active downloads?", async () => {
        await apiPost("/api/cancel_all", {});
        showSystemNotice("All active downloads were cancelled.", "warning");
    });
}

async function clearDashboard() {
    const active = Array.from(downloadsById.values()).some(item => item.status === "active");
    if (active) {
        showSystemNotice("Cancel active downloads before clearing the dashboard.", "warning");
        return;
    }
    showConfirm("Clear the finished dashboard queue?", async () => {
        await apiPost("/api/clear_dashboard", {});
        await pollDownloads();
        showSystemNotice("Dashboard cleared.", "success");
    });
}

function showConfirm(message, onConfirm) {
    $("confirm-msg").innerText = String(message || "").toUpperCase();
    $("confirm-yes-btn").onclick = async () => {
        try {
            await onConfirm();
        } finally {
            closeModal("confirm-modal");
        }
    };
    openModal("confirm-modal");
}

function renderBrowserCaptures(captures) {
    const container = $("browser-captures");
    if (!captures.length) {
        container.innerHTML = '<div class="empty-state compact-empty">NO BROWSER CAPTURES YET</div>';
        return;
    }
    container.innerHTML = captures.map(capture => `
        <div class="capture-row">
            <div class="capture-copy">
                <strong>${escapeHtml(String(capture.title || "Browser Capture").toUpperCase())}</strong>
                <span>${escapeHtml(String((capture.kind || "page")).toUpperCase())}</span>
                <p>${escapeHtml(capture.url || capture.page_url || "")}</p>
            </div>
            <div class="capture-actions">
                <button class="small-btn" type="button" onclick="loadCaptureIntoScanner('${capture.id}')">OPEN</button>
            </div>
        </div>
    `).join("");
}

async function pollCaptures() {
    try {
        const result = await apiGet("/api/captures");
        if (!result.ok) return;
        const captures = result.captures || [];
        const newest = captures[0];
        if (newest && !seenCaptureIds.has(newest.id)) {
            seenCaptureIds.add(newest.id);
            $("url-input").value = newest.url || newest.page_url || "";
            openModal("add-url-modal");
            clearVideoInfo();
            fetchInfo();
            setActiveKind("browser", "Browser capture received and scanned.");
            showSystemNotice("New browser capture received.", "success");
        }
        captures.forEach(item => seenCaptureIds.add(item.id));
        renderBrowserCaptures(captures);
    } catch (error) {
        console.error(error);
    }
}

function loadCaptureIntoScanner(captureId) {
    const captures = Array.from(seenCaptureIds);
    void captures;
    apiGet("/api/captures").then(result => {
        const capture = (result.captures || []).find(item => item.id === captureId);
        if (!capture) return;
        $("url-input").value = capture.url || capture.page_url || "";
        openModal("add-url-modal");
        clearVideoInfo();
        fetchInfo();
    });
}

async function clearBrowserInbox() {
    await apiPost("/api/captures/clear", {});
    renderBrowserCaptures([]);
    showSystemNotice("Browser inbox cleared.", "success");
}

async function updateBrowserSync() {
    const browser = $("browser-sync").value;
    await apiPost("/api/set_browser", { browser });
    showSystemNotice(`Browser sync set to ${browser}.`, "info");
}

async function pasteClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        $("url-input").value = text;
    } catch (error) {
        showSystemNotice("Clipboard access failed.", "warning");
    }
}

function toggleDarkMode() {
    const enabled = $("dark-mode-toggle").checked;
    document.body.classList.toggle("dark-mode", enabled);
    window.localStorage.setItem("fetchora-dark-mode", enabled ? "1" : "0");
}

async function changeSavePath() {
    const result = await apiPost("/api/change_save_path", {});
    if (result.path) {
        $("save-path-input").value = result.path;
        showSystemNotice("Download path updated.", "success");
    }
}

async function triggerFfmpegInstall() {
    await apiPost("/api/install_ffmpeg", {});
    showSystemNotice("Media engine install started.", "info");
}

window.addEventListener("DOMContentLoaded", async () => {
    const storedDarkMode = window.localStorage.getItem("fetchora-dark-mode");
    const darkModeEnabled = storedDarkMode === null ? true : storedDarkMode === "1";
    $("dark-mode-toggle").checked = darkModeEnabled;
    document.body.classList.toggle("dark-mode", darkModeEnabled);

    try {
        const result = await apiGet("/api/settings");
        const settings = result.settings;
        $("save-path-input").value = settings.save_path;
        $("browser-sync").value = settings.browser || "None";
        $("bridge-port-note").innerText = `EXTENSION CONNECTS TO HTTP://127.0.0.1:${settings.bridge_port}`.toUpperCase();

        const ffmpegStatus = $("ffmpeg-status");
        const light = ffmpegStatus.querySelector(".light");
        const text = ffmpegStatus.querySelector(".text");
        const installButton = ffmpegStatus.querySelector(".small-btn");
        if (settings.has_ffmpeg) {
            light.className = "light green";
            text.innerText = settings.ffmpeg_mode === "bundled" ? "BUNDLED AND READY" : "ENGINE READY";
            installButton.style.display = "none";
        } else {
            light.className = "light red";
            text.innerText = "ENGINE MISSING";
            installButton.style.display = "none";
        }
    } catch (error) {
        console.error(error);
        showSystemNotice("Failed to load settings.", "error");
    }

    ensureEmptyState();
    setActiveKind("video", "In-page browser popup can now fetch qualities directly.");
    pollDownloads();
    pollCaptures();
    window.setInterval(pollDownloads, 1000);
    window.setInterval(pollCaptures, 1000);
});
