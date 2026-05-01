const FETCHORA_API_BASE = "http://127.0.0.1:38945/api";
const FETCHORA_FLOATING_ID = "fetchora-floating-launcher";
const FETCHORA_PLAYER_ID = "fetchora-player-launcher";
const FETCHORA_POPUP_ID = "fetchora-quality-popup";

let fetchoraActiveNode = null;

function isUsableMediaUrl(url) {
    return Boolean(url) && !url.startsWith("blob:") && !url.startsWith("mediastream:");
}

function getSourceUrl(node) {
    const mediaUrl = node?.currentSrc || node?.src || "";
    return isUsableMediaUrl(mediaUrl) ? mediaUrl : window.location.href;
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

function isYouTubeWatchPage() {
    try {
        const url = new URL(window.location.href);
        return url.hostname.includes("youtube.com") && url.pathname === "/watch" && !!url.searchParams.get("v");
    } catch (error) {
        return false;
    }
}

function getPlaylistUrlIfPresent() {
    try {
        const url = new URL(window.location.href);
        const list = url.searchParams.get("list");
        if (!list) return "";
        return `https://www.youtube.com/playlist?list=${list}`;
    } catch (error) {
        return "";
    }
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

function findPrimaryMediaNode() {
    const nodes = getDetectedMediaNodes();
    if (!nodes.length) return null;

    const preferred = nodes.find(node => node.tagName.toLowerCase() === "video");
    return preferred || nodes[0];
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
    if (existing) existing.remove();
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
            await openQualityPopup(fetchoraActiveNode, button);
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
            await openQualityPopup(fetchoraActiveNode, button);
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

    if (!node) {
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
    close.addEventListener("click", () => popup.remove());
    popup.appendChild(close);

    document.body.appendChild(popup);
    return body;
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

async function startDownloadFromPopup(sourceUrl, formatId, title, button) {
    button.disabled = true;
    button.textContent = "STARTING...";
    try {
        const result = await postJson("/download", {
            url: sourceUrl,
            format_id: formatId,
            title,
        });
        button.textContent = result.ok ? "SENT TO FETCHORA" : "FAILED";
        button.style.background = result.ok ? "#4ade80" : "#fb923c";
    } catch (error) {
        button.textContent = "BRIDGE OFFLINE";
        button.style.background = "#fb923c";
    }
}

async function openQualityPopup(node, anchorButton) {
    const sourceNode = node || findPrimaryMediaNode();
    if (!sourceNode) {
        return;
    }

    const playableUrl = getSourceUrl(sourceNode);
    const sourceUrl = isYouTubeWatchPage()
        ? getCanonicalPageUrl()
        : (isUsableMediaUrl(playableUrl) ? playableUrl : getCanonicalPageUrl());
    const playlistUrl = getPlaylistUrlIfPresent();
    const body = createPopup(anchorButton, "FETCHORA QUALITIES");
    anchorButton.textContent = "LOADING...";

    try {
        const result = await postJson("/info", { url: sourceUrl });
        if (!result.ok || !result.info) {
            body.textContent = result.error || "Unable to inspect this source.";
            return;
        }

        const info = result.info;
        body.innerHTML = "";

        const headline = document.createElement("div");
        headline.textContent = String(info.title || "Source").slice(0, 100);
        headline.style.fontSize = "11px";
        headline.style.opacity = "0.82";
        headline.style.marginBottom = "8px";
        body.appendChild(headline);

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
                startDownloadFromPopup(sourceUrl, format.id || "best", info.title || document.title || "Download", formatButton);
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
    fetchoraActiveNode = findPrimaryMediaNode();
    updateLaunchers(fetchoraActiveNode);
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
