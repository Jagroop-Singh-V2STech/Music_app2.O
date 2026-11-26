// Local evidence checker for the MP3.pm findings (security research, read-only).
// Run: node research/mp3pm-check/server.mjs  → http://localhost:8790
//
// Each "Run checks" click makes 5 small requests to mp3.pm: homepage, robots.txt,
// homepage again (token comparison), one HEAD and one 2-byte Range request on a
// listen URL. It never downloads or plays a song: headers only, plus 2 bytes.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 8790;
const ORIGIN = "https://mp3.pm";
const UA = "Mozilla/5.0 (security-research; mp3pm-check)";
const TIMEOUT = 15000;

const pick = (headers, names) => Object.fromEntries(names.map(n => [n, headers.get(n)]).filter(([, v]) => v));
const AUDIO_HEADERS = ["content-type", "content-length", "content-disposition", "accept-ranges", "content-range", "cache-control", "expires", "access-control-allow-origin", "set-cookie", "x-ratelimit-limit", "retry-after"];

async function get(url, init = {}) {
  const started = Date.now();
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), ...init, headers: { "User-Agent": UA, ...init.headers } });
  return { res, ms: Date.now() - started, at: new Date().toISOString() };
}

function parseItems(html) {
  return [...html.matchAll(/<li class="cplayer-sound-item"([^>]*)>/g)].slice(0, 5).map(([, attrs]) => {
    const attr = name => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
    const listen = attr("data-sound-url");
    const file = listen ? decodeURIComponent(listen.split("/").pop()) : "";
    return { id: attr("data-sound-id"), name: file.replace(/_\(mp3\.pm\)\.mp3$/, "").replace(/_/g, " "), listen, download: attr("data-download-url"), share: attr("data-share-url") };
  });
}

async function runChecks() {
  const log = [];
  const findings = [];
  const step = async (label, url, init) => {
    const r = await get(url, init);
    log.push({ label, method: init?.method || "GET", url, status: r.res.status, ms: r.ms, at: r.at, headers: pick(r.res.headers, AUDIO_HEADERS) });
    return r;
  };

  const home1 = await step("Homepage (load 1)", `${ORIGIN}/`);
  const html1 = await home1.res.text();
  const items = parseItems(html1);
  if (!items.length || !items[0].listen) throw new Error("No data-sound-url found on the homepage (markup may have changed).");
  const first = items[0];

  const robots = await step("robots.txt", `${ORIGIN}/robots.txt`);
  const robotsText = await robots.res.text();

  const home2 = await step("Homepage (load 2)", `${ORIGIN}/`);
  const again = parseItems(await home2.res.text()).find(i => i.id === first.id);

  // No Cookie and no Referer header are sent on these two requests.
  const head = await step("HEAD listen URL (no cookie, no Referer)", first.listen, { method: "HEAD" });
  const range = await step("GET bytes 0-1 (no cookie, no Referer)", first.listen, { headers: { Range: "bytes=0-1" } });
  const rangeBytes = (await range.res.arrayBuffer()).byteLength;

  const h = head.res.headers;
  const ctype = h.get("content-type") || "";
  const sameToken = Boolean(again?.listen) && again.listen === first.listen;

  findings.push({
    id: "F1", title: "Playback token does not change between page loads", severity: "Medium",
    pass: !sameToken,
    evidence: sameToken ? `Song ${first.id}: listen URL identical on both homepage loads (${home1.ms} ms and ${home2.ms} ms requests).` : "Token changed between loads.",
    impact: "A copied listen/download link keeps working, so links can be shared or embedded elsewhere.",
    fix: "Issue short-lived signed tokens (expiry + HMAC) per session/IP.",
  });
  findings.push({
    id: "F2", title: "Audio served without any cookie, session or Referer", severity: "Medium",
    pass: !(head.res.status === 200 && !h.get("set-cookie")),
    evidence: `HEAD returned ${head.res.status}, ${h.get("content-length") || "?"} bytes available, with no Cookie or Referer sent.`,
    impact: "Any site or script can hotlink the files; there is no way to revoke a leaked link.",
    fix: "Require a signed token bound to a session, or validate Referer/Origin at the edge.",
  });
  findings.push({
    id: "F3", title: "Byte-range fetches allowed without auth", severity: "Low",
    pass: range.res.status !== 206,
    evidence: `Range bytes=0-1 → ${range.res.status}, received ${rangeBytes} bytes, Content-Range: ${range.res.headers.get("content-range") || "none"}.`,
    impact: "Files can be fetched in parallel chunks by download tools at full speed.",
    fix: "Apply the same token check to ranged requests; rate-limit per token.",
  });
  findings.push({
    id: "F4", title: "File type mismatch (.mp3 name, AAC content)", severity: "Low",
    pass: !/aac/i.test(ctype) || !/\.mp3$/i.test(first.listen),
    evidence: `URL ends in .mp3, but Content-Type is "${ctype}" and Content-Disposition is "${h.get("content-disposition") || "none"}".`,
    impact: "Players or downloads that trust the extension mislabel the format; duration/metadata probing can fail.",
    fix: "Serve the real extension in the URL, or transcode to match it.",
  });
  findings.push({
    id: "F5", title: "Malformed share URL", severity: "Low",
    pass: !/^https?:\/\/[^/]+https?:\/\//.test(first.share || ""),
    evidence: `data-share-url = ${first.share || "none"}`,
    impact: "Share buttons produce a broken link.",
    fix: "Don't prepend the site origin to an already-absolute URL.",
  });
  findings.push({
    id: "F6", title: "No rate-limit signals on plain requests", severity: "Info",
    pass: log.some(l => l.headers["x-ratelimit-limit"] || l.headers["retry-after"] || l.status === 429),
    evidence: `${log.length} requests in this run, none returned rate-limit headers or 429. (Observation only, not load-tested.)`,
    impact: "Automated clients may be unrestricted.",
    fix: "Add per-IP limits on listen/download endpoints.",
  });

  const disallowSearch = /Disallow:\s*\/search/i.test(robotsText);
  return { checkedAt: new Date().toISOString(), song: { id: first.id, name: first.name }, items: items.map(({ id, name }) => ({ id, name })), robots: { disallowSearch, text: robotsText.trim() }, findings, log };
}

const page = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MP3.pm Findings</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#5d6470;--line:#e3e6eb;--bad:#b42318;--badbg:#fef3f2;--ok:#067647;--okbg:#ecfdf3;--info:#175cd3;--infobg:#eff8ff;--code:#f1f3f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8eaee;--muted:#9aa3b2;--line:#2a2f3a;--bad:#f97066;--badbg:#2a1414;--ok:#47cd89;--okbg:#0f2419;--info:#84caff;--infobg:#0f1d2e;--code:#1f232c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}
button{background:var(--ink);color:var(--bg);border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer}button:disabled{opacity:.5;cursor:wait}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px}.meta{color:var(--muted);font-size:13px}
.grid{display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.f-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.f-head h3{margin:0;font-size:16px;flex:1;min-width:200px}
.pill{font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px}
.confirmed{background:var(--badbg);color:var(--bad)}.notfound{background:var(--okbg);color:var(--ok)}.sev{background:var(--infobg);color:var(--info)}
dl{margin:10px 0 0;display:grid;grid-template-columns:90px 1fr;gap:4px 12px;font-size:14px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
h2{font-size:17px;margin:28px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
td code,pre{background:var(--code);border-radius:6px;font:12px/1.5 ui-monospace,Menlo,monospace}td code{padding:1px 4px;overflow-wrap:anywhere}
pre{padding:10px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.scroll{overflow-x:auto}.err{color:var(--bad)}
.summary{display:flex;gap:16px;flex-wrap:wrap;font-size:14px}.summary b{font-size:20px;display:block}
</style></head><body><main>
<h1>MP3.pm findings</h1>
<p class="sub">Live checks run from this machine. Headers and 2 bytes only: no song is downloaded or played.</p>
<div class="bar"><button id="run">Run checks</button><span class="meta" id="meta">Not run yet.</span></div>
<div id="out"></div>
</main>
<script>
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const out = document.getElementById("out"), meta = document.getElementById("meta"), btn = document.getElementById("run");
async function run() {
  btn.disabled = true; meta.textContent = "Running 5 requests…";
  try {
    const r = await fetch("/api/check"); const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Check failed");
    const confirmed = d.findings.filter(f => !f.pass).length;
    meta.textContent = "Checked " + new Date(d.checkedAt).toLocaleString() + " · tested song #" + d.song.id + " (" + d.song.name + ")";
    out.innerHTML =
      '<div class="card summary"><div><b>' + confirmed + '</b>confirmed</div><div><b>' + (d.findings.length - confirmed) + '</b>not reproduced</div><div><b>' + d.log.length + '</b>requests</div><div><b>' + (d.robots.disallowSearch ? "Yes" : "No") + '</b>robots.txt blocks /search</div></div>' +
      '<h2>Findings</h2><div class="grid">' + d.findings.map(f =>
        '<div class="card"><div class="f-head"><h3>' + esc(f.id) + ' · ' + esc(f.title) + '</h3><span class="pill sev">' + esc(f.severity) + '</span><span class="pill ' + (f.pass ? "notfound" : "confirmed") + '">' + (f.pass ? "Not reproduced" : "Confirmed") + '</span></div>' +
        '<dl><dt>Evidence</dt><dd>' + esc(f.evidence) + '</dd><dt>Impact</dt><dd>' + esc(f.impact) + '</dd><dt>Fix</dt><dd>' + esc(f.fix) + '</dd></dl></div>').join("") + '</div>' +
      '<h2>Request log</h2><div class="card scroll"><table><thead><tr><th>Time</th><th>Request</th><th>Status</th><th>Key response headers</th></tr></thead><tbody>' + d.log.map(l =>
        '<tr><td>' + esc(new Date(l.at).toLocaleTimeString()) + '<br><span class="meta">' + l.ms + ' ms</span></td><td>' + esc(l.label) + '<br><code>' + esc(l.method) + ' ' + esc(l.url.replace(/(\/(?:listen|download)\/\d+\/)([^/]{12})[^/]*/, "$1$2…")) + '</code></td><td>' + l.status + '</td><td>' +
        Object.entries(l.headers).map(([k, v]) => '<code>' + esc(k) + ': ' + esc(v) + '</code>').join("<br>") + '</td></tr>').join("") + '</tbody></table></div>' +
      '<h2>robots.txt</h2><div class="card"><pre>' + esc(d.robots.text) + '</pre></div>' +
      '<h2>Songs on the homepage (first 5)</h2><div class="card"><table><tbody>' + d.items.map(i => '<tr><td>#' + esc(i.id) + '</td><td>' + esc(i.name) + '</td></tr>').join("") + '</tbody></table></div>';
  } catch (e) { meta.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
  finally { btn.disabled = false; }
}
btn.onclick = run;
</script></body></html>`;

createServer(async (req, res) => {
  if (req.url === "/api/check") {
    try { const body = JSON.stringify(await runChecks()); res.writeHead(200, { "Content-Type": "application/json" }).end(body); }
    catch (e) { res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === "/" || req.url === "/index.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page); return; }
  res.writeHead(404).end("Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`MP3.pm findings checker on http://localhost:${PORT}`));
