/**
 * Auto-tunnel manager: spawns a Cloudflare tunnel through the `cloudflared`
 * npm package — its postinstall downloads the platform binary and the
 * readiness policy below validates it and re-fetches when it cannot run (the
 * desktop payload stages one tree for every shipped OS/arch), so no
 * user-side tooling is involved — surfaces the public URL, and restarts the
 * process after unexpected exits with exponential backoff. Two modes: the
 * accountless quick tunnel (`https://xxx.trycloudflare.com`, hostname minted
 * per start) and an account named tunnel (`cloudflared tunnel run --token`,
 * fixed public hostname — the mode that lets a paired phone keep its
 * bookmark and pairing cookie across restarts).
 *
 * The cloudflared package's Tunnel is a thin spawn wrapper; this manager
 * owns the lifecycle policy (binary readiness, URL timeout, restart
 * backoff) around it. All seams — the tunnel factory, binary readiness,
 * timers — are injectable so the whole lifecycle is unit-testable without
 * a real binary or network.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { bin, install, Tunnel } from 'cloudflared';
/** Compare two targets for the start idempotence check. */
function sameTarget(left, right) {
    if (left === undefined)
        return false;
    return JSON.stringify(left) === JSON.stringify(right);
}
/**
 * Wrap a named-tunnel process so it fits the quick-tunnel handle shape: the
 * fixed public URL is reported through the same `url` event once the first
 * edge connection registers (cloudflared fires `connected` per connection,
 * so only the first is taken), and exit/error pass through. The manager's
 * URL timeout, crash-restart backoff, and stop semantics then stay fully
 * mode-agnostic.
 * @param inner - the running named-tunnel process.
 * @param publicUrl - the fixed public hostname ingress maps to this server.
 * @returns a handle emitting `url` once the tunnel is reachable.
 */
export function namedTunnelHandle(inner, publicUrl) {
    const handle = new EventEmitter();
    let registered = false;
    const onConnected = () => {
        // cloudflared fires `connected` per edge connection (four on a healthy
        // registration); the fixed URL only needs reporting once.
        if (registered)
            return;
        registered = true;
        handle.emit('url', publicUrl);
    };
    const onExit = (code, signal) => {
        handle.emit('exit', code, signal);
    };
    const onError = (value) => {
        handle.emit('error', value);
    };
    inner.on('connected', onConnected);
    inner.on('exit', onExit);
    inner.on('error', onError);
    handle.stop = () => {
        inner.off('connected', onConnected);
        inner.off('exit', onExit);
        inner.off('error', onError);
        return inner.stop();
    };
    return handle;
}
/** Time box for the `--version` probe that validates a staged binary. */
const BINARY_PROBE_TIMEOUT_MS = 10_000;
/**
 * Probe whether the binary at `path` actually executes on this machine. The
 * desktop payload stages one dependency tree for every shipped OS/arch, so a
 * binary can exist with the wrong architecture (the arm64 darwin
 * `bin/cloudflared` on an x64 mac); existence alone must not skip the
 * reinstall.
 */
export function binaryRuns(executable) {
    return new Promise((resolvePromise) => {
        const child = spawn(executable, ['--version'], { stdio: 'ignore' });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolvePromise(false);
        }, BINARY_PROBE_TIMEOUT_MS);
        child.once('error', () => { clearTimeout(timer); resolvePromise(false); });
        child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code === 0); });
    });
}
/**
 * Build the default readiness policy over a binary path: skip when the
 * binary has already proven runnable in this process, validate an existing
 * file before trusting it (a stale or wrong-arch binary must not disable
 * the reinstall), and re-fetch the current platform binary otherwise.
 */
export function createBinaryReadiness(executable, seams = {}) {
    const exists = seams.exists ?? existsSync;
    const runs = seams.runs ?? binaryRuns;
    const installBinary = seams.install ?? install;
    const validated = new Set();
    return async () => {
        if (validated.has(executable))
            return;
        if (exists(executable) && await runs(executable)) {
            validated.add(executable);
            return;
        }
        await installBinary(executable);
        if (!(await runs(executable))) {
            throw new Error(`the cloudflared binary at ${executable} still does not run after the reinstall`);
        }
        validated.add(executable);
    };
}
/** The readiness policy the manager uses by default: the package's real binary path. */
const defaultBinaryReadiness = createBinaryReadiness(bin);
/** Default binary readiness: keep a working platform binary at `bin`. */
async function defaultEnsureBinary() {
    await defaultBinaryReadiness();
}
/** The flags every tunnel mode shares (see the quick factory comment). */
const SHARED_TUNNEL_FLAGS = { '--no-autoupdate': true, '--protocol': 'http2' };
/**
 * Spawn flags for one quick target. `originHostHeader` stamps the Host the
 * local webserver sees: the plugin's phone-facing fence trusts the configured
 * public host (the stable relay origin, Host-bound) and the harness
 * browser-auth binds cookies to the Host authority, while the Workers relay
 * cannot control the origin-side Host at all (fetch forces it to the URL
 * authority) — so the connector must restamp it with the stable origin.
 */
export function quickTunnelFlags(originHostHeader) {
    return originHostHeader === undefined
        ? { ...SHARED_TUNNEL_FLAGS }
        : { ...SHARED_TUNNEL_FLAGS, '--http-host-header': originHostHeader };
}
/** Default factory: the cloudflared package's quick and named tunnels. */
function defaultFactory(target) {
    // `--no-autoupdate`: the binary must never upgrade itself out from under
    // the manager (a self-updated binary would break the pinned lifecycle).
    // `--protocol http2`: the default `auto` prefers QUIC (UDP 7844), which
    // wedges on fake-ip TUN proxies and QUIC-hostile networks — the connector
    // holds the hostname but reports readyConnections: 0 forever (edge 1033),
    // and the auto fallback never fires on a half-open QUIC handshake. http2
    // rides TCP through the same paths reliably (verified live: auto stuck at
    // ready 0 on two fresh registrations; http2 ready immediately).
    if (target.kind === 'quick') {
        return Tunnel.quick(target.targetUrl, quickTunnelFlags(target.originHostHeader));
    }
    return namedTunnelHandle(Tunnel.withToken(target.token, { ...SHARED_TUNNEL_FLAGS }), target.publicUrl);
}
/** Node timers. */
const nodeTimer = { setTimeout, clearTimeout };
/**
 * Own the lifecycle of one auto-tunnel: start/stop, URL surfacing, and
 * crash-restart backoff.
 */
export class TunnelManager {
    factory;
    ensureBinary;
    urlTimeoutMs;
    restartBaseMs;
    restartMaxMs;
    timer;
    phase = 'stopped';
    url;
    error;
    target;
    handle;
    urlTimer;
    restartTimer;
    attempts = 0;
    // Generation counter: a stale ensureBinary resolution from an earlier
    // start() must not spawn a second handle after a stop/start cycle.
    generation = 0;
    stopping = false;
    urlListeners = new Set();
    phaseListeners = new Set();
    /**
     * @param options - seams; defaults spawn the real quick tunnel.
     */
    constructor(options = {}) {
        this.factory = options.factory ?? defaultFactory;
        this.ensureBinary = options.ensureBinary ?? defaultEnsureBinary;
        this.urlTimeoutMs = options.urlTimeoutMs ?? 30_000;
        this.restartBaseMs = options.restartBaseMs ?? 5_000;
        this.restartMaxMs = options.restartMaxMs ?? 60_000;
        this.timer = options.timer ?? nodeTimer;
    }
    /** The current status frame. */
    get info() {
        return {
            phase: this.phase,
            ...(this.url !== undefined ? { url: this.url } : {}),
            ...(this.error !== undefined ? { error: this.error } : {}),
        };
    }
    /**
     * Start (or keep) a tunnel toward `target`. Restarting with a different
     * target tears the old tunnel down first; restarting with the same target
     * while running is a no-op. A string is the quick mode's local target URL.
     *
     * In quick mode the URL surfaces when cloudflared mints the ephemeral
     * trycloudflare hostname; in named mode the fixed `publicUrl` surfaces
     * once the first edge connection registers (see {@link namedTunnelHandle}).
     * @param target - what to run (a string means quick toward that local URL).
     */
    start(target) {
        const resolved = typeof target === 'string' ? { kind: 'quick', targetUrl: target } : target;
        if (sameTarget(this.target, resolved) && (this.phase === 'starting' || this.phase === 'running'))
            return;
        this.teardown();
        this.stopping = false;
        this.target = resolved;
        this.attempts = 0;
        this.generation += 1;
        this.attempt();
    }
    /** Stop the tunnel for good: no restarts, no state. */
    stop() {
        this.teardown();
        this.stopping = false;
        this.target = undefined;
        this.setPhase('stopped');
    }
    /** Alias of {@link stop} for plugin-effect disposal. */
    dispose() {
        this.stop();
    }
    /** Subscribe to minted tunnel URLs (fire-and-forget duplicates dropped). */
    onUrl(listener) {
        this.urlListeners.add(listener);
        return () => { this.urlListeners.delete(listener); };
    }
    /** Subscribe to every phase change. */
    onPhase(listener) {
        this.phaseListeners.add(listener);
        return () => { this.phaseListeners.delete(listener); };
    }
    attempt() {
        if (this.stopping || this.target === undefined)
            return;
        const gen = this.generation;
        this.setPhase('starting');
        this.handle = undefined;
        this.url = undefined;
        this.error = undefined;
        void this.ensureBinary().then(() => {
            if (this.stopping || this.target === undefined || gen !== this.generation)
                return;
            const handle = this.factory(this.target);
            this.handle = handle;
            this.urlTimer = this.timer.setTimeout(() => {
                // The tunnel never reported a URL: kill it and retry with backoff.
                this.fail('timed out waiting for the tunnel URL');
            }, this.urlTimeoutMs);
            handle.on('url', (value) => {
                if (this.handle !== handle)
                    return;
                this.handleUrl(value);
            });
            handle.on('exit', () => {
                if (this.handle !== handle)
                    return;
                this.handleExit();
            });
            handle.on('error', (value) => {
                // Spawn/connection errors usually precede an exit; the exit path owns
                // restart, this only records diagnostics while the process still lives.
                if (this.handle !== handle || this.phase !== 'starting')
                    return;
                this.error = value instanceof Error ? value.message : String(value);
            });
        }).catch((value) => {
            // Binary install failed (no network, no platform build): report it.
            if (this.stopping || this.target === undefined || gen !== this.generation)
                return;
            const message = value instanceof Error ? value.message : String(value);
            this.fail(`could not obtain the cloudflared binary: ${message}`);
        });
    }
    handleUrl(value) {
        if (this.urlTimer !== undefined) {
            this.timer.clearTimeout(this.urlTimer);
            this.urlTimer = undefined;
        }
        this.url = value;
        this.error = undefined;
        this.attempts = 0;
        this.setPhase('running');
        for (const listener of this.urlListeners) {
            try {
                listener(value);
            }
            catch {
                // A throwing subscriber must not break the emit loop.
            }
        }
    }
    handleExit() {
        // The exit handler is detached during teardown, so reaching this point
        // means an unexpected death: fail the current phase and schedule a retry.
        if (this.stopping)
            return;
        this.fail('the tunnel process exited unexpectedly');
    }
    fail(message) {
        if (this.stopping)
            return;
        this.url = undefined;
        this.error = message;
        if (this.handle !== undefined) {
            this.handle.stop();
            this.handle = undefined;
        }
        if (this.urlTimer !== undefined) {
            this.timer.clearTimeout(this.urlTimer);
            this.urlTimer = undefined;
        }
        this.setPhase('failed');
        this.attempts += 1;
        const delay = Math.min(this.restartBaseMs * 2 ** (this.attempts - 1), this.restartMaxMs);
        this.restartTimer = this.timer.setTimeout(() => {
            this.restartTimer = undefined;
            this.attempt();
        }, delay);
    }
    /** Stop the current process and cancel every pending timer (no phase change). */
    teardown() {
        this.stopping = true;
        if (this.urlTimer !== undefined) {
            this.timer.clearTimeout(this.urlTimer);
            this.urlTimer = undefined;
        }
        if (this.restartTimer !== undefined) {
            this.timer.clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
        if (this.handle !== undefined) {
            this.handle.stop();
            this.handle = undefined;
        }
    }
    setPhase(phase) {
        this.phase = phase;
        const info = this.info;
        for (const listener of this.phaseListeners) {
            try {
                listener(info);
            }
            catch {
                // A throwing subscriber must not break the emit loop.
            }
        }
    }
}
