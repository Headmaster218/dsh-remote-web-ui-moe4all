/**
 * The remote desktop channel — browser half. On a non-loopback origin (LAN
 * address or public tunnel) fenced host routes refuse the request, and
 * pairing is the real access control — so same-origin traffic the desktop
 * issues is rewritten onto this plugin's gated `/remote` prefix (host half
 * in src/remote-api.ts). The host then re-issues the call to 127.0.0.1 so
 * plugin loopback fences pass.
 *
 * The rewrite is deliberately narrow:
 * - loopback origins are untouched (the desktop at 127.0.0.1 keeps original paths);
 * - the pairing routes (`/api/pair/*`) stay where they are — accept must
 *   work BEFORE a device is paired;
 * - the update endpoints (`/api/update/*`) stay loopback-only;
 * - the family settings bridge (`/api/dsh-web-ui-settings/*`) stays
 *   loopback-only (same plane as SDK settings.*);
 * - `/api/*` (SDK methods and `/api/<plugin>/...` plugin namespaces),
 *   `/sidebar/*`, `/git/*`, and `/pet/*` ride the channel;
 * - fetch, EventSource, WebSocket, and img/script/iframe `src` are patched;
 *   everything else calls the original unchanged.
 *
 * Pure helpers are exported for unit tests; `installRemoteChannel` patches
 * the given window and returns their restore.
 */
import { REMOTE_API_PREFIX, REMOTE_PREFIX } from '../remote-channel-rules.ts';
export { REMOTE_API_PREFIX, REMOTE_PREFIX };
export type { RemoteChannelBootSeat } from '../remote-channel-rules.ts';
export { REMOTE_CHANNEL_BOOT_GLOBAL } from '../remote-channel-rules.ts';
/** Minimal settings snapshot used by the remote channel decision. */
export interface RemoteChannelSettingsSnapshot {
    status: 'ready' | 'loading' | 'unavailable' | string;
    value?: {
        enabled?: boolean;
        requirePairingForLan?: boolean;
    };
}
/** Decide whether a remote desktop channel is required from local or host policy. */
export declare function remoteChannelRequired(hostname: string, snapshot: RemoteChannelSettingsSnapshot, hostPairingPolicy: boolean | undefined): boolean;
/**
 * Browser-safe loopback classification for the page origin (the SDK client
 * exports its own; this copy keeps the module dependency-free).
 * @param hostname - a location hostname (IPv6 without brackets).
 * @returns true for localhost, IPv6 loopback, or any 127/8 literal.
 */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Whether one same-origin path must ride the gated channel (fetch, EventSource,
 * img/script/iframe src).
 * @param pathname - the request URL pathname.
 */
export declare function shouldRewriteFetchPath(pathname: string): boolean;
/**
 * Whether one WebSocket path must ride the gated channel.
 * @param pathname - the WebSocket URL pathname.
 */
export declare function shouldRewriteWsPath(pathname: string): boolean;
/** The gated twin of one fenced path (`/remote` + original pathname). */
export declare function rewritePath(pathname: string): string;
/**
 * Rewrite one raw URL string when it is same-origin and fenced. Relative
 * inputs stay relative so resource loaders do not unexpectedly absolutize.
 */
export declare function rewriteRawUrl(raw: string, baseHref: string, origin: string): string;
/** A constructor that exposes a configurable `src` on its prototype. */
interface SrcConstructor {
    prototype: object;
}
/** The subset of window the channel needs (injectable for tests). */
export interface ChannelWindow {
    fetch: typeof globalThis.fetch;
    WebSocket: typeof WebSocket;
    EventSource?: typeof EventSource;
    HTMLImageElement?: SrcConstructor;
    HTMLScriptElement?: SrcConstructor;
    HTMLIFrameElement?: SrcConstructor;
    location: {
        origin: string;
        href: string;
    };
    sessionStorage?: {
        getItem(key: string): string | null;
    };
}
/** Options for {@link installRemoteChannel}. */
export interface RemoteChannelOptions {
    /** Called when a gated call came back unpaired (code `unpaired`). */
    onUnpaired?: () => void;
    /** Called when a gated call succeeded (an unpaired banner can retire). */
    onPaired?: () => void;
}
/**
 * Whether a gated 403 is the unpaired-device fence (not a loopback-only
 * method denial, which uses the same status with code `forbidden`).
 */
export declare function isUnpairedDenied(response: Response): Promise<boolean>;
/**
 * Patch `fetch`, `EventSource`, `WebSocket`, and resource `src` accessors on
 * one window to route fenced traffic through the gated channel.
 * @param window - the browser window (or a test double).
 * @param options - the unpaired callback.
 * @returns a function restoring the originals.
 */
export declare function installRemoteChannel(window: ChannelWindow, options?: RemoteChannelOptions): () => void;
/**
 * The remote-channel lifecycle transition between two steady states:
 * running (active + installed) and retired (inactive + not installed).
 * The client apply drives the channel with this decision and retires the
 * unpaired fence notice together with the channel itself — a notice raised
 * while the channel was briefly active must not outlive it (issue #808).
 */
export type ChannelTransition = 'install' | 'retire' | 'none';
/**
 * Decide what the channel lifecycle must do next.
 * @param active - whether the gated remote channel should be running now.
 * @param installed - whether it currently is (disposer !== undefined).
 * @returns the transition to apply.
 */
export declare function channelTransition(active: boolean, installed: boolean): ChannelTransition;
//# sourceMappingURL=remote-channel.d.ts.map