/* ===================================================
   popup.js — Multi-bookmark manager + "selectDE" trigger
   Editor state persists across popup open/close.
   Recording mode for capturing tree clicks.
   =================================================== */

const DEFAULT_BOOKMARKS = [];

const bookmarkListEl = document.getElementById('bookmark-list');
const btnAddBookmark = document.getElementById('btn-add-bookmark');
const settingsPanel = document.getElementById('settings-panel');
const folderListEl = document.getElementById('folder-list');
const inputName = document.getElementById('input-name');
const inputDE = document.getElementById('input-de');
const btnSave = document.getElementById('btn-save');
const btnCancel = document.getElementById('btn-cancel');
const btnAddFolder = document.getElementById('btn-add-folder');
const btnRecord = document.getElementById('btn-record');
const btnStopRecord = document.getElementById('btn-stop-record');
const recordBanner = document.getElementById('record-banner');
const recordStatusText = document.getElementById('record-status-text');
const statusEl = document.getElementById('status');

let _editingId = null;

// ── Storage helpers ──────────────────────────────────
function loadBookmarks() {
    return new Promise((resolve) => {
        chrome.storage.local.get('sfmcBookmarks', (data) => {
            resolve(data.sfmcBookmarks || DEFAULT_BOOKMARKS);
        });
    });
}

function saveBookmarks(bookmarks) {
    return new Promise((resolve) => {
        chrome.storage.local.set({sfmcBookmarks: bookmarks}, resolve);
    });
}

// ── Editor state persistence ─────────────────────────
function saveEditorState() {
    const inputs = folderListEl.querySelectorAll('.folder-input');
    const folderPath = Array.from(inputs).map((i) => i.value);
    const state = {
        open: settingsPanel.style.display !== 'none',
        editingId: _editingId,
        name: inputName.value,
        folderPath,
        targetDE: inputDE.value,
    };
    chrome.storage.local.set({sfmcEditorState: state});
}

function clearEditorState() {
    chrome.storage.local.remove('sfmcEditorState');
}

function loadEditorState() {
    return new Promise((resolve) => {
        chrome.storage.local.get('sfmcEditorState', (data) => {
            resolve(data.sfmcEditorState || null);
        });
    });
}

function loadRecordingState() {
    return new Promise((resolve) => {
        chrome.storage.local.get('sfmcRecording', (data) => {
            resolve(data.sfmcRecording || null);
        });
    });
}

// ── Render bookmark cards ────────────────────────────
function renderBookmarks(bookmarks) {
    bookmarkListEl.innerHTML = '';
    if (bookmarks.length === 0) {
        bookmarkListEl.innerHTML =
            '<p class="empty-hint">No bookmarks yet. Add one below.</p>';
        return;
    }
    bookmarks.forEach((bm) => {
        const card = document.createElement('div');
        card.className = 'bookmark-card';

        const info = document.createElement('div');
        info.className = 'bookmark-info';
        info.innerHTML =
            `<span class="bookmark-name">${escapeHtml(bm.name)}</span>` +
            `<span class="bookmark-path">${escapeHtml(bm.folderPath.join(' > '))}${bm.targetDE ? ' → ' + escapeHtml(bm.targetDE) : ''}</span>`;

        const actions = document.createElement('div');
        actions.className = 'bookmark-actions';

        const btnRun = document.createElement('button');
        btnRun.className = 'btn-run-bookmark';
        btnRun.textContent = '▶ Run';
        btnRun.title = 'Select this DE';
        btnRun.addEventListener('click', () =>
            runBookmark({folderPath: bm.folderPath, targetDE: bm.targetDE}),
        );

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-edit-bookmark';
        btnEdit.textContent = '✎';
        btnEdit.title = 'Edit';
        btnEdit.addEventListener('click', () => openEditor(bm));

        const btnDel = document.createElement('button');
        btnDel.className = 'btn-delete-bookmark';
        btnDel.textContent = '×';
        btnDel.title = 'Delete';
        btnDel.addEventListener('click', () => deleteBookmark(bm.id));

        actions.appendChild(btnRun);
        actions.appendChild(btnEdit);
        actions.appendChild(btnDel);
        card.appendChild(info);
        card.appendChild(actions);
        bookmarkListEl.appendChild(card);
    });
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ── Editor ───────────────────────────────────────────
function addFolderRow(value) {
    const row = document.createElement('div');
    row.className = 'folder-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input-field folder-input';
    input.value = value || '';
    input.placeholder = 'Folder name (exact match)';
    input.addEventListener('input', saveEditorState);

    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn-remove';
    btnRemove.textContent = '×';
    btnRemove.title = 'Remove this folder';
    btnRemove.addEventListener('click', () => {
        row.remove();
        saveEditorState();
    });

    row.appendChild(input);
    row.appendChild(btnRemove);
    folderListEl.appendChild(row);
}

function openEditor(bm) {
    _editingId = bm ? bm.id : null;
    folderListEl.innerHTML = '';
    if (bm) {
        inputName.value = bm.name || '';
        bm.folderPath.forEach((f) => addFolderRow(f));
        inputDE.value = bm.targetDE || '';
    } else {
        inputName.value = '';
        addFolderRow('');
        inputDE.value = '';
    }
    btnAddBookmark.style.display = 'none';
    settingsPanel.style.display = 'block';
    recordBanner.style.display = 'none';
    saveEditorState();
}

function closeEditor() {
    _editingId = null;
    settingsPanel.style.display = 'none';
    btnAddBookmark.style.display = 'block';
    recordBanner.style.display = 'none';
    clearEditorState();
}

// ── Recording ────────────────────────────────────────
function showRecordingBanner(rec) {
    const count = rec.folderPath?.length || 0;
    const de = rec.selectedDE;
    let text = 'Recording… ';
    if (count > 0) {
        text += `${count} folder${count > 1 ? 's' : ''}`;
    }
    if (de) {
        text += (count > 0 ? ' + ' : '') + `DE "${de}"`;
    }
    if (count === 0 && !de) {
        text += 'click folders then a DE on the page.';
    }
    recordStatusText.textContent = text;
    recordBanner.style.display = 'flex';
}

async function startRecording() {
    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (!tab) {
            showStatus('No active tab found.', 'error');
            return;
        }

        chrome.tabs.sendMessage(
            tab.id,
            {action: 'startRecording'},
            (response) => {
                if (chrome.runtime.lastError) {
                    // Intentionally consumed — suppresses console warning
                    // from non-panel frames that don't respond (all_frames: true)
                    if (!response?.ack) {
                        showStatus(
                            'Content script not found. Are you on an SFMC page?',
                            'error',
                        );
                        return;
                    }
                }
                if (response?.ack) {
                    showRecordingBanner({folderPath: [], selectedDE: null});
                    showStatus(
                        'Recording started! Click away to navigate, then re-open to stop.',
                        'success',
                    );
                } else {
                    showStatus(
                        'Could not start — is Preview and Test open?',
                        'error',
                    );
                }
            },
        );
    } catch (err) {
        showStatus('Error: ' + err.message, 'error');
    }
}

async function stopRecording() {
    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {action: 'stopRecording'});
        }
    } catch (_) {
        // Best-effort stop
    }

    const rec = await loadRecordingState();
    recordBanner.style.display = 'none';

    if (rec && (rec.folderPath?.length > 0 || rec.selectedDE)) {
        // Fill the editor with recorded data
        folderListEl.innerHTML = '';
        (rec.folderPath || []).forEach((f) => addFolderRow(f));
        if (rec.selectedDE) {
            inputDE.value = rec.selectedDE;
        }
        saveEditorState();
        showStatus(
            `Recorded ${rec.folderPath?.length || 0} folders` +
                (rec.selectedDE ? ` + DE "${rec.selectedDE}"` : '') +
                '. Review and save!',
            'success',
        );
    } else {
        showStatus('Nothing was recorded.', 'error');
    }

    // Clear recording data
    chrome.storage.local.remove('sfmcRecording');
}

// ── Delete ───────────────────────────────────────────
async function deleteBookmark(id) {
    const bookmarks = await loadBookmarks();
    const updated = bookmarks.filter((b) => b.id !== id);
    await saveBookmarks(updated);
    renderBookmarks(updated);
    showStatus('Bookmark deleted.', 'success');
}

// ── Run ──────────────────────────────────────────────
async function runBookmark(config) {
    showStatus('Sending command…', 'info');

    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });

        if (!tab) {
            showStatus('No active tab found.', 'error');
            return;
        }

        chrome.tabs.sendMessage(
            tab.id,
            {action: 'selectDE', config},
            (response) => {
                if (chrome.runtime.lastError) {
                    // Intentionally consumed — suppresses console warning
                    // from non-panel frames that don't respond (all_frames: true)
                    if (!response?.ack) {
                        showStatus(
                            'Content script not found. Are you on an SFMC page?',
                            'error',
                        );
                        console.error(
                            '[popup]',
                            chrome.runtime.lastError.message,
                        );
                        return;
                    }
                }

                if (response && response.ack) {
                    showStatus(
                        'Running — check the browser console (F12) for progress.',
                        'success',
                    );
                } else {
                    showStatus(
                        'Error: ' + (response?.error || 'unknown'),
                        'error',
                    );
                }
            },
        );
    } catch (err) {
        showStatus('Error: ' + err.message, 'error');
        console.error('[popup]', err);
    }
}

// ── Status ───────────────────────────────────────────
function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    if (type === 'success') {
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status';
        }, 4000);
    }
}

// ── Init (restore editor + check recording state) ────
async function init() {
    const bookmarks = await loadBookmarks();
    renderBookmarks(bookmarks);

    const editorState = await loadEditorState();
    if (editorState && editorState.open) {
        _editingId = editorState.editingId;
        inputName.value = editorState.name || '';
        folderListEl.innerHTML = '';
        (editorState.folderPath || ['']).forEach((f) => addFolderRow(f));
        inputDE.value = editorState.targetDE || '';
        btnAddBookmark.style.display = 'none';
        settingsPanel.style.display = 'block';
    }

    // Check if recording is active — show banner with progress
    const rec = await loadRecordingState();
    if (rec && rec.active) {
        // Make sure editor is open
        if (settingsPanel.style.display === 'none') {
            btnAddBookmark.style.display = 'none';
            settingsPanel.style.display = 'block';
        }
        showRecordingBanner(rec);
    }
}
init();

// ── Events ───────────────────────────────────────────
btnAddBookmark.addEventListener('click', () => openEditor(null));

btnAddFolder.addEventListener('click', () => {
    addFolderRow('');
    saveEditorState();
});

btnRecord.addEventListener('click', () => startRecording());
btnStopRecord.addEventListener('click', () => stopRecording());

inputName.addEventListener('input', saveEditorState);
inputDE.addEventListener('input', saveEditorState);

btnCancel.addEventListener('click', () => {
    // Also stop recording if active
    chrome.storage.local.remove('sfmcRecording');
    chrome.tabs
        .query({active: true, currentWindow: true})
        .then(([tab]) => {
            if (tab) chrome.tabs.sendMessage(tab.id, {action: 'stopRecording'});
        })
        .catch(() => {});
    closeEditor();
});

btnSave.addEventListener('click', async () => {
    const name = inputName.value.trim();
    const inputs = folderListEl.querySelectorAll('.folder-input');
    const folderPath = Array.from(inputs)
        .map((i) => i.value.trim())
        .filter(Boolean);
    const targetDE = inputDE.value.trim();

    if (!name) {
        showStatus('Enter a bookmark name.', 'error');
        return;
    }
    if (folderPath.length === 0 && !targetDE) {
        showStatus('Add at least one folder or a target DE.', 'error');
        return;
    }

    const bookmarks = await loadBookmarks();

    if (_editingId !== null) {
        const idx = bookmarks.findIndex((b) => b.id === _editingId);
        if (idx !== -1) {
            bookmarks[idx] = {...bookmarks[idx], name, folderPath, targetDE};
        }
    } else {
        const maxId = bookmarks.reduce((m, b) => Math.max(m, b.id), 0);
        bookmarks.push({id: maxId + 1, name, folderPath, targetDE});
    }

    await saveBookmarks(bookmarks);
    renderBookmarks(bookmarks);
    closeEditor();
    showStatus('Bookmark saved!', 'success');
});
