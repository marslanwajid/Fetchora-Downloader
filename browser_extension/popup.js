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
            const matches = [];
            document.querySelectorAll("video, audio").forEach((node, index) => {
                const src = node.currentSrc || node.src || "";
                if (src) {
                    matches.push({
                        id: index,
                        url: src,
                        title: document.title || "Detected Media",
                        kind: node.tagName.toLowerCase() === "audio" ? "audio" : "video",
                    });
                }
                node.querySelectorAll("source").forEach((sourceNode, nestedIndex) => {
                    if (sourceNode.src) {
                        matches.push({
                            id: `${index}-${nestedIndex}`,
                            url: sourceNode.src,
                            title: document.title || "Detected Media",
                            kind: node.tagName.toLowerCase() === "audio" ? "audio" : "video",
                        });
                    }
                });
            });
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
        return `<li>${item.kind.toUpperCase()}: ${displayUrl}</li>`;
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
