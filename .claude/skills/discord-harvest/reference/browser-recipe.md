# Driving Discord in Chrome — the parts that actually work

Every snippet below is run with `mcp__claude-in-chrome__javascript_tool` against the
tab showing the channel. They are written to be pasted in order.

Discord's DOM classes are hashed (`filenameLinkWrapper__0ccae`) and change between
releases, so every selector here matches on a substring or on a stable `id`
prefix (`message-content-<snowflake>`), never on a full class name.

---

## 0. Focus the window first

The clipboard step at the end needs `document.hasFocus()`, and screenshots time
out against a backgrounded tab. Raise Chrome from Bash before you start:

```bash
osascript -e 'tell application "Google Chrome"
  activate
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      if URL of t contains "<CHANNEL_ID>" then
        set active tab index of w to i
        set index of w to 1
      end if
    end repeat
  end repeat
end tell'
```

---

## 1. Enumerate with search, not by scrolling

Click the server search box, type `has:file in:<channel-name>`, press Return once
to accept the channel from the autocomplete, then Return again to search.

The result header gives an **exact** count ("430 Results") and the dock at the
bottom gives page count. That number is the ground truth to verify against later.

---

## 2. Harvester + pagination

```js
window.__res = window.__res || {};
window.__panel = () =>
  document.querySelector('[class*="searchResultsWrapper"]') ||
  document.querySelector('#search-results');

window.__grab = function () {
  const panel = window.__panel();
  if (!panel) return 0;
  let n = 0;
  for (const contentEl of panel.querySelectorAll('[id^="message-content-"]')) {
    const id = contentEl.id.replace('message-content-', '');
    if (window.__res[id]) continue;
    const title = contentEl.innerText.replace(/\s+/g, ' ').trim();

    // walk up until we reach the node that also holds the attachment chrome
    let box = contentEl.parentElement;
    for (let i = 0; i < 6 && box && !box.querySelector('[class*="filenameLinkWrapper"]'); i++)
      box = box.parentElement;

    const atts = [];
    if (box) for (const w of box.querySelectorAll('[class*="filenameLinkWrapper"]')) {
      const ab = w.closest('[class*="attachment"]') || w.parentElement?.parentElement || w;
      const m = ab.innerText.replace(/\s+/g, ' ')
        .match(/([^\s]+\.(?:zip|rar|7z|txt|js|html|css|mp4))\s*([\d.]+\s*[KMG]B)?/i);
      if (m) atts.push({ file: m[1], size: m[2] || null });
    }

    // snowflake -> UTC timestamp; no API call needed
    const ts = new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
    window.__res[id] = { id, ts, title, atts };
    n++;
  }
  return n;
};

window.__sleep = ms => new Promise(r => setTimeout(r, ms));
window.__pageBtn = label => [...document.querySelectorAll('[class*="paginationDock"] button')]
  .find(b => new RegExp(`^${label}$`, 'i').test(b.innerText.trim()) && !b.disabled) || null;

// Walks in whichever direction is available. Search lists newest-first, so
// "Next" descends toward the oldest post.
window.__walk = async function (label, pages = 25) {
  window.__grab();
  for (let i = 0; i < pages; i++) {
    const btn = window.__pageBtn(label);
    if (!btn) break;
    const before = window.__panel().querySelector('[id^="message-content-"]')?.id;
    btn.click();
    let waited = 0;
    while (waited < 8000) {
      await window.__sleep(250); waited += 250;
      const now = window.__panel()?.querySelector('[id^="message-content-"]')?.id;
      if (now && now !== before) break;
    }
    await window.__sleep(400);
    window.__grab();
  }
  return Object.keys(window.__res).length;
};
```

`Runtime.evaluate` is killed at 45 s, and a full walk takes longer than that.
Fire it without awaiting, then poll in separate calls:

```js
window.__walkDone = false;
window.__walk('Next', 25).then(n => { window.__walkDone = n; });
'started'
```

```js
// poll
JSON.stringify({ n: Object.keys(window.__res).length, done: window.__walkDone })
```

The `.click()` on a pagination button **does** work. Programmatic scrolling does
not — see the traps in SKILL.md.

---

## 3. Collect archive URLs

The first `cdn.discordapp.com` anchor inside a result is the **preview image**.
Requiring an archive extension in the URL *pathname* is what makes this correct:

```js
window.__hrefFor = function (contentEl) {
  let box = contentEl.parentElement;
  for (let i = 0; i < 7 && box; i++) {
    const zip = [...box.querySelectorAll('a[href*="cdn.discordapp.com/attachments"]')]
      .find(a => { try { return /\.(zip|rar|7z)$/i.test(new URL(a.href).pathname); }
                   catch { return false; } });
    if (zip) return zip.href;
    box = box.parentElement;
  }
  return null;
};

window.__urls = window.__urls || {};
window.__collectPage = function () {
  let n = 0;
  for (const el of window.__panel().querySelectorAll('[id^="message-content-"]')) {
    const id = el.id.replace('message-content-', '');
    if (window.__urls[id]) continue;
    const url = window.__hrefFor(el);
    if (url) { window.__urls[id] = { id, ...window.__map[id], url }; n++; }
  }
  return n;
};
```

Build `window.__map` first — `{ [id]: { n, name } }`, where `name` is the
zero-padded slug filename. Then walk the pages again calling `__collectPage()`
in place of `__grab()`.

Sanity-check before exporting:

```js
const rows = Object.values(window.__urls).sort((a, b) => a.n - b.n);
JSON.stringify({
  rows: rows.length,
  bad: rows.filter(r => !r.n || !r.name || !r.url).length,
  dupeNames: rows.length - new Set(rows.map(r => r.name)).size,
  nonArchive: rows.filter(r => !/\.(zip|rar|7z)$/i.test(new URL(r.url).pathname)).length,
})
```

All three counters must be `0` and `rows` must equal the search header count.

---

## 4. Export via the clipboard

```js
const rows = Object.values(window.__urls).sort((a, b) => a.n - b.n);
const text = rows.map(r => r.name + '\t' + r.url).join('\n');
await navigator.clipboard.writeText(text);   // needs the window focused (step 0)
JSON.stringify({ rows: rows.length, chars: text.length })
```

```bash
pbpaste > ~/Downloads/<slug>-urls.tsv
awk -F'\t' 'NF==2' ~/Downloads/<slug>-urls.tsv | wc -l   # must equal the count
```

Do not try to return the URLs through the transcript — signed CDN links carry
query strings and the harness blocks them, which is the correct behaviour and
must not be worked around by encoding them.
