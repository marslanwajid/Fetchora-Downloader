const FETCHORA_API_BASE = "http://127.0.0.1:38945/api";
const FETCHORA_FLOATING_ID = "fetchora-floating-launcher";
const FETCHORA_PLAYER_ID = "fetchora-player-launcher";
const FETCHORA_POPUP_ID = "fetchora-quality-popup";

const MEDIA_EXTENSIONS = [
    ".m3u8", ".mpd", ".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi",
    ".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"
];
const NON_MEDIA_EXTENSIONS = [
    ".js", ".mjs", ".css", ".json", ".xml", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico"
];
const MEDIA_HINT_KEYS = [
    "video", "audio", "stream", "media", "playlist", "manifest", "mpd", "m3u8"
];

let fetchoraDetection = null;

function isUsableMediaUrl(url) {
    return Boolean(url) && !url.startsWith("blob:") && !url.startsWith("mediastream:");
}

function safeUrl(rawUrl) {
    try {
        return new URL(rawUrl, window.location.href).toString();
    } catch (error) {
        return "";
    }
}

function looksLikeMediaUrl(url) {
    if (!isUsableMediaUrl(url)) return false;
    const normalized = safeUrl(url);
    if (!normalized) return false;
    const parsed = new URL(normalized);
    const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (MEDIA_EXTENSIONS.some(ext => haystack.includes(ext))) return true;
    if (NON_MEDIA_EXTENSIONS.some(ext => haystack.includes(ext))) return false;
    return MEDIA_HINT_KEYS.some(token => haystack.includes(token));
}

function getNodeMediaUrls(node) {
    const urls = [];
    const candidates = [node?.currentSrc, node?.src];
    candidates.forEach(url => {
        if (isUsableMediaUrl(url)) urls.push(url);
    });
    node?.querySelectorAll?.("source").forEach(sourceNode => {
        if (isUsableMediaUrl(sourceNode.src)) {
            urls.push(sourceNode.src);
        }
    });
    return urls;
}

function getCanonicalPageUrl() {
    try {
        const url = new URL(window.location.href);
        if (url.hostname.includes("youtube.com") && url.pathname === "/watch" && url.searchParams.get("v")) {
            return `https://www.youtube.com/watch?v=${url.searchParams.get("v")}`;
        }
        return url.toString();
    } catch (error) {
        return window.location.href;
    }
}

function getCurrentWatchPlaylistUrl() {
    try {
        const url = new URL(window.location.href);
        if (!url.hostname.includes("youtube.com") || url.pathname !== "/watch") {
            return "";
        }

        const list = url.searchParams.get("list");
        const videoId = url.searchParams.get("v");
        if (!list || !videoId) return "";

        const playlistUrl = new URL("https://www.youtube.com/watch");
        playlistUrl.searchParams.set("v", videoId);
        playlistUrl.searchParams.set("list", list);

        const index = url.searchParams.get("index");
        if (index) playlistUrl.searchParams.set("index", index);

        return playlistUrl.toString();
    } catch (error) {
        return "";
    }
}

function getPlaylistUrlIfPresent() {
    try {
        const url = new URL(window.location.href);
        const list = url.searchParams.get("list");
        if (!list) return "";

        const watchPlaylistUrl = getCurrentWatchPlaylistUrl();
        if (watchPlaylistUrl) return watchPlaylistUrl;

        return `https://www.youtube.com/playlist?list=${list}`;
    } catch (error) {
        return "";
    }
}

function getPageTitle() {
    return document.title || "Detected Media";
}

async function postJson(path, payload) {
    const response = await fetch(`${FETCHORA_API_BASE}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    return response.json();
}

function getDetectedMediaNodes() {
    return Array.from(document.querySelectorAll("video, audio")).filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
}

function findPrimaryMediaNode(nodes = getDetectedMediaNodes()) {
    if (!nodes.length) return null;
    const preferred = nodes.find(node => node.tagName.toLowerCase() === "video");
    return preferred || nodes[0];
}

function pushCandidate(bucket, seen, candidate) {
    const normalizedUrl = safeUrl(candidate.url || "");
    if (!normalizedUrl) return;

    const key = `${candidate.kind || "browser"}::${normalizedUrl}`;
    if (seen.has(key)) return;
    seen.add(key);

    bucket.push({
        url: normalizedUrl,
        pageUrl: safeUrl(candidate.pageUrl || getCanonicalPageUrl()) || getCanonicalPageUrl(),
        title: candidate.title || getPageTitle(),
        kind: candidate.kind || "browser",
        source: candidate.source || "unknown",
        score: candidate.score || 0,
        usesPageFallback: Boolean(candidate.usesPageFallback),
        node: candidate.node || null,
    });
}

function collectMetaMediaCandidates(candidates, seen) {
    const selectors = [
        ['meta[property="og:video"]', "video", 90],
        ['meta[property="og:audio"]', "audio", 88],
        ['meta[name="twitter:player:stream"]', "video", 86],
        ['meta[itemprop="contentUrl"]', "video", 84],
        ['meta[itemprop="embedUrl"]', "video", 80],
    ];

    selectors.forEach(([selector, kind, score]) => {
        document.querySelectorAll(selector).forEach(node => {
            const content = node.getAttribute("content") || "";
            if (looksLikeMediaUrl(content)) {
                pushCandidate(candidates, seen, {
                    url: content,
                    title: getPageTitle(),
                    kind,
                    source: `meta:${selector}`,
                    score,
                });
            }
        });
    });
}

function collectAnchorMediaCandidates(candidates, seen) {
    Array.from(document.querySelectorAll("a[href], source[src]"))
        .slice(0, 250)
        .forEach(node => {
            const url = node.href || node.src || "";
            if (!looksLikeMediaUrl(url)) return;
            pushCandidate(candidates, seen, {
                url,
                title: getPageTitle(),
                kind: node.tagName.toLowerCase() === "a" ? "file" : "video",
                source: `dom:${node.tagName.toLowerCase()}`,
                score: 55,
            });
        });
}

function collectPerformanceMediaCandidates(candidates, seen) {
    try {
        performance.getEntriesByType("resource")
            .slice(-250)
            .forEach(entry => {
                if (!looksLikeMediaUrl(entry.name)) return;
                pushCandidate(candidates, seen, {
                    url: entry.name,
                    title: getPageTitle(),
                    kind: "video",
                    source: "performance",
                    score: 65,
                });
            });
    } catch (error) {
        void error;
    }
}

function buildDetectionState() {
    const pageUrl = getCanonicalPageUrl();
    const pageTitle = getPageTitle();
    const candidates = [];
    const seen = new Set();
    const mediaNodes = getDetectedMediaNodes();
    const primaryNode = findPrimaryMediaNode(mediaNodes);

    mediaNodes.forEach(node => {
        const kind = node.tagName.toLowerCase() === "audio" ? "audio" : "video";
        const mediaUrls = getNodeMediaUrls(node);
        mediaUrls.forEach(url => {
            pushCandidate(candidates, seen, {
                url,
                title: pageTitle,
                kind,
                source: "media-element",
                score: node === primaryNode ? 100 : 92,
                node,
            });
        });
    });

    collectMetaMediaCandidates(candidates, seen);
    collectAnchorMediaCandidates(candidates, seen);
    collectPerformanceMediaCandidates(candidates, seen);

    const hasMediaHints = Boolean(
        mediaNodes.length ||
        document.querySelector('meta[property="og:video"], meta[property="og:audio"], meta[name="twitter:player:stream"], meta[itemprop="contentUrl"], meta[itemprop="embedUrl"]')
    );

    if (hasMediaHints) {
        pushCandidate(candidates, seen, {
            url: pageUrl,
            pageUrl,
            title: pageTitle,
            kind: mediaNodes.some(node => node.tagName.toLowerCase() === "audio") && !mediaNodes.some(node => node.tagName.toLowerCase() === "video") ? "audio" : "browser",
            source: "page-fallback",
            score: primaryNode ? 70 : 45,
            usesPageFallback: true,
            node: primaryNode,
        });
    }

    candidates.sort((left, right) => right.score - left.score);
    return {
        pageUrl,
        pageTitle,
        candidates,
        primaryNode,
        activeCandidate: candidates[0] || null,
    };
}

function ensureLauncherStyles(button) {
    button.style.border = "2px solid #000000";
    button.style.background = "#bef264";
    button.style.color = "#000000";
    button.style.fontWeight = "700";
    button.style.fontSize = "12px";
    button.style.cursor = "pointer";
    button.style.boxShadow = "4px 4px 0px #000000";
    button.style.padding = "10px 14px";
    button.style.borderRadius = "0";
    button.style.fontFamily = "Arial, sans-serif";
}

function removePopup() {
    const existing = document.getElementById(FETCHORA_POPUP_ID);
    if (existing) {
        if (existing._fetchoraPollId) {
            window.clearInterval(existing._fetchoraPollId);
            existing._fetchoraPollId = null;
        }
        existing.remove();
    }
}

function getPlayerHost(node) {
    if (!node) return null;
    return (
        node.closest("#movie_player") ||
        node.closest(".html5-video-player") ||
        node.closest(".html5-video-container") ||
        node.parentElement
    );
}

function ensureFloatingLauncher() {
    let button = document.getElementById(FETCHORA_FLOATING_ID);
    if (!button) {
        button = document.createElement("button");
        button.id = FETCHORA_FLOATING_ID;
        button.type = "button";
        button.textContent = "Download with Fetchora";
        button.style.position = "fixed";
        button.style.right = "24px";
        button.style.bottom = "24px";
        button.style.zIndex = "2147483647";
        ensureLauncherStyles(button);
        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            await openQualityPopup(fetchoraDetection, button);
        });
        document.body.appendChild(button);
    }
    return button;
}

function ensurePlayerLauncher(node) {
    const host = getPlayerHost(node);
    if (!host) return null;

    const computed = window.getComputedStyle(host);
    if (computed.position === "static") {
        host.style.position = "relative";
    }

    let button = document.getElementById(FETCHORA_PLAYER_ID);
    if (!button) {
        button = document.createElement("button");
        button.id = FETCHORA_PLAYER_ID;
        button.type = "button";
        button.textContent = "Download with Fetchora";
        button.style.position = "absolute";
        button.style.top = "16px";
        button.style.right = "16px";
        button.style.zIndex = "2147483647";
        ensureLauncherStyles(button);
        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            await openQualityPopup(fetchoraDetection, button);
        });
    }

    if (button.parentElement !== host) {
        button.remove();
        host.appendChild(button);
    }

    return button;
}

function updateLaunchers(node) {
    const floating = ensureFloatingLauncher();
    const player = ensurePlayerLauncher(node);

    if (!fetchoraDetection?.activeCandidate) {
        floating.style.display = "none";
        if (player) player.style.display = "none";
        return;
    }

    floating.style.display = "block";
    if (player) {
        player.style.display = "block";
        floating.style.opacity = "0.72";
    } else {
        floating.style.opacity = "1";
    }
}

function createPopup(anchorButton, titleText) {
    removePopup();

    const popup = document.createElement("div");
    popup.id = FETCHORA_POPUP_ID;
    popup.style.position = "fixed";
    popup.style.top = `${Math.min(window.innerHeight - 380, Math.max(24, anchorButton.getBoundingClientRect().bottom + 8))}px`;
    popup.style.left = `${Math.max(24, Math.min(window.innerWidth - 320, anchorButton.getBoundingClientRect().left - 20))}px`;
    popup.style.width = "300px";
    popup.style.maxHeight = "360px";
    popup.style.overflowY = "auto";
    popup.style.zIndex = "2147483647";
    popup.style.background = "#111111";
    popup.style.color = "#ffffff";
    popup.style.border = "2px solid #000000";
    popup.style.boxShadow = "8px 8px 0px #000000";
    popup.style.padding = "12px";
    popup.style.fontFamily = "Arial, sans-serif";

    const title = document.createElement("div");
    title.textContent = titleText;
    title.style.fontSize = "12px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";
    popup.appendChild(title);

    const body = document.createElement("div");
    body.textContent = "Loading qualities...";
    body.style.fontSize = "12px";
    popup.appendChild(body);

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "CLOSE";
    close.style.width = "100%";
    close.style.marginTop = "10px";
    close.style.padding = "8px 10px";
    close.style.border = "2px solid #ffffff";
    close.style.background = "transparent";
    close.style.color = "#ffffff";
    close.style.cursor = "pointer";
    close.addEventListener("click", () => {
        if (popup._fetchoraPollId) {
            window.clearInterval(popup._fetchoraPollId);
            popup._fetchoraPollId = null;
        }
        popup.remove();
    });
    popup.appendChild(close);

    document.body.appendChild(popup);
    return { popup, body, close };
}

function createActionButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.width = "100%";
    button.style.padding = "10px 12px";
    button.style.marginTop = "8px";
    button.style.border = "2px solid #000000";
    button.style.background = "#bef264";
    button.style.color = "#000000";
    button.style.fontWeight = "700";
    button.style.fontSize = "12px";
    button.style.cursor = "pointer";
    button.style.textAlign = "left";
    return button;
}

function isAdaptiveStreamUrl(url) {
    const normalized = safeUrl(url).toLowerCase();
    if (!normalized) return false;
    return normalized.includes(".m3u8") || normalized.includes(".mpd");
}

function looksLikeDirectFileCandidate(candidate) {
    const normalized = safeUrl(candidate?.url || "").toLowerCase();
    if (!normalized) return false;
    return MEDIA_EXTENSIONS.some(ext => normalized.includes(ext)) && !isAdaptiveStreamUrl(normalized);
}

function renderDownloadMonitor(container, title) {
    container.innerHTML = "";

    const name = document.createElement("div");
    name.textContent = String(title || "Download").slice(0, 100);
    name.style.fontSize = "11px";
    name.style.fontWeight = "700";
    name.style.marginBottom = "8px";
    container.appendChild(name);

    const status = document.createElement("div");
    status.textContent = "STARTING DOWNLOAD...";
    status.style.fontSize = "11px";
    status.style.marginBottom = "8px";
    container.appendChild(status);

    const progressWrap = document.createElement("div");
    progressWrap.style.height = "10px";
    progressWrap.style.border = "2px solid #ffffff";
    progressWrap.style.background = "#1c1c1c";
    progressWrap.style.marginBottom = "8px";
    container.appendChild(progressWrap);

    const progressFill = document.createElement("div");
    progressFill.style.height = "100%";
    progressFill.style.width = "0%";
    progressFill.style.background = "#bef264";
    progressWrap.appendChild(progressFill);

    const speed = document.createElement("div");
    speed.textContent = "SPEED: QUEUED";
    speed.style.fontSize = "11px";
    speed.style.opacity = "0.8";
    speed.style.marginBottom = "10px";
    container.appendChild(speed);

    const actions = document.createElement("div");
    actions.style.display = "grid";
    actions.style.gap = "8px";
    container.appendChild(actions);

    return { status, progressFill, speed, actions };
}

function createMonitorAction(label, accent = "#bef264") {
    const button = createActionButton(label);
    button.style.background = accent;
    button.style.textAlign = "center";
    return button;
}

async function pollDownloadState(downloadId) {
    const result = await fetch(`${FETCHORA_API_BASE}/downloads`, { cache: "no-store" });
    const payload = await result.json();
    if (!payload.ok) return null;
    return (payload.downloads || []).find(item => item.id === downloadId) || null;
}

function bindPopupDownloadMonitor(popup, container, downloadId, title) {
    if (popup._fetchoraPollId) {
        window.clearInterval(popup._fetchoraPollId);
        popup._fetchoraPollId = null;
    }

    const monitor = renderDownloadMonitor(container, title);

    const renderState = item => {
        if (!item) {
            monitor.status.textContent = "WAITING FOR FETCHORA...";
            monitor.speed.textContent = "SPEED: QUEUED";
            return false;
        }

        const pct = Math.max(0, Math.min(Number(item.progress || 0) * 100, 100));
        monitor.progressFill.style.width = `${pct}%`;
        monitor.speed.textContent = `SPEED: ${String(item.speed || "QUEUED").toUpperCase()}`;

        if (item.status === "completed") {
            monitor.status.textContent = "DOWNLOAD COMPLETE";
            monitor.progressFill.style.width = "100%";
            monitor.actions.innerHTML = "";

            const openFile = createMonitorAction("OPEN FILE", "#4ade80");
            openFile.addEventListener("click", async () => {
                await postJson("/open_file", { path: item.save_path || "" });
            });
            monitor.actions.appendChild(openFile);

            const openFolder = createMonitorAction("OPEN FOLDER", "#bef264");
            openFolder.addEventListener("click", async () => {
                await postJson("/open_folder", { path: item.save_path || "" });
            });
            monitor.actions.appendChild(openFolder);

            const closeButton = createMonitorAction("CLOSE", "transparent");
            closeButton.style.color = "#ffffff";
            closeButton.style.border = "2px solid #ffffff";
            closeButton.addEventListener("click", () => popup.remove());
            monitor.actions.appendChild(closeButton);
            return true;
        }

        if (item.status === "error") {
            monitor.status.textContent = String(item.error || "DOWNLOAD FAILED").toUpperCase();
            monitor.actions.innerHTML = "";
            const closeButton = createMonitorAction("CLOSE", "#fb923c");
            closeButton.addEventListener("click", () => popup.remove());
            monitor.actions.appendChild(closeButton);
            return true;
        }

        if (item.status === "cancelled") {
            monitor.status.textContent = "DOWNLOAD CANCELLED";
            monitor.actions.innerHTML = "";
            const closeButton = createMonitorAction("CLOSE", "#fb923c");
            closeButton.addEventListener("click", () => popup.remove());
            monitor.actions.appendChild(closeButton);
            return true;
        }

        monitor.status.textContent = pct > 0 ? `DOWNLOADING... ${pct.toFixed(1)}%` : "PREPARING DOWNLOAD...";
        monitor.actions.innerHTML = "";
        const cancelButton = createMonitorAction("CANCEL", "#fb923c");
        cancelButton.addEventListener("click", async () => {
            await postJson("/cancel", { download_id: downloadId });
        });
        monitor.actions.appendChild(cancelButton);
        return false;
    };

    const tick = async () => {
        try {
            const item = await pollDownloadState(downloadId);
            const done = renderState(item);
            if (done && popup._fetchoraPollId) {
                window.clearInterval(popup._fetchoraPollId);
                popup._fetchoraPollId = null;
            }
        } catch (error) {
            monitor.status.textContent = "FETCHORA STATUS UNAVAILABLE";
            monitor.speed.textContent = "CHECK DESKTOP APP";
        }
    };

    tick();
    popup._fetchoraPollId = window.setInterval(tick, 1000);
}

async function startDownloadFromPopup(sourceUrl, formatId, title, popup, container) {
    const monitor = renderDownloadMonitor(container, title);
    monitor.status.textContent = "STARTING DOWNLOAD...";

    try {
        const result = await postJson("/download", {
            url: sourceUrl,
            format_id: formatId,
            title,
        });
        if (!result.ok || !result.download_id) {
            monitor.status.textContent = "FAILED TO START";
            monitor.speed.textContent = "CHECK FETCHORA";
            return;
        }
        bindPopupDownloadMonitor(popup, container, result.download_id, title);
    } catch (error) {
        monitor.status.textContent = "BRIDGE OFFLINE";
        monitor.speed.textContent = "FETCHORA DESKTOP IS NOT REACHABLE";
    }
}

async function resolveSourceInfo(detection) {
    const candidate = detection?.activeCandidate;
    if (!candidate) return { ok: false, error: "No media was detected on this page." };

    const attempts = [];
    const preferPageExtraction =
        candidate.usesPageFallback ||
        candidate.pageUrl !== candidate.url ||
        candidate.source === "media-element" ||
        candidate.source === "performance" ||
        candidate.source.startsWith("meta:") ||
        isAdaptiveStreamUrl(candidate.url);

    if (preferPageExtraction && candidate.pageUrl) {
        attempts.push({
            url: candidate.pageUrl,
            mode: "page",
            note: candidate.usesPageFallback
                ? "Fetchora is inspecting the page to recover the full media source."
                : "Fetchora is inspecting the page first to recover the full quality list.",
        });
    }

    if (looksLikeDirectFileCandidate(candidate) || (!candidate.usesPageFallback && candidate.url && candidate.url !== candidate.pageUrl)) {
        attempts.push({
            url: candidate.url,
            mode: "direct",
            note: looksLikeDirectFileCandidate(candidate)
                ? `Detected direct media file from ${candidate.source}.`
                : `Detected media source from ${candidate.source}.`,
        });
    }

    let lastError = "Unable to inspect this source.";
    for (const attempt of attempts) {
        try {
            const result = await postJson("/info", { url: attempt.url });
            if (result.ok && result.info) {
                return {
                    ok: true,
                    info: result.info,
                    sourceUrl: attempt.url,
                    note: attempt.note,
                    mode: attempt.mode,
                };
            }
            lastError = result.error || lastError;
        } catch (error) {
            lastError = "Fetchora bridge is offline or unreachable.";
        }
    }

    return { ok: false, error: lastError };
}

async function openQualityPopup(detection, anchorButton) {
    const activeDetection = detection?.activeCandidate ? detection : buildDetectionState();
    if (!activeDetection?.activeCandidate) {
        return;
    }

    fetchoraDetection = activeDetection;
    const playlistUrl = getPlaylistUrlIfPresent();
    const popupState = createPopup(anchorButton, "FETCHORA QUALITIES");
    const { popup, body } = popupState;
    anchorButton.textContent = "LOADING...";

    try {
        const resolved = await resolveSourceInfo(activeDetection);
        if (!resolved.ok || !resolved.info) {
            body.textContent = resolved.error || "Unable to inspect this source.";
            return;
        }

        const info = resolved.info;
        const sourceUrl = resolved.sourceUrl;
        body.innerHTML = "";

        const headline = document.createElement("div");
        headline.textContent = String(info.title || "Source").slice(0, 100);
        headline.style.fontSize = "11px";
        headline.style.opacity = "0.82";
        headline.style.marginBottom = "8px";
        body.appendChild(headline);

        const note = document.createElement("div");
        note.textContent = resolved.note;
        note.style.fontSize = "11px";
        note.style.opacity = "0.72";
        note.style.marginBottom = "8px";
        body.appendChild(note);

        if (playlistUrl) {
            const playlistButton = createActionButton("SEND PLAYLIST TO FETCHORA");
            playlistButton.style.background = "#fb923c";
            playlistButton.addEventListener("click", async () => {
                await postJson("/capture", {
                    url: playlistUrl,
                    page_url: window.location.href,
                    title: document.title || "Playlist",
                    kind: "playlist",
                    source: "extension_playlist_popup",
                });
                playlistButton.textContent = "PLAYLIST SENT";
                playlistButton.style.background = "#4ade80";
            });
            body.appendChild(playlistButton);
        }

        if (info.type === "playlist") {
            const openButton = createActionButton("OPEN PLAYLIST IN FETCHORA");
            openButton.addEventListener("click", async () => {
                await postJson("/capture", {
                    url: sourceUrl,
                    page_url: window.location.href,
                    title: info.title || document.title || "Playlist",
                    kind: "playlist",
                    source: "extension_playlist_popup",
                });
                openButton.textContent = "PLAYLIST SENT";
                openButton.style.background = "#4ade80";
            });
            body.appendChild(openButton);
            return;
        }

        const formats = (info.formats || []).slice(0, 16);
        formats.forEach(format => {
            const label = `${format.resolution || "AUTO"} | ${format.type || "DOWNLOAD"} | ${format.size || "UNKNOWN"}`.toUpperCase();
            const formatButton = createActionButton(label);
            formatButton.addEventListener("click", () => {
                startDownloadFromPopup(sourceUrl, format.id || "best", info.title || document.title || "Download", popup, body);
            });
            body.appendChild(formatButton);
        });

        if (!formats.length) {
            body.textContent = "No downloadable formats were returned.";
        }
    } catch (error) {
        body.textContent = "Fetchora bridge is offline or unreachable.";
    } finally {
        anchorButton.textContent = "Download with Fetchora";
    }
}

function refreshDetectedMedia() {
    fetchoraDetection = buildDetectionState();
    updateLaunchers(fetchoraDetection.primaryNode);
}

window.addEventListener("scroll", refreshDetectedMedia, { passive: true });
window.addEventListener("resize", refreshDetectedMedia);
document.addEventListener("fullscreenchange", refreshDetectedMedia);
document.addEventListener("click", event => {
    const popup = document.getElementById(FETCHORA_POPUP_ID);
    if (popup && !popup.contains(event.target) && event.target.id !== FETCHORA_PLAYER_ID && event.target.id !== FETCHORA_FLOATING_ID) {
        popup.remove();
    }
});

const observer = new MutationObserver(() => {
    refreshDetectedMedia();
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
});

refreshDetectedMedia();
