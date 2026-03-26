/*  content.js — SFMC DE Selector v3 (audit-clean, minimal)
    User-triggered only. No network calls.
    Config stored in chrome.storage.local.
    Only touches elements inside the SFMC preview panel.        */

const TAG = '[SFMC-DE]';
let _busy = false;
let _recording = false;
let _recordHandler = null;

// ── Helpers ──────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
}

function safeClick(el) {
    if (!el) return;
    // Guard against <a> navigation — no DOM mutation, just preventDefault
    const a = el.tagName === 'A' ? el : el.closest('a');
    if (a) a.addEventListener('click', (e) => e.preventDefault(), {once: true});
    el.click();
}

// ── Finders ──────────────────────────────────────────
function findPanel() {
    const p = document.querySelector('.content-preview.content-panel.active');
    return p && isVisible(p) ? p : null;
}

function findFolder(panel, name) {
    const t = norm(name);
    for (const btn of panel.querySelectorAll('button.tree-branch-name')) {
        // Ensure the button is inside a tree-branch (folder) node, not a leaf
        const item = btn.closest('[role="treeitem"]');
        if (!item) continue;
        const isBranch =
            item.classList.contains('tree-branch') ||
            item.hasAttribute('aria-expanded');
        if (!isBranch) continue;
        if (norm(btn.textContent) === t && isVisible(btn)) return btn;
    }
    return null;
}

function findDE(panel, name) {
    const t = norm(name);
    const sels =
        '.tree-leaf-name, .tree-leaf button, .tree-leaf span, ' +
        '[role="treeitem"]:not(.tree-branch) button, ' +
        '[role="treeitem"]:not(.tree-branch) span';
    for (const el of panel.querySelectorAll(sels)) {
        const txt = norm(el.textContent);
        if (txt === t && txt.length <= t.length * 3 && isVisible(el)) return el;
    }
    return null;
}

function clickLoadMore(panel) {
    for (const el of panel.querySelectorAll('button, a, span, div')) {
        const t = norm(el.textContent);
        if (t.length <= 30 && t.includes('load more') && isVisible(el)) {
            console.log(`${TAG} Clicking "Load More"`);
            safeClick(el);
            return true;
        }
    }
    return false;
}

// ── Main flow ────────────────────────────────────────
async function selectDE(config) {
    const folderPath = config.folderPath || [];
    const targetDE = config.targetDE || '';
    console.log(
        `${TAG} Start: ${folderPath.join(' > ')}${targetDE ? ' → ' + targetDE : ''}`,
    );

    // Step 1: find preview panel
    let panel = null;
    for (let i = 0; i < 5 && !panel; i++) {
        panel = findPanel();
        if (!panel) await sleep(500);
    }
    if (!panel) {
        console.error(
            `${TAG} Preview panel not found. Is "Preview and Test" open?`,
        );
        return {success: false, error: 'Preview panel not found'};
    }
    console.log(`${TAG} Preview panel found.`);

    // Step 2: open each folder
    for (const folderName of folderPath) {
        console.log(`${TAG} Opening "${folderName}"…`);
        let el = null;
        for (let a = 0; a < 20 && !el; a++) {
            el = findFolder(panel, folderName);
            if (!el && clickLoadMore(panel)) {
                await sleep(1500);
                continue;
            }
            if (!el) await sleep(800);
        }
        if (!el) {
            console.error(`${TAG} Folder "${folderName}" not found.`);
            return {success: false, error: `Folder not found: ${folderName}`};
        }
        const item = el.closest('[role="treeitem"]');
        if (item?.getAttribute('aria-expanded') !== 'true') {
            safeClick(el);
            await sleep(1200);
            if (item?.getAttribute('aria-expanded') !== 'true') {
                safeClick(el);
                await sleep(1500);
            }
        }
        console.log(`${TAG} ✓ "${folderName}" expanded.`);
    }

    // Step 3: select the DE (optional)
    if (targetDE) {
        console.log(`${TAG} Looking for DE "${targetDE}"…`);
        let de = null;
        for (let a = 0; a < 20 && !de; a++) {
            de = findDE(panel, targetDE);
            if (!de && clickLoadMore(panel)) {
                await sleep(1500);
                continue;
            }
            if (!de) await sleep(800);
        }
        if (!de) {
            console.error(`${TAG} DE "${targetDE}" not found.`);
            return {success: false, error: `DE not found: ${targetDE}`};
        }
        console.log(`${TAG} ✓ Selecting "${targetDE}".`);
        safeClick(de);
    }
    console.log(`${TAG} Done.`);
    return {success: true};
}

// ── Recording mode ───────────────────────────────────
// Listens for clicks on tree nodes and saves them to storage.
// Recording state persists in chrome.storage.local so the popup
// (which closes on click-away) can read what was recorded.

function startRecording() {
    if (_recording) return;
    _recording = true;

    // Clear previous recorded data
    chrome.storage.local.set({
        sfmcRecording: {active: true, folderPath: [], selectedDE: null},
    });

    console.log(`${TAG} Recording started — click folders then a DE.`);

    _recordHandler = (e) => {
        const panel = findPanel();
        if (!panel) return;

        // Pre-check: walk up from the actual click target to catch
        // "Load More" BEFORE closest() can latch onto a parent tree node.
        let walk = e.target;
        for (let i = 0; i < 6 && walk && walk !== panel; i++) {
            const txt = (walk.textContent || '').trim();
            if (txt.length < 50 && /load\s*more/i.test(txt)) {
                console.log(`${TAG} Ignoring "Load More" click`);
                return;
            }
            walk = walk.parentElement;
        }

        // Find the closest tree-item button or name the user clicked
        const clicked = e.target.closest(
            'button.tree-branch-name, .tree-leaf-name, .tree-leaf button, ' +
                '[role="treeitem"] button, [role="treeitem"] span',
        );
        if (!clicked || !panel.contains(clicked)) return;

        const name = (clicked.textContent || '').trim().replace(/\s+/g, ' ');
        if (!name) return;

        // Secondary guard: skip if "Load More" leaked through anyway
        if (/load\s*more/i.test(name)) {
            console.log(`${TAG} Ignoring "Load More" (secondary)`);
            return;
        }

        // Determine if it's a folder (branch) or a leaf (DE)
        const item = clicked.closest('[role="treeitem"]');
        const isBranch =
            item &&
            (item.classList.contains('tree-branch') ||
                item.hasAttribute('aria-expanded') ||
                clicked.matches('button.tree-branch-name'));

        const isLeaf =
            item &&
            (item.classList.contains('tree-leaf') ||
                clicked.matches(
                    '.tree-leaf-name, .tree-leaf button, .tree-leaf span',
                ));

        // If the click isn't a confirmed branch or leaf, ignore it
        if (!isBranch && !isLeaf) {
            console.log(
                `${TAG} Ignoring click — not a tree branch or leaf: "${name}"`,
            );
            return;
        }

        chrome.storage.local.get('sfmcRecording', (data) => {
            const rec = data.sfmcRecording || {
                active: true,
                folderPath: [],
                selectedDE: null,
            };
            if (isBranch) {
                rec.folderPath.push(name);
                console.log(`${TAG} Recorded folder: "${name}"`);
            } else {
                rec.selectedDE = name;
                console.log(`${TAG} Recorded DE: "${name}"`);
            }
            chrome.storage.local.set({sfmcRecording: rec});
        });
    };

    // Use capture phase so we see the click before the tree widget handles it
    document.addEventListener('click', _recordHandler, true);
}

function stopRecording() {
    if (!_recording) return;
    _recording = false;
    if (_recordHandler) {
        document.removeEventListener('click', _recordHandler, true);
        _recordHandler = null;
    }
    // Mark recording as inactive but keep the data
    chrome.storage.local.get('sfmcRecording', (data) => {
        const rec = data.sfmcRecording || {folderPath: [], selectedDE: null};
        rec.active = false;
        chrome.storage.local.set({sfmcRecording: rec});
    });
    console.log(`${TAG} Recording stopped.`);
}

// On load, resume recording if it was active (e.g. page navigated)
chrome.storage.local.get('sfmcRecording', (data) => {
    if (data.sfmcRecording?.active && findPanel()) {
        startRecording();
    }
});

// ── Message listener (silent bail in wrong frames) ───
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Recording controls — respond from the frame that has the panel
    if (msg.action === 'startRecording') {
        if (!findPanel()) return;
        startRecording();
        sendResponse({ack: true});
        return;
    }
    if (msg.action === 'stopRecording') {
        if (!findPanel()) return;
        stopRecording();
        sendResponse({ack: true});
        return;
    }

    if (msg.action !== 'selectDE') return;
    // Don't respond from frames without the panel — let the correct frame respond
    if (!findPanel()) return;
    if (_busy) return void sendResponse({ack: false, error: 'Already running'});

    const config = msg.config;
    if (!config || (!config.folderPath && !config.targetDE)) {
        return void sendResponse({ack: false, error: 'No config provided'});
    }

    _busy = true;
    sendResponse({ack: true});
    selectDE(config)
        .then((r) => {
            _busy = false;
            console.log(
                `${TAG} ${r.success ? 'Success.' : 'Failed: ' + r.error}`,
            );
        })
        .catch((e) => {
            _busy = false;
            console.error(`${TAG} Error:`, e);
        });
});
