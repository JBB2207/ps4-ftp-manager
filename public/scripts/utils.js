/* ── UTILS ── */
document.addEventListener('contextmenu', e => e.preventDefault());

export function log(message) {
    const el   = document.getElementById('logBody');
    const t    = new Date().toTimeString().slice(0, 8);
    const line = document.createElement('div');
    line.className = 'log';
    line.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${message}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

/* ── INIT ── */
document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('logBody').innerHTML = '';
});