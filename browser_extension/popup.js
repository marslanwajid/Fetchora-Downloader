const apiBase = "http://127.0.0.1:38945/api";

function normalizeMediaCandidate(item, pageUrl, pageTitle) {
    const rawUrl = String(item.url || "").trim();
    const usableMediaUrl = rawUrl && !rawUrl.startsWith("blob:") && !rawUrl.startsWith("mediastream:") ? rawUrl : "";
    return {
        url: usableMediaUrl || pageUrl,
        media_url: usableMediaUrl,
        page_url: pageUrl,
        title: item.title || pageTitle || "Detected Media",
        kind: usableMediaUrl ? item.kind : "browser",
        source: usableMediaUrl ? "extension_media_scan" : "extension_media_scan_page_fallback",
    };
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

async function sendCapture(payload) {
    const response = await fetch(`${apiBase}/capture`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Bridge error: ${response.status}`);
    }
    return response.json();
}

async function scanMediaOnPage(tabId) {
    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const mediaExtensions = [
                ".m3u8", ".mpd", ".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi",
                ".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"
            ];
            const nonMediaExtensions = [
                ".js", ".mjs", ".css", ".json", ".xml", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico"
            ];
            const mediaHintKeys = ["video", "audio", "stream", "media", "playlist", "manifest", "mpd", "m3u8"];

            function normalizeUrl(rawUrl) {
                try {
                    return new URL(rawUrl, window.location.href).toString();
                } catch (error) {
                    return "";
                }
            }

            function isUsableMediaUrl(url) {
                return Boolean(url) && !url.startsWith("blob:") && !url.startsWith("mediastream:");
            }

            function looksLikeMediaUrl(url) {
                if (!isUsableMediaUrl(url)) return false;
                const normalized = normalizeUrl(url);
                if (!normalized) return false;
                const parsed = new URL(normalized);
                const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase();
                if (mediaExtensions.some(ext => haystack.includes(ext))) return true;
                if (nonMediaExtensions.some(ext => haystack.includes(ext))) return false;
                return mediaHintKeys.some(token => haystack.includes(token));
            }

            function pushMatch(bucket, seen, item) {
                const normalizedUrl = normalizeUrl(item.url || "");
                if (!normalizedUrl) return;
                const key = `${item.kind || "file"}::${normalizedUrl}`;
                if (seen.has(key)) return;
                seen.add(key);
                bucket.push({
                    id: item.id,
                    url: normalizedUrl,
                    title: item.title || document.title || "Detected Media",
                    kind: item.kind || "file",
                    source: item.source || "scan",
                });
            }

            const matches = [];
            const seen = new Set();

            document.querySelectorAll("video, audio").forEach((node, index) => {
                const kind = node.tagName.toLowerCase() === "audio" ? "audio" : "video";
                const src = node.currentSrc || node.src || "";
                if (looksLikeMediaUrl(src)) {
                    pushMatch(matches, seen, {
                        id: index,
                        url: src,
                        title: document.title || "Detected Media",
                        kind,
                        source: "media-element",
                    });
                }
                node.querySelectorAll("source").forEach((sourceNode, nestedIndex) => {
                    if (looksLikeMediaUrl(sourceNode.src)) {
                        pushMatch(matches, seen, {
                            id: `${index}-${nestedIndex}`,
                            url: sourceNode.src,
                            title: document.title || "Detected Media",
                            kind,
                            source: "media-source",
                        });
                    }
                });
            });

            [
                ['meta[property="og:video"]', "video"],
                ['meta[property="og:audio"]', "audio"],
                ['meta[name="twitter:player:stream"]', "video"],
                ['meta[itemprop="contentUrl"]', "video"],
                ['meta[itemprop="embedUrl"]', "video"],
            ].forEach(([selector, kind], index) => {
                document.querySelectorAll(selector).forEach((node, nestedIndex) => {
                    const content = node.getAttribute("content") || "";
                    if (looksLikeMediaUrl(content)) {
                        pushMatch(matches, seen, {
                            id: `meta-${index}-${nestedIndex}`,
                            url: content,
                            title: document.title || "Detected Media",
                            kind,
                            source: selector,
                        });
                    }
                });
            });

            Array.from(document.querySelectorAll("a[href], source[src]"))
                .slice(0, 250)
                .forEach((node, index) => {
                    const url = node.href || node.src || "";
                    if (!looksLikeMediaUrl(url)) return;
                    pushMatch(matches, seen, {
                        id: `dom-${index}`,
                        url,
                        title: document.title || "Detected Media",
                        kind: node.tagName.toLowerCase() === "a" ? "file" : "video",
                        source: `dom:${node.tagName.toLowerCase()}`,
                    });
                });

            try {
                performance.getEntriesByType("resource")
                    .slice(-250)
                    .forEach((entry, index) => {
                        if (!looksLikeMediaUrl(entry.name)) return;
                        pushMatch(matches, seen, {
                            id: `perf-${index}`,
                            url: entry.name,
                            title: document.title || "Detected Media",
                            kind: "video",
                            source: "performance",
                        });
                    });
            } catch (error) {
                void error;
            }

            return matches;
        },
    });

    return result ? result.result || [] : [];
}

function setStatus(text) {
    document.getElementById("status-text").innerText = text.toUpperCase();
}

function renderMediaList(items) {
    const list = document.getElementById("media-list");
    if (!items.length) {
        list.innerHTML = "<li>No media found on this page.</li>";
        return;
    }

    list.innerHTML = items.map(item => {
        const rawUrl = String(item.url || "");
        const displayUrl = rawUrl.startsWith("blob:") || rawUrl.startsWith("mediastream:")
            ? `PAGE FALLBACK -> ${window.location.hostname}`
            : rawUrl;
        return `<li>${item.kind.toUpperCase()} (${String(item.source || "scan").toUpperCase()}): ${displayUrl}</li>`;
    }).join("");
}

document.getElementById("send-page-btn").addEventListener("click", async () => {
    try {
        const tab = await getActiveTab();
        await sendCapture({
            url: tab.url,
            page_url: tab.url,
            title: tab.title || "Browser Page",
            kind: "browser",
            source: "extension_page_send",
        });
        setStatus("Page sent to Fetchora");
    } catch (error) {
        setStatus(`Failed to send page: ${error.message}`);
    }
});

document.getElementById("scan-media-btn").addEventListener("click", async () => {
    try {
        const tab = await getActiveTab();
        const mediaItems = await scanMediaOnPage(tab.id);
        renderMediaList(mediaItems);

        if (!mediaItems.length) {
            setStatus("No media tags found on this page");
            return;
        }

        for (const item of mediaItems) {
            await sendCapture(normalizeMediaCandidate(item, tab.url, tab.title || "Detected Media"));
        }

        setStatus(`Sent ${mediaItems.length} media item(s)`);
    } catch (error) {
        setStatus(`Scan failed: ${error.message}`);
    }
});
