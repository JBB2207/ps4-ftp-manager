/* ── PS4 FILESYSTEM ── */
import { log } from './utils.js';
import { setDestAll } from './upload.js';

const $           = id => document.getElementById(id);
const contextMenu = $('contextMenu');
const filesystem  = $('fsList');

export let currentPath = '/';
let lastSelected = null;
let clipboard    = [];
let clipMode     = 'copy';

/* ── HELPERS ── */
const joinPath  = (base, name) => (base.endsWith('/') ? base : base + '/') + name;
const getSelected = () => [...document.querySelectorAll('.fs-row.selected')];
const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.json());

/* ── CONTEXT MENU ── */
filesystem.addEventListener('contextmenu', e => {
    e.preventDefault();
    const row = e.target.closest('.fs-row');
    if (row && !row.classList.contains('selected')) {
        document.querySelectorAll('.fs-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        lastSelected = row;
    }
    const x = Math.min(e.clientX, window.innerWidth  - contextMenu.offsetWidth  - 8);
    const y = Math.min(e.clientY, window.innerHeight - contextMenu.offsetHeight - 8);
    Object.assign(contextMenu.style, { left: x + 'px', top: y + 'px', display: 'block' });
});

document.addEventListener('click',   ()  => { contextMenu.style.display = 'none'; });
document.addEventListener('keydown',  e  => { if (e.key === 'Escape') contextMenu.style.display = 'none'; });

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const map = {
        'F2':      'menuRename',
        'F4':      'menuMkdir',
        'Delete':  'menuDelete',
    };
    if (map[e.key])                          { e.preventDefault(); $(map[e.key]).click(); return; }
    if (e.ctrlKey && e.key === 'x')          { e.preventDefault(); $('menuCut').click(); }
    if (e.ctrlKey && e.key === 'c')          { $('menuCopy').click(); }
    if (e.ctrlKey && e.key === 'v')          { e.preventDefault(); $('menuPaste').click(); }
});

/* ── DESELECT on outside click ── */
document.addEventListener('click', e => {
    if (!e.target.closest('.fs-row'))
        document.querySelectorAll('.fs-row').forEach(r => r.classList.remove('selected'));
});

/* ── RENAME ── */
$('menuRename').addEventListener('click', async () => {
    const row = lastSelected?.classList.contains('selected') ? lastSelected : null;
    if (!row) return;

    const nameSpan    = row.querySelector('.fs-name');
    const originalName = nameSpan.textContent.replace(/\/$/, '');
    const fullPath     = joinPath(currentPath, originalName);
    const ext          = originalName.includes('.') && !row.classList.contains('dir')
        ? '.' + originalName.split('.').pop() : '';

    const input = document.createElement('input');
    input.type = 'text'; input.className = 'fs-inline-input'; input.value = originalName;
    nameSpan.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, originalName.length - ext.length);

    async function commit() {
        const newName = input.value.trim();
        input.removeEventListener('blur', commit);
        if (!newName || newName === originalName) { input.replaceWith(nameSpan); return; }

        try {
            const data = await post('/api/rename', { oldPath: fullPath, newPath: joinPath(currentPath, newName) });
            if (data.success) { log(`Renamed: ${originalName} → ${newName}`); browseTo(currentPath); }
            else { log('Rename error: ' + data.error); input.replaceWith(nameSpan); }
        } catch (err) { log('Error: ' + err.message); input.replaceWith(nameSpan); }
    }

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { input.removeEventListener('blur', commit); commit(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); input.replaceWith(nameSpan); }
    });
    input.addEventListener('blur', commit);
});

/* ── MKDIR ── */
$('menuMkdir').addEventListener('click', async () => {
    const row = document.createElement('div');
    row.className = 'fs-row dir';
    row.innerHTML = `<div><span class="fs-icon">📁</span><input type="text" class="fs-inline-input" placeholder="folder name" /></div><div></div>`;
    document.querySelector('.fs-row.empty-state')?.remove();
    filesystem.prepend(row);

    const input = row.querySelector('input');
    input.focus();

    async function commit() {
        const name = input.value.trim();
        input.removeEventListener('blur', commit);
        if (!name) { row.remove(); checkEmpty(); return; }

        const names = new Set([...document.querySelectorAll('#fsList .fs-row.dir .fs-name')].map(el => el.textContent.replace(/\/$/, '')));
        let uName = name, n = 2;
        while (names.has(uName)) uName = `${name} (${n++})`;

        try {
            const data = await post('/api/mkdir', { path: joinPath(currentPath, uName) });
            if (data.success) { log(`Created folder: ${joinPath(currentPath, uName)}`); browseTo(currentPath); }
            else { log('Mkdir error: ' + data.error); row.remove(); }
        } catch (err) { log('Error: ' + err.message); row.remove(); }
    }

    const checkEmpty = () => {
        if (filesystem.children.length === 0)
            filesystem.innerHTML = '<div class="fs-row empty-state"><p>folder is empty</p></div>';
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { input.removeEventListener('blur', commit); commit(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); row.remove(); checkEmpty(); }
    });
    input.addEventListener('blur', commit);
});

/* ── COPY / CUT ── */
function clipboardGrab(mode) {
    const rows = getSelected();
    if (!rows.length) return;
    document.querySelectorAll('.fs-row.cut').forEach(r => r.classList.remove('cut'));
    clipMode  = mode;
    clipboard = rows.map(row => {
        const name  = row.querySelector('.fs-name').textContent.replace(/\/$/, '');
        const isDir = row.classList.contains('dir');
        if (mode === 'cut') row.classList.add('cut');
        return { name, isDir, fullPath: joinPath(currentPath, name) };
    });
    log(`${mode === 'cut' ? 'Cut' : 'Copied'} ${clipboard.length} item(s)${mode === 'cut' ? ' – paste to move' : ' to clipboard'}`);
}

$('menuCopy').addEventListener('click', () => clipboardGrab('copy'));
$('menuCut').addEventListener('click',  () => clipboardGrab('cut'));

/* ── PASTE ── */
$('menuPaste').addEventListener('click', async () => {
    if (!clipboard.length) { log('Clipboard is empty'); return; }

    for (const item of clipboard) {
        try {
            const data = await post('/api/copy', { srcPath: item.fullPath, destDir: currentPath, type: item.isDir ? 2 : 1 });
            if (!data.success) { log('Paste error: ' + data.error); continue; }
            log(`${clipMode === 'cut' ? 'Moved' : 'Pasted'}: ${item.name} → ${currentPath}`);

            if (clipMode === 'cut') {
                const del = await post('/api/delete', { path: item.fullPath, type: item.isDir ? 2 : 1 });
                if (!del.success) log('Delete source error: ' + del.error);
            }
        } catch (err) { log('Error: ' + err.message); }
    }

    if (clipMode === 'cut') {
        clipboard = [];
        document.querySelectorAll('.fs-row.cut').forEach(r => r.classList.remove('cut'));
    }
    browseTo(currentPath);
});

/* ── DELETE ── */
$('menuDelete').addEventListener('click', async () => {
    const items = getSelected().map(row => {
        const name = row.querySelector('.fs-name').textContent.replace(/\/$/, '');
        return { name, isDir: row.classList.contains('dir'), fullPath: joinPath(currentPath, name) };
    });
    if (!items.length) return;

    for (const item of items) {
        try {
            const data = await post('/api/delete', { path: item.fullPath, type: item.isDir ? 2 : 1 });
            if (data.success) log(`Deleted: ${item.fullPath}`);
            else log('Delete error: ' + data.error);
        } catch (err) { log('Error: ' + err.message); }
    }
    browseTo(currentPath);
});

/* ── PATH INPUT ── */
$('fsPathInput').addEventListener('keydown', e => { if (e.key === 'Enter') browseTo(e.target.value.trim()); });

/* ── BROWSE ── */
export async function browseTo(path) {
    try {
        const data = await (await fetch('/api/list?path=' + encodeURIComponent(path))).json();
        if (data.success) renderFiles(data.files, data.path);
        else log('Browse error: ' + data.error);
    } catch (err) { log('Error: ' + err.message); }
}

function renderFiles(files, path) {
    currentPath = path;
    $('fsPathInput').value = ':' + (path.endsWith('/') ? path : path + '/');
    filesystem.innerHTML   = '';

    if (!files.length) {
        filesystem.innerHTML = '<div class="fs-row empty-state"><p>folder is empty</p></div>';
        return;
    }

    [...files]
        .sort((a, b) => a.type !== b.type ? b.type - a.type : a.name.localeCompare(b.name))
        .forEach(f => {
            const isDir    = f.type === 2;
            const fullPath = joinPath(currentPath, f.name) + '/';
            const row      = document.createElement('div');
            row.className  = 'fs-row' + (isDir ? ' dir' : '');
            row.innerHTML  = `
                <div>
                    <span class="fs-icon">${isDir ? '📁' : '📄'}</span>
                    <span class="fs-name">${f.name}${isDir ? '/' : ''}</span>
                </div>
                <div>${isDir ? `<button class="use-path-btn" data-path="${fullPath.replace(/"/g, '&quot;')}">USE PATH</button>` : ''}</div>
            `;

            if (isDir) {
                row.querySelector('.use-path-btn').addEventListener('click', e => {
                    e.stopPropagation();
                    setDestAll(e.currentTarget.dataset.path);
                });
                row.addEventListener('dblclick', e => {
                    if (e.target.classList.contains('use-path-btn')) return;
                    browseTo(joinPath(currentPath, f.name));
                });
            }

            row.addEventListener('click', e => {
                if (e.target.classList.contains('use-path-btn')) return;
                if (!e.ctrlKey) document.querySelectorAll('.fs-row').forEach(r => r.classList.remove('selected'));
                row.classList.toggle('selected', !e.ctrlKey || !row.classList.contains('selected'));
                if (row.classList.contains('selected')) lastSelected = row;
            });

            filesystem.appendChild(row);
        });
}

export function upRow() {
    if (currentPath === '/') return;
    const parts = currentPath.replace(/\/$/, '').split('/');
    parts.pop();
    browseTo(parts.join('/') || '/');
}

/* ── INIT ── */
$('upRowBtn').addEventListener('click', upRow);
$('usePathBtn').addEventListener('click', () => setDestAll($('fsPathInput').value.replace(/^:/, '')));