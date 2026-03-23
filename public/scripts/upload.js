/* ── UPLOAD / FILE MANAGEMENT ── */
import { log } from './utils.js';
import { browseTo, currentPath } from './filesystem.js';

const $                = id => document.getElementById(id);
const dropZone         = $('dropZone');
const fileList         = $('fileList');
const selectAllCb      = $('selectAllCheckbox');
export const addedFiles = [];

/* ── SET DEST ── */
export function setDestAll(path) {
    const items = document.querySelectorAll('.file-item');
    if (!items.length) { log('No added files'); return; }
    const formatted = ':' + path;
    items.forEach(item => item.querySelector('#fileDesInput').value = formatted);
    log(`Destination set to ${formatted} for all files`);
}

/* ── ADD FILES ── */
$('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

export function addFiles(files) {
    [...files].forEach(file => {
        addedFiles.push(file);
        const displayName = file.name.length > 25 ? file.name.slice(0, 20) + '[...]' : file.name;

        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-header">
                <span title="${file.name}" class="file-name">${displayName}</span>
                <div>
                    <span class="file-size">${(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button class="remove-file-btn">✕</button>
                </div>
            </div>
            <div class="file-des">
                <span>DEST:</span>
                <input type="text" value=":/" id="fileDesInput">
                <button class="send-file-btn">SEND</button>
            </div>
            <div class="file-progress">
                <div class="progress-bar-track"><div class="progress-bar-fill"></div></div>
                <span class="progress-text">Idle</span>
            </div>
        `;
        item.querySelector('.remove-file-btn').addEventListener('click', e => { e.stopPropagation(); removeFile(item); });
        item.querySelector('.send-file-btn').onclick = e => { e.stopPropagation(); sendFiles(item); };
        item.addEventListener('click', () => { item.classList.toggle('selected'); syncCheckbox(); });
        fileList.appendChild(item);
        syncCheckbox();
    });
}

/* ── REMOVE FILES ── */
function removeFile(item) {
    const name = item.querySelector('.file-name').getAttribute('title') || item.querySelector('.file-name').textContent;
    const idx  = addedFiles.findIndex(f => f.name === name);
    if (idx !== -1) addedFiles.splice(idx, 1);
    item.remove();
    syncCheckbox();
}

export function removeSelected() {
    document.querySelectorAll('.file-item.selected').forEach(removeFile);
}

/* ── DRAG & DROP ── */
dropZone.addEventListener('dragover',  e  => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e  => { e.preventDefault(); dropZone.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });

/* ── SELECT ALL ── */
selectAllCb.addEventListener('change', function () {
    document.querySelectorAll('.file-item').forEach(item => item.classList.toggle('selected', this.checked));
});

function syncCheckbox() {
    const all   = document.querySelectorAll('.file-item');
    const every = [...all].every(i => i.classList.contains('selected'));
    const some  = [...all].some(i  => i.classList.contains('selected'));
    selectAllCb.checked       = all.length > 0 && every;
    selectAllCb.indeterminate = !every && some;
}

/* ── INIT ── */
$('browseBtn').addEventListener('click',        () => $('fileInput').click());
$('sendSelectedBtn').addEventListener('click',  () => sendFiles());
$('removeSelectedBtn').addEventListener('click', removeSelected);

/* ── SEND FILES ── */
export async function sendFiles(singleItem = null) {
    const items = singleItem
        ? [singleItem]
        : [...document.querySelectorAll('.file-item.selected')];

    if (!items.length) { log('No files selected'); return; }

    for (const item of items) {
        const nameEl     = item.querySelector('.file-name');
        const fileName   = nameEl.getAttribute('title') || nameEl.textContent;
        const remotePath = item.querySelector('#fileDesInput').value.replace(/^:/, '');
        const file       = addedFiles.find(f => f.name === fileName);
        if (!file) { log(`File not found: ${fileName}`); continue; }

        const fill      = item.querySelector('.progress-bar-fill');
        const txt       = item.querySelector('.progress-text');
        const btn       = item.querySelector('.send-file-btn');
        const uploadId  = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const abort     = new AbortController();

        const setSend = () => { btn.textContent = 'SEND'; btn.classList.remove('cancel-file-btn'); btn.onclick = e => { e.stopPropagation(); sendFiles(item); }; };
        btn.textContent = 'CANCEL';
        btn.classList.add('cancel-file-btn');
        btn.onclick = e => { e.stopPropagation(); abort.abort(); };

        await new Promise(resolve => {
            const es     = new EventSource(`/api/progress/${uploadId}`);
            const finish = () => { setSend(); es.close(); resolve(); };

            abort.signal.addEventListener('abort', () => {
                fill.style.width = '0%';
                fill.classList.replace('done', 'error') || fill.classList.add('error');
                txt.textContent = 'Cancelling...';
                fetch(`/api/cancel/${uploadId}`, { method: 'POST' }).finally(() => {
                    txt.textContent = 'Cancelled';
                    log(`${fileName}: cancelled`);
                    finish();
                });
            });

            es.onopen = () => {
                txt.textContent  = '0%';
                fill.style.width = '0%';
                fill.classList.remove('done', 'error');

                const fd = new FormData();
                fd.append('uploadId',   uploadId);
                fd.append('remotePath', remotePath);
                fd.append('fileSize',   file.size);
                fd.append('file',       file);
                log(`Sending ${fileName} → PS4`);
                fetch('/api/upload', { method: 'POST', body: fd, signal: abort.signal })
                    .catch(err => { if (!abort.signal.aborted) log(`${fileName}: ${err.message}`); });
            };

            es.onmessage = e => {
                if (abort.signal.aborted) return;
                const data = JSON.parse(e.data);
                if (data.error) {
                    txt.textContent = 'Error'; fill.style.width = '0%'; fill.classList.add('error');
                    log(`${fileName}: ${data.error}`); finish();
                } else if (data.done) {
                    fill.style.width = '100%'; fill.classList.add('done');
                    txt.textContent  = 'Sent'; log(`${fileName} sent`); finish();
                } else {
                    fill.style.width = (data.percent ?? 0) + '%';
                    txt.textContent  = (data.percent ?? 0) + '%';
                }
            };

            es.onerror = () => { if (!abort.signal.aborted) { txt.textContent = 'Error'; fill.classList.add('error'); finish(); } };
        });
    }

    browseTo(currentPath);
}