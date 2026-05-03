import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { realpath, stat, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { mimeForExt } from '../image.js';
import { renderPage } from './page.js';

const execFileP = promisify(execFile);

type ChangeStatus = 'modified' | 'added' | 'deleted';

interface ChangeEntry {
  path: string;       // repo-relative
  locale: string;     // parent dir name
  filename: string;   // basename
  status: ChangeStatus;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

export async function runReview(opts: { screenshotsDir: string }): Promise<void> {
  const screenshotsDir = await realpath(resolve(opts.screenshotsDir));
  const repoRoot = await detectRepoRoot(screenshotsDir);
  const dirRelToRepo = relative(repoRoot, screenshotsDir);
  if (dirRelToRepo.startsWith('..') || isAbsolute(dirRelToRepo)) {
    throw new Error(
      `Screenshots directory ${screenshotsDir} is outside the git repo at ${repoRoot}.`,
    );
  }

  const changes = await collectChanges(repoRoot, screenshotsDir);
  if (changes.length === 0) {
    console.log('Nothing to review — no uncommitted screenshot changes detected.');
    return;
  }

  await serve({ repoRoot, screenshotsDir, changes });
}

async function detectRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(`Not inside a git repository (looked from ${cwd}).`);
  }
}

async function collectChanges(repoRoot: string, screenshotsDir: string): Promise<ChangeEntry[]> {
  const { stdout } = await execFileP(
    'git',
    ['status', '--porcelain=v1', '-z', '--', screenshotsDir],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );

  const out: ChangeEntry[] = [];
  const tokens = stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (tok.length < 4) continue;
    const x = tok[0];
    const y = tok[1];
    let path = tok.slice(3);

    // Renames / copies: next NUL-token is the old name. Treat as modified at new path.
    if (x === 'R' || x === 'C') {
      i++; // consume old name
    }

    const ext = extname(path).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    if (path.endsWith('.localization-ledger.json')) continue;

    let status: ChangeStatus;
    if (x === '?' && y === '?') status = 'added';
    else if (x === 'A' || y === 'A') status = 'added';
    else if (x === 'D' || y === 'D') status = 'deleted';
    else status = 'modified';

    const rel = relative(repoRoot, resolve(repoRoot, path));
    if (rel.startsWith('..')) continue;

    const parts = rel.split(sep);
    const filename = parts[parts.length - 1];
    const locale = parts[parts.length - 2] ?? '';

    out.push({ path: rel, locale, filename, status });
  }

  out.sort((a, b) =>
    a.locale === b.locale ? a.filename.localeCompare(b.filename) : a.locale.localeCompare(b.locale),
  );
  return out;
}

interface ServeArgs {
  repoRoot: string;
  screenshotsDir: string;
  changes: ChangeEntry[];
}

function serve(args: ServeArgs): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      handle(req, res, args, () => {
        // /api/done callback
        res.end();
        setImmediate(() => server.close());
      }).catch((err) => {
        console.error(`Review server error: ${(err as Error).message}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        if (!res.writableEnded) res.end('Internal error');
      });
    });

    const onSig = () => {
      console.log('\nShutting down review server.');
      server.close();
    };
    process.once('SIGINT', onSig);
    process.once('SIGTERM', onSig);

    server.on('close', () => {
      process.removeListener('SIGINT', onSig);
      process.removeListener('SIGTERM', onSig);
      resolvePromise();
    });
    server.on('error', (err) => rejectPromise(err));

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectPromise(new Error('Failed to bind review server'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;
      console.log(`Review UI: ${url}`);
      console.log(`(${args.changes.length} changed screenshot${args.changes.length === 1 ? '' : 's'}; click "All done" or Ctrl-C to exit.)`);
      openBrowser(url);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  args: ServeArgs,
  done: () => void,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/changes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(args.changes));
    return;
  }

  if (method === 'GET' && (url.pathname === '/before' || url.pathname === '/after')) {
    const rel = url.searchParams.get('path') ?? '';
    const change = findChange(args.changes, rel);
    if (!change) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Unknown path');
      return;
    }
    if (url.pathname === '/before') {
      if (change.status === 'added') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('No previous version');
        return;
      }
      streamGitHead(args.repoRoot, change, res);
      return;
    }
    // /after
    if (change.status === 'deleted') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File was deleted');
      return;
    }
    await streamWorkingTree(args.repoRoot, change, res);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/revert') {
    const body = await readJson(req);
    const rel = typeof body?.path === 'string' ? body.path : '';
    const change = findChange(args.changes, rel);
    if (!change) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Unknown path');
      return;
    }
    await revertChange(args.repoRoot, change);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/done') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ ok: true }));
    done();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function findChange(changes: ChangeEntry[], rel: string): ChangeEntry | undefined {
  if (!rel) return undefined;
  return changes.find((c) => c.path === rel);
}

function streamGitHead(repoRoot: string, change: ChangeEntry, res: ServerResponse): void {
  const proc: ChildProcess = spawn('git', ['show', `HEAD:${change.path}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let headersSent = false;
  proc.stdout?.once('data', () => {
    if (!headersSent) {
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': mimeForExt(extname(change.path)),
        'Cache-Control': 'no-store',
      });
    }
  });
  proc.stdout?.on('error', (err) => {
    console.error(`git show stdout error: ${err.message}`);
  });
  proc.stderr?.on('data', () => {
    // swallow git stderr; non-zero exit is handled below
  });
  proc.on('error', (err) => {
    if (!headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`git show failed: ${err.message}`);
    } else {
      res.end();
    }
  });
  proc.on('close', (code) => {
    if (code !== 0 && !headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`git show exited ${code}`);
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  proc.stdout?.pipe(res, { end: false });
}

async function streamWorkingTree(
  repoRoot: string,
  change: ChangeEntry,
  res: ServerResponse,
): Promise<void> {
  const abs = resolve(repoRoot, change.path);
  try {
    await stat(abs);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found on disk');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeForExt(extname(change.path)),
    'Cache-Control': 'no-store',
  });
  createReadStream(abs).pipe(res);
}

async function revertChange(repoRoot: string, change: ChangeEntry): Promise<void> {
  if (change.status === 'added') {
    // Untracked or staged-new: unstage if needed, then delete from disk.
    try {
      await execFileP('git', ['reset', 'HEAD', '--', change.path], { cwd: repoRoot });
    } catch {
      // file may have been untracked (never staged) — fine
    }
    const abs = resolve(repoRoot, change.path);
    try {
      await unlink(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return;
  }
  // modified or deleted → restore HEAD version
  await execFileP('git', ['checkout', 'HEAD', '--', change.path], { cwd: repoRoot });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        rejectPromise(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolvePromise(null);
        return;
      }
      try {
        resolvePromise(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        rejectPromise(err as Error);
      }
    });
    req.on('error', rejectPromise);
  });
}

function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // platform without auto-open — user can copy URL from log
  }
}
