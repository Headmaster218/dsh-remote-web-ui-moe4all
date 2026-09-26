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
/** The observable tunnel lifecycle the settings/panel surfaces render. */
export type TunnelPhase = 'stopped' | 'starting' | 'running' | 'failed';
/**
 * What the manager should run. `quick` is the accountless trycloudflare
 * tunnel whose hostname is minted per start (and dies with the process);
 * `named` is an account tunnel whose public hostname is fixed — the point
 * of the named mode is that a paired phone keeps its bookmark and its
 * pairing cookie across restarts.
 */
export type TunnelTarget = {
    kind: 'quick';
    targetUrl: string;
    originHostHeader?: string;
} | {
    kind: 'named';
    token: string;
    publicUrl: string;
};
/** The event face the named adapter wraps (a cloudflared package Tunnel). */
interface NamedTunnelProcess {
    on(event: 'connected', listener: () => void): unknown;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    on(event: 'error', listener: (value: Error) => void): unknown;
    off(event: string, listener: (...args: any[]) => void): unknown;
    stop(): boolean;
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
export declare function namedTunnelHandle(inner: NamedTunnelProcess, publicUrl: string): TunnelHandle;
/** One tunnel status frame. */
export interface TunnelInfo {
    phase: TunnelPhase;
    /** The minted public URL, once the tunnel reports it. */
    url?: string;
    /** Human-readable failure detail (binary install, URL timeout, spawn error). */
    error?: string;
}
/** The tunnel handle subset this manager uses (the package's Tunnel fits). */
export interface TunnelHandle {
    on(event: string, listener: (...args: any[]) => void): unknown;
    off(event: string, listener: (...args: any[]) => void): unknown;
    stop(): boolean;
}
/** Injectable seams (defaults are the real cloudflared package + node timers). */
export interface TunnelManagerOptions {
    /** Spawn one tunnel process for the target (quick or named). */
    factory?: (target: TunnelTarget) => TunnelHandle;
    /** Make sure the cloudflared binary exists, downloading it when absent. */
    ensureBinary?: () => Promise<void>;
    /** Wait up to this long for the tunnel URL before failing the attempt. */
    urlTimeoutMs?: number;
    /** First restart delay after an unexpected failure (exponential base). */
    restartBaseMs?: number;
    /** Cap on the exponential restart delay. */
    restartMaxMs?: number;
    /** Timer source (injected in tests). */
    timer?: {
        setTimeout(fn: () => void, ms: number): unknown;
        clearTimeout(t: unknown): void;
    };
}
/**
 * Probe whether the binary at `path` actually executes on this machine. The
 * desktop payload stages one dependency tree for every shipped OS/arch, so a
 * binary can exist with the wrong architecture (the arm64 darwin
 * `bin/cloudflared` on an x64 mac); existence alone must not skip the
 * reinstall.
 */
export declare function binaryRuns(executable: string): Promise<boolean>;
/** Injectable seams of the default binary readiness (tests swap them all). */
export interface BinaryReadinessSeams {
    exists?: (path: string) => boolean;
    runs?: (executable: string) => Promise<boolean>;
    install?: (path: string) => Promise<unknown>;
}
/**
 * Build the default readiness policy over a binary path: skip when the
 * binary has already proven runnable in this process, validate an existing
 * file before trusting it (a stale or wrong-arch binary must not disable
 * the reinstall), and re-fetch the current platform binary otherwise.
 */
export declare function createBinaryReadiness(executable: string, seams?: BinaryReadinessSeams): () => Promise<void>;
/**
 * Spawn flags for one quick target. `originHostHeader` stamps the Host the
 * local webserver sees: the plugin's phone-facing fence trusts the configured
 * public host (the stable relay origin, Host-bound) and the harness
 * browser-auth binds cookies to the Host authority, while the Workers relay
 * cannot control the origin-side Host at all (fetch forces it to the URL
 * authority) — so the connector must restamp it with the stable origin.
 */
export declare function quickTunnelFlags(originHostHeader?: string): Record<string, string | boolean>;
/**
 * Own the lifecycle of one auto-tunnel: start/stop, URL surfacing, and
 * crash-restart backoff.
 */
export declare class TunnelManager {
    private readonly factory;
    private readonly ensureBinary;
    private readonly urlTimeoutMs;
    private readonly restartBaseMs;
    private readonly restartMaxMs;
    private readonly timer;
    private phase;
    private url;
    private error;
    private target;
    private handle;
    private urlTimer;
    private restartTimer;
    private attempts;
    private generation;
    private stopping;
    private readonly urlListeners;
    private readonly phaseListeners;
    /**
     * @param options - seams; defaults spawn the real quick tunnel.
     */
    constructor(options?: TunnelManagerOptions);
    /** The current status frame. */
    get info(): TunnelInfo;
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
    start(target: TunnelTarget | string): void;
    /** Stop the tunnel for good: no restarts, no state. */
    stop(): void;
    /** Alias of {@link stop} for plugin-effect disposal. */
    dispose(): void;
    /** Subscribe to minted tunnel URLs (fire-and-forget duplicates dropped). */
    onUrl(listener: (url: string) => void): () => void;
    /** Subscribe to every phase change. */
    onPhase(listener: (info: TunnelInfo) => void): () => void;
    private attempt;
    private handleUrl;
    private handleExit;
    private fail;
    /** Stop the current process and cancel every pending timer (no phase change). */
    private teardown;
    private setPhase;
}
export {};
//# sourceMappingURL=tunnel.d.ts.map