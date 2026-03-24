/* ── CONNECT ── */
import { log } from './utils.js';
import { browseTo, currentPath } from './filesystem.js';

const $       = id => document.getElementById(id);
const ip      = () => $('ipInput').value.trim();
const port    = () => $('portInput').value.trim();
const connBtn = $('connectBtn');

/* ── PERSISTENT SETTINGS ── */
const savedSettings = 'ftpSettings';

function saveSettings() {
    localStorage.setItem(savedSettings, JSON.stringify({ ip: ip(), port: port() }));
}

function loadSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem(savedSettings));
        if (settings) {
            if (settings.ip) $('ipInput').value = settings.ip;
            if (settings.port) $('portInput').value = settings.port;
        }
    } catch { /* ignore */ }
}

function setStatus(state) {
    const isConn   = state === 'connected';
    const isTrying = state === 'trying';
    connBtn.classList.toggle('disconnect', isConn);
    connBtn.textContent = isTrying ? 'Connecting...' : isConn ? 'Disconnect' : 'Connect';
    connBtn.disabled    = isTrying;
    $('statusDot').classList.toggle('connected', isConn);
    $('statusText').textContent = isTrying ? 'trying to connect...' : isConn ? 'connected' : 'not connected';
}

export async function getStatus() {
    try { return (await (await fetch('/api/status')).json()).connected; }
    catch { return false; }
}

export async function tryConnect() {
    if (await getStatus()) { await disconnect(); return; }

    setStatus('trying');
    log(`Trying connect to: ${ip()}:${port()}`);

    try {
        const data = await (await fetch('/api/connect', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ip: ip(), port: port() })
        })).json();

        if (data.success) {
            saveSettings();
            setStatus('connected');
            browseTo('/');
            log(`Connected to ${ip()}:${port()}`);
        } else {
            setStatus('off');
            log('Connection failed: ' + data.error);
        }
    } catch (err) {
        setStatus('off');
        log('Error: ' + err.message);
    }
}

export async function disconnect() {
    try {
        await fetch('/api/disconnect', { method: 'POST' });
        setStatus('off');
        $('fsList').innerHTML = '';
    } catch (err) { log('Error: ' + err.message); }
    log('Disconnected');
}

/* ── INIT ── */
loadSettings();
getStatus().then(ok => { setStatus(ok ? 'connected' : 'off'); if (ok) browseTo(currentPath); });
connBtn.addEventListener('click', tryConnect);