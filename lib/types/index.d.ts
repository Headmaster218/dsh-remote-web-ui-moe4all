/**
 * Mobile remote control for the dsh web GUI — host half. Mounts the pairing
 * service (one-time tokens, device sessions, revocation), the /api/pair
 * route family (issue/accept/stop/heartbeat/status/events), the api/gate
 * listener that enforces pairing on every other /api request from
 * non-loopback hosts, and the presence sweep. The browser half (the
 * `./client` entry) renders the sidebar entry, the pairing panel, and the
 * phone-side pair/accept + deep-link flow.
 */
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import z from 'schemastery';
import { type PairingConfig } from './pairing.ts';
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * Waterfall seam on the /api transport fence: the connection plugin
         * fires this per /api request before bridging to the API proxy on
         * deployments that carry the pairing/revocation seam; call `next()` to
         * delegate, return false (without calling it) to veto with 403.
         *
         * Cohort note (0.1.2-alpha.2): the official runtime ships NO emitter
         * for this event, so the listener below never fires there and direct
         * /api stays under the harness fence + browser auth. It is wired anyway
         * so cohort lines that do carry the seam get pairing enforcement on
         * direct /api without a plugin change.
         */
        'api/gate'(this: Context, request: IncomingMessage, method: string | undefined, next: () => boolean | Promise<boolean>): boolean | Promise<boolean>;
    }
}
/** Stable cordis plugin name. */
export declare const name = "remote-web-ui";
/** Services required before the pairing surfaces can mount. */
export declare const inject: string[];
/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export declare const REMOTE_WEB_UI_SETTINGS_NAMESPACE: SettingsNamespace;
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /** Token lifetime in ms; the QR link dies after this. */
    tokenTtlMs?: number;
    /** A device is "online" while its lastSeenAt is newer than this (ms). */
    offlineAfterMs?: number;
    /** Hard cap on paired device sessions (oldest evicted when full). */
    maxDevices?: number;
    /**
     * Idle sessions older than this (ms) are deleted from memory and disk.
     * Default is 7 days; a leftover cookie no longer authorizes after expiry.
     */
    idleExpireMs?: number;
    /** Cookie name carrying the paired device id. */
    cookieName?: string;
    /**
     * When true (default), a desktop Web GUI opened at a non-loopback origin
     * rides the gated `/remote/api` channel and must carry a live paired-device
     * cookie — the QR is the only way into remote desktop, and stop()/revoke()
     * cut the /remote channel and the pairing cookie off immediately. Scope
     * note for this cohort: direct /api is governed by the harness fence +
     * browser-auth cookie (the api/gate seam has no emitter on 0.1.2-alpha.2),
     * so a harness browser credential a device has already redeemed is not
     * invalidated by stop() — see the README security model. Set false to keep
     * the desktop on plain `/api` (only useful when that origin is already
     * trusted for `/api`).
     */
    requirePairingForLan?: boolean;
    /**
     * Public base URL of a tunnel in front of this server (e.g. a Cloudflare
     * Tunnel quick URL `https://xxx.trycloudflare.com` or a named-tunnel
     * subdomain). When set, the QR link is built from it — a phone anywhere
     * can pair — and its host is trusted by the phone-facing pairing fence.
     * Leave unset for LAN-only usage. Malformed values are ignored with a
     * warning (LAN-only behavior preserved). Ignored while `autoTunnel` is on.
     */
    publicBaseUrl?: string;
    /**
     * Extra trusted host authorities (exact host:port or port-less host) allowed
     * to access pairing endpoints and remote web services. Useful in Docker, reverse proxy,
     * or NAT environments where incoming request Host headers differ from the container's
     * internal network addresses. Can also be set via the DSH_REMOTE_TRUSTED_HOSTS env var.
     */
    trustedHosts?: string[];
    /**
     * Absolute path to a JSON file where paired device sessions are persisted.
     * Defaults to `$DSH_HOME/remote-web-ui-devices.json` so a paired device
     * keeps its session across `dsh web` restarts (the cookie already lives
     * 365 days). Override to another absolute path when needed.
     */
    devicesFile?: string;
    /**
     * When true, the plugin runs its own Cloudflare quick tunnel (the
     * cloudflared binary ships with the package — no user-side install) and
     * feeds the minted public URL into the QR base and the phone-facing
     * pairing fence dynamically, so phones anywhere can pair without any manual
     * tunnel setup. The minted hostname changes on every start, so a paired
     * phone must re-pair after each restart. The manual `publicBaseUrl` and
     * `tunnelToken` are ignored while this is on.
     */
    autoTunnel?: boolean;
    /**
     * Cloudflare named-tunnel token (`cloudflared tunnel run --token <t>`).
     * When set (and `autoTunnel` is off), the plugin runs the named tunnel
     * itself — same binary, same lifecycle management — toward the fixed
     * public hostname configured in the Cloudflare dashboard. Because that
     * hostname never changes, a paired phone keeps its bookmark and its
     * pairing cookie across `dsh web` restarts: pair once, never again.
     * Requires `publicBaseUrl` to name that same hostname (the token does not
     * carry it); without a valid `publicBaseUrl` the tunnel stays off and a
     * warning explains what is missing. Treated as a secret: the settings
     * surface stores it redacted.
     */
    tunnelToken?: string;
    /**
     * Stable-origin relay: when on (default), the quick tunnel is fronted by a
     * fixed `https://<id>.dsh-market.com` subdomain (the dsh-market worker's
     * registry), so the phone's bookmark and pairing cookie survive `dsh web`
     * restarts without any user setup. Traffic transits the dsh-market edge
     * (the same trust point as the quick tunnel itself); turn off to fall back
     * to the raw ephemeral quick URL. Named tunnels keep their dashboard
     * hostname and never touch the relay.
     */
    relay?: boolean;
    /** Anonymous daily browser heartbeat to dsh-market.com; opt-in only. */
    telemetry?: boolean;
    /**
     * LAN bind toggle. When the user flips it (true or false) the plugin
     * writes the managed webserver block into the profile patch — true pins
     * the bind default to 0.0.0.0 (an explicit --host flag still wins), false
     * pins it back to 127.0.0.1 — and maintains the matching host firewall
     * rule (Windows netsh; Linux firewalld/ufw/iptables; other platforms
     * report the firewall as unmanaged). The block takes effect when the
     * process next applies the profile — the live patch watcher recomposes on
     * some profile shapes, otherwise on the next start — and the settings
     * card reports the divergence (pendingRestart) instead of guessing.
     * While the toggle has never been set (undefined), the plugin does not
     * touch the patch file at all.
     */
    lanBind?: boolean;
    /**
     * The profile whose cordis.patch.yml the LAN bind toggle manages.
     * Defaults to the DSH_PROFILE environment variable, then "web". Must be
     * a single safe path segment (the DSH_PROFILE env fallback bypasses this
     * schema, so the path builder asserts containment independently).
     */
    profile?: string;
    /** Master switch for the plugin (browser half + host pairing surfaces). */
    enabled?: boolean;
}
export declare const Config: z<Config>;
/**
 * Fully resolved config: every field non-optional except `publicBaseUrl`,
 * which legitimately resolves to `undefined` when unset (the schema keeps it
 * optional, so `Required` alone would over-narrow it to `string`).
 */
type ResolvedConfig = Required<Omit<Config, 'publicBaseUrl' | 'trustedHosts' | 'devicesFile' | 'lanBind' | 'profile' | 'tunnelToken'>> & {
    publicBaseUrl: string | undefined;
    trustedHosts: string[] | undefined;
    devicesFile: string;
    /** undefined until the user flips the toggle once; undefined never writes the patch. */
    lanBind: boolean | undefined;
    tunnelToken: string | undefined;
    profile: string;
};
/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export declare function pairingConfigOf(resolved: Pick<ResolvedConfig, 'tokenTtlMs' | 'offlineAfterMs' | 'maxDevices' | 'idleExpireMs' | 'cookieName' | 'devicesFile'>): PairingConfig;
/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export declare function defaultDevicesFile(home?: string): string;
/**
 * Mount the pairing service, routes, gate listener, and presence sweep.
 * @param ctx - host plugin context carrying webServer.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export declare const apply: typeof applyImpl;
declare function applyImpl(ctx: Context, config?: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map