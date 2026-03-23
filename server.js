const express = require('express');
const ftp     = require('basic-ftp');
const busboy  = require('busboy');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app = express();
app.use(express.json());
app.use(express.static('./public'));

let uploadClient = null, browseClient = null, editClient = null;
let isConnected  = false, connHost = '', connPort = 21;

const activeUploads   = new Map();
const progressClients = new Map();

/* ── HELPERS ── */
const mkClient = async (ip, port) => {
    const c = new ftp.Client(0);
    await c.access({ host: ip, port: +port, user: '', password: '', secure: false });
    return c;
};

const uniqueName = async (client, dir, name) => {
    const names = new Set((await client.list(dir)).map(f => f.name));
    if (!names.has(name)) return name;
    const ext = path.extname(name), base = path.basename(name, ext);
    let n = 2;
    while (names.has(`${base} (${n})${ext}`)) n++;
    return `${base} (${n})${ext}`;
};

const reconnect = () => mkClient(connHost, connPort).then(c => uploadClient = c);

const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (err) { res.json({ success: false, error: err.message }); }
};

const pushProgress = (id, payload) =>
    progressClients.get(id)?.write(`data: ${JSON.stringify(payload)}\n\n`);

/* ── CONNECT ── */
app.post('/api/connect', wrap(async (req, res) => {
    const { ip, port } = req.body;
    [uploadClient, browseClient, editClient] = await Promise.all([
        mkClient(ip, port), mkClient(ip, port), mkClient(ip, port)
    ]);
    isConnected = true; connHost = ip; connPort = +port;
    res.json({ success: true });
}));

app.post('/api/disconnect', (req, res) => {
    uploadClient = browseClient = editClient = null;
    isConnected = false;
    res.json({ success: true });
});

app.get('/api/status', (_, res) => res.json({ connected: isConnected }));

/* ── FILESYSTEM ── */
app.get('/api/list', wrap(async (req, res) => {
    const p = req.query.path || '/';
    const files = (await browseClient.list(p)).map(f => ({ name: f.name, type: f.type }));
    res.json({ success: true, files, path: p });
}));

app.post('/api/mkdir',  wrap(async (req, res) => { await editClient.ensureDir(req.body.path);                              res.json({ success: true }); }));
app.post('/api/rename', wrap(async (req, res) => { await editClient.rename(req.body.oldPath, req.body.newPath);            res.json({ success: true }); }));
app.post('/api/delete', wrap(async (req, res) => {
    req.body.type === 2
        ? await editClient.removeDir(req.body.path)
        : await editClient.remove(req.body.path);
    res.json({ success: true });
}));

app.post('/api/copy', wrap(async (req, res) => {
    const { srcPath, destDir, type } = req.body;
    const safeName = await uniqueName(editClient, destDir, path.basename(srcPath));
    const destPath = path.posix.join(destDir, safeName);
    const tmp      = path.join(os.tmpdir(), `ftpcopy-${Date.now()}`);

    if (type === 2) {
        await editClient.downloadToDir(tmp, srcPath);
        await editClient.uploadFromDir(tmp, destPath);
        fs.rmSync(tmp, { recursive: true, force: true });
    } else {
        const tmpFile = `${tmp}-${path.basename(srcPath)}`;
        await editClient.downloadTo(tmpFile, srcPath);
        await editClient.uploadFrom(tmpFile, destPath);
        fs.unlink(tmpFile, () => {});
    }
    res.json({ success: true });
}));

/* ── PROGRESS SSE ── */
app.get('/api/progress/:id', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
    progressClients.set(req.params.id, res);
    req.on('close', () => progressClients.delete(req.params.id));
});

/* ── CANCEL ── */
app.post('/api/cancel/:id', async (req, res) => {
    const remoteFile = activeUploads.get(req.params.id);
    activeUploads.delete(req.params.id);
    if (remoteFile) {
        try { const c = await mkClient(connHost, connPort); await c.remove(remoteFile); c.close(); } catch {}
    }
    reconnect().catch(() => {});
    res.json({ success: true });
});

/* ── UPLOAD ── */
app.post('/api/upload', (req, res) => {
    const bb     = busboy({ headers: req.headers });
    const fields = {};
    let responded = false;
    const respond = p => { if (!responded) { responded = true; res.json(p); } };

    bb.on('field', (k, v) => { fields[k] = v; });

    bb.on('file', async (_, stream, info) => {
        const { remotePath = '/', uploadId = '', fileSize = '0' } = fields;
        try {
            try { await uploadClient.pwd(); } catch { await reconnect(); }

            const safeName   = await uniqueName(uploadClient, remotePath, info.filename);
            const remoteFile = path.posix.join(remotePath, safeName);
            activeUploads.set(uploadId, remoteFile);

            uploadClient.trackProgress(({ bytes }) => {
                const pct = +fileSize > 0 ? Math.min(99, Math.round(bytes / +fileSize * 100)) : 0;
                pushProgress(uploadId, { percent: pct, bytes });
            });

            await uploadClient.uploadFrom(stream, remoteFile);
            activeUploads.delete(uploadId);
            uploadClient.trackProgress();
            pushProgress(uploadId, { percent: 100, done: true });
            respond({ success: true });
        } catch (err) {
            try { uploadClient.trackProgress(); } catch {}
            activeUploads.delete(uploadId);
            reconnect().catch(() => {});
            respond({ success: false, error: err.message });
        }
    });

    bb.on('error', err => respond({ success: false, error: err.message }));
    req.pipe(bb);
});

app.listen(3000);