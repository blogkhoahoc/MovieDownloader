// ==UserScript==
// @name         Sieutamphim Bridge — bắt ID video gửi về tool
// @namespace    movie.bridge
// @version      1.6
// @description  Đọc danh sách tập/chất lượng trên các trang phim (mã hóa XOR kiểu sieutamphim), trích ID Abyss và gửi về Movie Downloader đang chạy trên máy (cổng 8765).
// @author       Movie Downloader
// @match        https://www.sieutamphim.pro/*
// @match        https://sieutamphim.pro/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    const PORTS = [8765, 8766, 8767, 8768, 8769];
    let sent = false;

    // ---------- tiện ích ----------
    function gmPost(url, data) {
        const body = JSON.stringify(data);
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === "function") {
                GM_xmlhttpRequest({
                    method: "POST", url, data: body,
                    headers: { "Content-Type": "application/json" },
                    timeout: 4000,
                    onload: r => (r.status >= 200 && r.status < 300 ? resolve(r) : reject(new Error("HTTP " + r.status))),
                    onerror: () => reject(new Error("network")),
                    ontimeout: () => reject(new Error("timeout")),
                });
            } else {
                fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
                    .then(r => (r.ok ? resolve(r) : reject(new Error("HTTP " + r.status))))
                    .catch(reject);
            }
        });
    }

    async function findToolPort() {
        for (const port of PORTS) {
            try {
                await gmPost(`http://127.0.0.1:${port}/ping`, {});
                return port;
            } catch (e) { /* thử cổng tiếp */ }
        }
        return null;
    }

    function decryptGroups() {
        const groups = [...document.querySelectorAll("#mytick .episodeGroup")];
        const out = [];
        window.__bridgeOtherHosts = window.__bridgeOtherHosts || new Set();
        for (const g of groups) {
            const code = g.getAttribute("data-server") || "";
            const raw = (g.getAttribute("data-episodes") || "").replace(/&quot;/g, '"');
            const pairs = [...raw.matchAll(/\{"([^"]+)","([^"]+)"\}/g)]
                .map(m => [m[1], m[2]]);
            if (!pairs.length) continue;

            const enc0 = pairs[0][0];
            const ks = new Set();
            "https://".split("").forEach((pl, i) => {
                if (i < enc0.length) ks.add(enc0.charCodeAt(i) ^ pl.charCodeAt(0));
            });
            if (ks.size !== 1) continue;
            const key = [...ks][0];

            const items = [];
            for (const [enc, num] of pairs) {
                const url = [...enc].map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join("");
                if (!/^https:\/\//.test(url)) continue;
                let m = /[?&]v=([A-Za-z0-9_\-]+)/.exec(url)
                    || /(?:short\.ink|short\.icu|abyss\.to|abysscdn\.com|playhydrax\.com|zplayer\.io|abyssplayer\.com)\/([A-Za-z0-9_\-]+)/.exec(url);
                if (m) { items.push({ num, vid: m[1], kind: "abyss" }); continue; }
                if (/^https:\/\/(vk\.ru|vk\.com)\/video_ext/.test(url)) {
                    items.push({ num, vid: url, kind: "vk" });
                    continue;
                }
                if (/^https:\/\/(ok\.ru|odnoklassniki\.ru)\/videoembed\//.test(url)) {
                    items.push({ num, vid: url, kind: "ok" });
                    continue;
                }
                if (/^https?:\/\/[^\s"]+\.m3u8(\?.*)?$/.test(url)) {
                    items.push({ num, vid: url, kind: "hls" });
                    continue;
                }
                const h = /^https?:\/\/([^\/]+)/.exec(url);
                if (h) window.__bridgeOtherHosts.add(h[1]);
            }
            if (items.length) out.push({ code, items });
        }
        return out;
    }

    function extractTitle() {
        const t = document.title || "";
        return t.replace(/\s*-\s*Status:.*$/i, "").trim() || location.hostname;
    }

    // ---------- badge báo trạng thái trên trang ----------
    function badge(text, color) {
        let el = document.getElementById("movie-bridge-badge");
        if (!el) {
            el = document.createElement("div");
            el.id = "movie-bridge-badge";
            el.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:999999;" +
                "padding:10px 14px;border-radius:10px;color:#fff;font:13px/1.4 system-ui," +
                "Segoe UI,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:320px";
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 12000);
        }
        el.style.background = color;
        el.textContent = "Movie Bridge — " + text;
    }

    // ---------- gửi về tool ----------
    async function send() {
        if (sent) return;
        const servers = decryptGroups();
        if (!servers.length) return; // chưa có dữ liệu — chờ thử lại

        const port = await findToolPort();
        if (!port) {
            badge("chưa thấy Movie Downloader chạy (cổng 8765). Mở tool rồi tải lại trang.", "#B3261E");
            return;
        }
        const payload = {
            site: "sieutamphim",
            url: location.href.split("--")[0],
            title: extractTitle(),
            servers,
        };
        try {
            await gmPost(`http://127.0.0.1:${port}/push`, payload);
            sent = true;
            const total = servers.reduce((a, s) => a + s.items.length, 0);
            badge(`đã gửi ${total} tập về tool ✓ (bấm Tải ngay trong tool)`, "#1E8E3E");
        } catch (e) {
            badge("lỗi khi gửi: " + e.message, "#B3261E");
        }
    }

    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (sent) { clearInterval(timer); return; }
        if (decryptGroups().length) {
            clearInterval(timer);
            send();
        } else if (tries > 40) {
            clearInterval(timer);
            const others = [...(window.__bridgeOtherHosts || [])];
            if (others.length) {
                const vk = others.some(h => /(^|\.)vk\.(ru|com)$/.test(h));
                const ok = others.some(h => /(^|\.)ok\.ru$/.test(h));
                const kk = others.some(h => h.includes("kkphimplayer"));
                let why = others.join(", ");
                if (vk || ok) why = "nguồn VK Video / OK.ru — tool chưa hỗ trợ";
                else if (kk) why = "nguồn kkplayer — domain đã chết";
                badge("trang này KHÔNG có nguồn tải được (" + why + ").", "#F29900");
            } else {
                badge("không thấy danh sách tập mã hóa trên trang này.", "#F29900");
            }
        }
    }, 500);
})();
