function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0.0 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    const precision = index === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[index]}`;
}

function normalizeSpeed(value) {
    const text = String(value || '0 KB/S').trim();
    return text ? text.toUpperCase() : '0 KB/S';
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $(`view-${viewId}`).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = Array.from(document.querySelectorAll('.nav-btn')).find(
        btn => btn.innerText.includes(viewId.toUpperCase())
    );
    if (targetBtn) targetBtn.classList.add('active');
}

function openModal(modalId) {
    $(modalId).style.display = 'block';
}

function closeModal(modalId) {
    $(modalId).style.display = 'none';
}

function showSystemNotice(message, tone = 'info') {
    const notice = $('system-notice');
    notice.className = `system-notice show tone-${tone}`;
    $('system-notice-text').innerText = String(message || '').toUpperCase();
    window.clearTimeout(showSystemNotice.timeoutId);
    showSystemNotice.timeoutId = window.setTimeout(() => {
        notice.classList.remove('show');
    }, 5000);
}

function clearVideoInfo() {
    $('video-info').classList.add('hidden');
    $('formats-list').innerHTML = '';
    currentPlaylist = null;
}

function updateDashboardSummary() {
    const totalBytes = Object.values(activeDownloads).reduce(
        (sum, item) => sum + (item.completedBytes || 0),
        0
    );
    $('total-downloaded').innerText = formatBytes(totalBytes).toUpperCase();

    const activeCount = Object.values(activeDownloads).filter(item => item.status === 'active').length;
    if (activeCount === 0) {
        $('global-speed').innerText = '0 KB/S';
    }
}

function ensureEmptyState() {
    const list = $('active-downloads');
    const hasRows = list.querySelector('.download-row');
    const existingEmpty = list.querySelector('.empty-state');
    if (!hasRows && !existingEmpty) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerText = 'NO ACTIVE DOWNLOADS';
        list.appendChild(empty);
    } else if (hasRows && existingEmpty) {
        existingEmpty.remove();
    }
}

let activeDownloads = {};
let currentPlaylist = null;

async function fetchInfo() {
    const url = $('url-input').value.trim();
    if (!url) {
        showSystemNotice('Paste a video or playlist URL first.', 'warning');
        return;
    }

    const fetchBtn = $('fetch-btn');
    fetchBtn.disabled = true;
    fetchBtn.innerText = 'SCANNING...';
    clearVideoInfo();

    try {
        const info = await eel.get_video_info(url)();
        if (!info) {
            showSystemNotice('Scan failed. Check the URL or browser sync.', 'error');
            return;
        }
        displayInfo(info);
    } catch (error) {
        console.error(error);
        showSystemNotice(`Scan failed: ${error}`, 'error');
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerText = 'SCAN URL';
    }
}

function displayInfo(info) {
    if (!info) return;

    const infoPanel = $('video-info');
    infoPanel.classList.remove('hidden');
    $('video-title').innerText = String(info.title || 'UNKNOWN TITLE').toUpperCase();

    const list = $('formats-list');
    list.innerHTML = '';

    if (info.type === 'playlist') {
        currentPlaylist = info;
        const isAutoPlaylist = info.title.toUpperCase().includes('MIX') || info.entries.length > 50;
        const initialCount = isAutoPlaylist ? 20 : info.entries.length;
        renderPlaylistContent(initialCount, isAutoPlaylist);
        return;
    }

    currentPlaylist = null;
    info.formats.forEach(f => {
        const row = document.createElement('div');
        row.className = 'format-row';
        let typeText = f.type || 'UNKNOWN';
        if (typeText.includes('Mute')) typeText = 'HIGH-RES + SOUND (AUTO)';
        row.innerHTML = `
            <span class="col-res">${escapeHtml(f.resolution || 'AUTO')}</span>
            <span class="col-type">${escapeHtml(typeText.toUpperCase())}</span>
            <span class="col-size">${escapeHtml((f.size || 'UNKNOWN').toUpperCase())}</span>
            <div class="col-action">
                <button class="get-btn" type="button" data-format-id="${escapeHtml(f.id || 'best')}">GET</button>
            </div>
        `;
        row.querySelector('.get-btn').addEventListener('click', () => startDownload(f.id || 'best', info.title));
        list.appendChild(row);
    });
}

function renderPlaylistContent(count, isLimited) {
    const list = $('formats-list');
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
                    ${isLimited ? `<span class="warning-text">PREVIEWING FIRST ${count}</span>` : '<span class="warning-text">FULL PLAYLIST READY</span>'}
                </div>
            </div>

            <div class="bulk-config">
                <div class="quality-selector">
                    <label>SELECT QUALITY:</label>
                    <select id="bulk-quality">
                        <option value="1080p">1080P FULL HD</option>
                        <option value="720p" selected>720P HD</option>
                        <option value="480p">480P SD</option>
                        <option value="360p">360P LOW</option>
                        <option value="audio">AUDIO ONLY (MP3)</option>
                    </select>
                </div>
                <button class="primary-btn" type="button" onclick="startBulkDownload()">GET SELECTED TRACKS</button>
            </div>

            ${isLimited ? `
                <div class="load-more-section">
                    <p class="small-hint">THIS IS A LARGE OR AUTOMATED MIX. LOADING EVERYTHING MAY TAKE LONGER.</p>
                    <button class="load-all-btn" id="load-all-trigger" type="button" onclick="loadFullPlaylist()">LOAD FULL PLAYLIST</button>
                </div>
            ` : ''}
        </div>
        <div class="playlist-preview">
            ${displayEntries.map((entry, index) => `
                <div class="playlist-item">
                    <label class="custom-checkbox">
                        <input
                            type="checkbox"
                            class="playlist-item-checkbox"
                            data-url="${escapeHtml(entry.url || '')}"
                            data-title="${escapeHtml(entry.title || 'UNKNOWN TITLE')}"
                            checked
                            onchange="refreshPlaylistSelection()"
                        >
                        <span class="checkmark"></span>
                        ${escapeHtml((entry.title || 'UNKNOWN TITLE').toUpperCase())}
                    </label>
                </div>
            `).join('')}
        </div>
    `;

    refreshPlaylistSelection();
}

function loadFullPlaylist() {
    const trigger = $('load-all-trigger');
    if (trigger) trigger.innerText = 'LOADING...';
    window.setTimeout(() => renderPlaylistContent(currentPlaylist.entries.length, false), 50);
}

function toggleSelectAll(master) {
    document.querySelectorAll('.playlist-item-checkbox').forEach(cb => {
        cb.checked = master.checked;
    });
    refreshPlaylistSelection();
}

function refreshPlaylistSelection() {
    const checked = document.querySelectorAll('.playlist-item-checkbox:checked').length;
    const total = document.querySelectorAll('.playlist-item-checkbox').length;
    const master = $('select-all-playlist');
    if (master) {
        master.checked = total > 0 && checked === total;
        master.indeterminate = checked > 0 && checked < total;
    }
}

async function startBulkDownload() {
    if (!currentPlaylist) return;

    const quality = $('bulk-quality').value;
    const checkedBoxes = document.querySelectorAll('.playlist-item-checkbox:checked');
    const items = Array.from(checkedBoxes)
        .map(cb => {
            const url = cb.dataset.url || '';
            const title = cb.dataset.title || 'Unknown Title';
            if (!url) return null;
            const dlId = Math.random().toString(36).slice(2, 11);
            addDownloadToDashboard(dlId, title);
            return { url, title, id: dlId };
        })
        .filter(Boolean);

    if (items.length === 0) {
        showSystemNotice('Select at least one track to continue.', 'warning');
        return;
    }

    closeModal('add-url-modal');
    showView('dashboard');
    showSystemNotice(`Queued ${items.length} playlist items.`, 'info');

    try {
        await eel.start_bulk_download(items, quality)();
    } catch (error) {
        console.error(error);
        showSystemNotice(`Bulk download failed to start: ${error}`, 'error');
    }
}

async function startDownload(formatId, title) {
    const url = $('url-input').value.trim();
    if (!url) {
        showSystemNotice('Paste a URL before starting a download.', 'warning');
        return;
    }

    closeModal('add-url-modal');
    showView('dashboard');

    const dlId = Math.random().toString(36).slice(2, 11);
    addDownloadToDashboard(dlId, title);

    try {
        await eel.start_download(url, formatId, dlId)();
    } catch (error) {
        console.error('Download trigger failed:', error);
        markDownloadState(dlId, 'error', `FAILED: ${error}`);
        showSystemNotice(`Download failed to start: ${error}`, 'error');
    }
}

function addDownloadToDashboard(id, title) {
    const list = $('active-downloads');
    ensureEmptyState();

    const row = document.createElement('div');
    row.className = 'download-row';
    row.id = `dl-${id}`;
    row.setAttribute('data-status', 'active');
    row.innerHTML = `
        <span class="col-status"><span class="light blue"></span></span>
        <span class="col-name" title="${escapeHtml(title)}">${escapeHtml(title.toUpperCase())}</span>
        <div class="col-progress">
            <div class="progress-bar-container">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
        </div>
        <span class="col-speed">QUEUED</span>
        <div class="col-actions">
            <button class="small-btn" type="button" onclick="cancelDownload('${id}')">CANCEL</button>
        </div>
    `;
    list.appendChild(row);

    activeDownloads[id] = {
        title,
        progress: 0,
        status: 'active',
        completedBytes: 0,
        savePath: ''
    };
    ensureEmptyState();
    updateDashboardSummary();
}

function markDownloadState(id, status, speedText) {
    const row = $(`dl-${id}`);
    if (!row) return;

    row.setAttribute('data-status', status);
    const light = row.querySelector('.light');
    const speed = row.querySelector('.col-speed');
    const actions = row.querySelector('.col-actions');

    if (status === 'completed') {
        light.className = 'light green';
    } else if (status === 'cancelled') {
        light.className = 'light yellow';
    } else if (status === 'error') {
        light.className = 'light red';
    } else {
        light.className = 'light blue';
    }

    if (speedText) speed.innerText = speedText;
    if (status !== 'active') actions.innerHTML = '';
}

function setRowOpenFolderAction(row, savePath) {
    const actions = row.querySelector('.col-actions');
    actions.innerHTML = '';
    if (!savePath) return;

    const button = document.createElement('button');
    button.className = 'small-btn green-text';
    button.type = 'button';
    button.innerText = 'OPEN FOLDER';
    button.addEventListener('click', () => eel.open_folder(savePath)());
    actions.appendChild(button);
}

function filterDownloads(status, btn) {
    document.querySelectorAll('.filter-btn').forEach(button => button.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.download-row').forEach(row => {
        row.style.display = status === 'all' || row.getAttribute('data-status') === status ? 'flex' : 'none';
    });
}

function clearDashboard() {
    const hasActive = Object.values(activeDownloads).some(item => item.status === 'active');
    if (hasActive) {
        showSystemNotice('Active downloads are still running. Cancel them before clearing the dashboard.', 'warning');
        return;
    }

    showConfirm('Clear completed, cancelled, and failed items from the dashboard?', async () => {
        Object.keys(activeDownloads).forEach(id => {
            const row = $(`dl-${id}`);
            if (row) row.remove();
            delete activeDownloads[id];
        });
        ensureEmptyState();
        updateDashboardSummary();
        showSystemNotice('Dashboard cleared.', 'success');
    });
}

function cancelDownload(id) {
    showConfirm('Cancel this download?', async () => {
        await eel.cancel_download(id)();
        if (activeDownloads[id]) activeDownloads[id].status = 'cancelled';
        markDownloadState(id, 'cancelled', 'CANCELLED');
        $('interrupted-msg').innerText = 'PROCESS STOPPED BY USER';
        openModal('interrupted-modal');
        showSystemNotice('Download cancelled.', 'warning');
        updateDashboardSummary();
    });
}

function cancelAllDownloads() {
    showConfirm('Cancel all active downloads?', async () => {
        await eel.cancel_all_downloads()();
        Object.entries(activeDownloads).forEach(([id, item]) => {
            if (item.status === 'active') {
                item.status = 'cancelled';
                markDownloadState(id, 'cancelled', 'CANCELLED');
            }
        });
        $('interrupted-msg').innerText = 'ALL ACTIVE DOWNLOADS WERE STOPPED';
        openModal('interrupted-modal');
        showSystemNotice('All active downloads were cancelled.', 'warning');
        updateDashboardSummary();
    });
}

function showConfirm(message, onConfirm) {
    $('confirm-msg').innerText = String(message || '').toUpperCase();
    $('confirm-yes-btn').onclick = async () => {
        try {
            await onConfirm();
        } finally {
            closeModal('confirm-modal');
        }
    };
    openModal('confirm-modal');
}

function updateBrowserSync() {
    const browser = $('browser-sync').value;
    eel.set_browser(browser)();
    showSystemNotice(`Browser sync set to ${browser}.`, 'info');
}

eel.expose(onProgress);
function onProgress(dlId, progress, speed) {
    const row = $(`dl-${dlId}`);
    if (row) {
        row.querySelector('.progress-fill').style.width = `${Math.max(0, Math.min(progress * 100, 100))}%`;
        row.querySelector('.col-speed').innerText = normalizeSpeed(speed);
        row.setAttribute('data-status', 'active');
        row.querySelector('.light').className = 'light blue';
    }
    if (activeDownloads[dlId]) {
        activeDownloads[dlId].progress = progress;
        activeDownloads[dlId].status = 'active';
    }
    $('global-speed').innerText = normalizeSpeed(speed);
}

eel.expose(onComplete);
function onComplete(dlId, savePath, fileSize) {
    const row = $(`dl-${dlId}`);
    if (activeDownloads[dlId]) {
        activeDownloads[dlId].status = 'completed';
        activeDownloads[dlId].completedBytes = Number(fileSize || 0);
        activeDownloads[dlId].savePath = savePath || '';
    }

    if (row) {
        markDownloadState(dlId, 'completed', 'COMPLETED');
        row.querySelector('.progress-fill').style.width = '100%';
        setRowOpenFolderAction(row, savePath);
    }

    $('completion-msg').innerText = 'DOWNLOAD FINISHED SUCCESSFULLY!';
    $('open-file-btn').disabled = !savePath;
    $('open-folder-btn').disabled = !savePath;
    $('open-file-btn').onclick = () => {
        if (savePath) eel.open_file(savePath)();
        closeModal('completion-modal');
    };
    $('open-folder-btn').onclick = () => {
        if (savePath) eel.open_folder(savePath)();
        closeModal('completion-modal');
    };

    openModal('completion-modal');
    showSystemNotice('Download completed.', 'success');
    updateDashboardSummary();
}

eel.expose(onError);
function onError(dlId, error) {
    if (dlId && activeDownloads[dlId]) {
        activeDownloads[dlId].status = 'error';
        markDownloadState(dlId, 'error', 'FAILED');
    }
    showSystemNotice(`Download error: ${error}`, 'error');
    updateDashboardSummary();
}

eel.expose(onSystemMessage);
function onSystemMessage(message, level) {
    showSystemNotice(message, level || 'info');

    if (String(message).toLowerCase().includes('ffmpeg installed')) {
        const light = $('ffmpeg-status').querySelector('.light');
        const text = $('ffmpeg-status').querySelector('.text');
        light.className = 'light green';
        text.innerText = 'DETECTED';
    }
}

async function pasteClipboard() {
    const text = await eel.get_clipboard()();
    $('url-input').value = text;
}

function toggleDarkMode() {
    const enabled = $('dark-mode-toggle').checked;
    document.body.classList.toggle('dark-mode', enabled);
    window.localStorage.setItem('fetchora-dark-mode', enabled ? '1' : '0');
}

async function changeSavePath() {
    try {
        const path = await eel.change_save_path()();
        if (path) {
            $('save-path-input').value = path;
            showSystemNotice('Download path updated.', 'success');
        }
    } catch (error) {
        console.error(error);
        showSystemNotice(`Failed to change save path: ${error}`, 'error');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const prefersDarkMode = window.localStorage.getItem('fetchora-dark-mode');
    const darkModeEnabled = prefersDarkMode === null ? true : prefersDarkMode === '1';
    $('dark-mode-toggle').checked = darkModeEnabled;
    document.body.classList.toggle('dark-mode', darkModeEnabled);

    ensureEmptyState();

    try {
        const settings = await eel.get_settings()();
        $('save-path-input').value = settings.save_path;
        $('browser-sync').value = settings.browser || 'None';

        const ffmpegStatus = $('ffmpeg-status');
        const light = ffmpegStatus.querySelector('.light');
        const text = ffmpegStatus.querySelector('.text');
        if (settings.has_ffmpeg) {
            light.className = 'light green';
            text.innerText = 'DETECTED';
        } else {
            light.className = 'light red';
            text.innerText = 'NOT DETECTED';
        }
    } catch (error) {
        console.error('Failed to load settings', error);
        showSystemNotice('Failed to load settings.', 'error');
    }
});
