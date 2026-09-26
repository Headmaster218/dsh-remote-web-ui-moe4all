/**
 * Mobile remote control for the dsh web GUI — host half. Mounts the pairing
 * service (one-time tokens, device sessions, revocation), the /api/pair
 * route family (issue/accept/stop/heartbeat/status/events), the api/gate
 * listener that enforces pairing on every other /api request from
 * non-loopback hosts, and the presence sweep. The browser half (the
 * `./client` entry) renders the sidebar entry, the pairing panel, and the
 * phone-side pair/accept + deep-link flow.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setInterval as nodeSetInterval, setTimeout as nodeSetTimeout } from 'node:timers';
import z from 'schemastery';
import { DEFAULT_IDLE_EXPIRE_MS, PairingService } from "./pairing.js";
import { dshHome } from "./dsh-home.js";
import { isPairedDeviceRequest, makeGateListener } from "./gate.js";
import { RemoteWebUiPairing } from "./pairing-access.js";
import { isTrustedApiRequest, makeRoutes } from "./routes.js";
import { makeRemoteApiRoutes, makeRemoteApiUpgradeRoutes } from "./remote-api.js";
import { startRemotePresencePet } from "./remote-presence-pet.js";
import { claimPostureKey, postureTargets, probePosture, releasePostureKey } from "./posture.js";
import { lanIPv4Addresses } from "./lan.js";
import { ensureFirewallRule, firewallSummary, removeFirewallRule } from "./firewall.js";
import { lanBindState, writeLanBind } from "./lan-bind.js";
import { isHttpUrl, tunnelPlanOf } from "./tunnel-plan.js";
import { loadRelayIdentity, RelayRegistrar } from "./relay-registry.js";
import { desiredBindHost, desiredBindPort, firewallActionNeeded, pendingRestartOf } from "./lan-bind-plan.js";
import { createInnerAuth } from "./inner-auth.js";
import { TunnelManager } from "./tunnel.js";
import { checkUpdates, fetchGitHubReleaseNotes, fetchLatestVersion, RELEASE_NOTES_CACHE_TTL_MS, resolveAnchorManifest, resolveUpdateTarget, runUpdateVerified, } from "./update.js";
import { makeUpdateRoutes } from "./update-routes.js";
import { mountOnce } from "./mount-once.js";
import { REMOTE_CHANNEL_BOOT_SCRIPT } from "./remote-channel-boot.js";
import { UUID_POLYFILL_SCRIPT } from "./uuid-polyfill.js";
/** Stable cordis plugin name. */
export const name = 'remote-web-ui';
/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'typertGateway', 'connection'];
/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = 'remote-web-ui';
export const Config = z.object({
    tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000),
    offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
    maxDevices: z.number().step(1).min(1).max(64).default(4),
    idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS),
    cookieName: z.string().min(1).default('dsh_pair'),
    requirePairingForLan: z.boolean().default(true),
    publicBaseUrl: z.string(),
    trustedHosts: z.array(z.string()),
    devicesFile: z.string(),
    autoTunnel: z.boolean().default(false),
    tunnelToken: z.string().role('secret'),
    relay: z.boolean().default(true),
    lanBind: z.boolean(),
    profile: z.string().pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    enabled: z.boolean().default(true),
});
/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000;
/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export function pairingConfigOf(resolved) {
    return {
        tokenTtlMs: resolved.tokenTtlMs,
        offlineAfterMs: resolved.offlineAfterMs,
        maxDevices: resolved.maxDevices,
        idleExpireMs: resolved.idleExpireMs,
        cookieName: resolved.cookieName,
        devicesFile: resolved.devicesFile,
    };
}
/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export function defaultDevicesFile(home = dshHome()) {
    return join(home, 'remote-web-ui-devices.json');
}
/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS = {
    tokenTtlMs: 10 * 60_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
    cookieName: 'dsh_pair',
    requirePairingForLan: true,
    publicBaseUrl: undefined,
    trustedHosts: undefined,
    devicesFile: defaultDevicesFile(),
    autoTunnel: false,
    tunnelToken: undefined,
    relay: true,
    lanBind: undefined,
    profile: process.env.DSH_PROFILE ?? 'web',
    enabled: true,
};
/**
 * Mount the pairing service, routes, gate listener, and presence sweep.
 * @param ctx - host plugin context carrying webServer.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-remote-web-ui', applyImpl);
function applyImpl(ctx, config) {
    const envPublicBase = process.env.DSH_REMOTE_PUBLIC_BASE_URL?.trim() || undefined;
    const resolved = {
        tokenTtlMs: config?.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
        offlineAfterMs: config?.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
        maxDevices: config?.maxDevices ?? DEFAULTS.maxDevices,
        idleExpireMs: config?.idleExpireMs ?? DEFAULTS.idleExpireMs,
        cookieName: config?.cookieName ?? DEFAULTS.cookieName,
        requirePairingForLan: config?.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
        publicBaseUrl: config?.publicBaseUrl ?? envPublicBase,
        trustedHosts: config?.trustedHosts,
        devicesFile: config?.devicesFile ?? DEFAULTS.devicesFile,
        autoTunnel: config?.autoTunnel ?? DEFAULTS.autoTunnel,
        tunnelToken: config?.tunnelToken,
        relay: config?.relay ?? DEFAULTS.relay,
        lanBind: config?.lanBind,
        profile: config?.profile ?? process.env.DSH_PROFILE ?? DEFAULTS.profile,
        enabled: config?.enabled ?? DEFAULTS.enabled,
    };
    // The live source the pairing service and the gate read: the settings
    // section once the web settings surface is served, the composition entry
    // otherwise (installSection swaps it when the namespace registers).
    let current = () => config ?? {};
    const resolve = () => {
        const value = current();
        return {
            tokenTtlMs: value.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
            offlineAfterMs: value.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
            maxDevices: value.maxDevices ?? DEFAULTS.maxDevices,
            idleExpireMs: value.idleExpireMs ?? DEFAULTS.idleExpireMs,
            cookieName: value.cookieName ?? DEFAULTS.cookieName,
            requirePairingForLan: value.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
            publicBaseUrl: value.publicBaseUrl ?? envPublicBase,
            trustedHosts: value.trustedHosts,
            devicesFile: value.devicesFile ?? DEFAULTS.devicesFile,
            autoTunnel: value.autoTunnel ?? DEFAULTS.autoTunnel,
            tunnelToken: value.tunnelToken,
            relay: value.relay ?? DEFAULTS.relay,
            lanBind: value.lanBind,
            profile: value.profile ?? process.env.DSH_PROFILE ?? DEFAULTS.profile,
            enabled: value.enabled ?? DEFAULTS.enabled,
        };
    };
    const service = new PairingService(pairingConfigOf(resolved));
    // ── auto tunnel ─────────────────────────────────────────────────────────
    // The minted public URL becomes the QR base (and the pairing fence's
    // trusted host). Phone /api traffic rides the plugin's own /remote channel,
    // which is NOT subject to the connection trust fence — so no fence
    // mutation is needed here (a distributable plugin must not change the
    // harness's connection plugin).
    const tunnel = new TunnelManager();
    // Relay registry: one stable `<id>.dsh-market.com` subdomain per profile
    // in front of the quick tunnel. The QR base prefers the relay origin once
    // it is registered; until then (or when the registry is unreachable) the
    // raw quick URL is used, exactly as before. Named tunnels keep their fixed
    // dashboard hostname and never touch the relay.
    let relayRegistrar;
    let relayUrl;
    let rawTunnelUrl;
    /** The tunnel target the registrar last announced (dedupes sync re-runs). */
    let relayAnnouncedFor;
    const setPublicBase = () => {
        service.setPublicBaseUrl(relayUrl ?? rawTunnelUrl);
    };
    const disposeRelayRegistrar = (unregister = false) => {
        const registrar = relayRegistrar;
        relayRegistrar = undefined;
        relayUrl = undefined;
        relayAnnouncedFor = undefined;
        if (registrar === undefined)
            return;
        // Toggle-off removes the registry row so the stable origin stops
        // proxying; teardown/mode changes keep the row (the phone then sees the
        // relay's offline page instead of a dangling claim, and re-enabling
        // reuses the same identity).
        if (unregister)
            void registrar.unregister().catch(() => undefined);
        registrar.dispose();
    };
    const ensureRelayRegistrar = () => {
        if (resolve().relay === false)
            return undefined;
        if (relayRegistrar === undefined) {
            try {
                const identity = loadRelayIdentity(resolve().profile);
                relayRegistrar = new RelayRegistrar(identity, (state) => {
                    service.setRelayStatus(state.state === 'off' ? undefined : state);
                    if (state.state === 'running') {
                        relayUrl = state.url;
                    }
                    else if (state.state === 'off') {
                        relayUrl = undefined;
                    }
                    else if (state.state === 'failed') {
                        // Keep the last relay URL on failures: the phone origin only
                        // breaks when the mapping itself goes stale, not when one
                        // refresh call fails. The registrar retries with backoff.
                        console.warn(`remote-web-ui: relay registration failed (${state.error}) — the stable origin may serve its offline page until the retry lands`);
                    }
                    setPublicBase();
                });
            }
            catch (error) {
                console.warn(`remote-web-ui: relay registry unavailable (${error instanceof Error ? error.message : String(error)}) — the quick URL is the QR base`);
            }
        }
        return relayRegistrar;
    };
    const announceRelay = (registrar, target) => {
        if (relayAnnouncedFor === target)
            return;
        relayAnnouncedFor = target;
        void registrar.announce(target);
    };
    // 'off' until a sync pass turns a mode on; the phase listener only feeds
    // the public base while a plugin-managed tunnel (quick or named) runs.
    let tunnelMode = resolved.autoTunnel ? 'quick' : 'off';
    tunnel.onPhase((info) => {
        if (tunnelMode === 'off')
            return;
        if (info.phase === 'running' && info.url !== undefined) {
            rawTunnelUrl = info.url;
            setPublicBase();
            service.setTunnelStatus({ state: 'running', url: info.url });
            const registrar = tunnelMode === 'quick' ? ensureRelayRegistrar() : undefined;
            if (registrar !== undefined)
                announceRelay(registrar, info.url);
            runPostureProbe();
        }
        else if (info.phase === 'starting') {
            // A restart mints a NEW hostname: the previous URL dies with the old
            // process, so clear it now rather than advertising a dead link.
            rawTunnelUrl = undefined;
            relayUrl = undefined;
            setPublicBase();
            service.setTunnelStatus({ state: 'starting' });
        }
        else if (info.phase === 'failed') {
            rawTunnelUrl = undefined;
            setPublicBase();
            service.setTunnelStatus(info.error === undefined ? { state: 'failed' } : { state: 'failed', error: info.error });
        }
    });
    ctx.effect(() => () => {
        disposeRelayRegistrar();
        tunnel.dispose();
    }, 'remote-web-ui: auto tunnel');
    // The bind facts are known by now (webServer is an inject edge): the LAN
    // bases are frozen per process, matching the CLI's once-per-invocation
    // sampling stance. The QR can only advertise addresses the fence accepts;
    // every interface gets its own base URL so a multi-homed machine can pick
    // the network the phone can actually reach.
    // A recompose pass can hand the plugin a webServer whose facts have not
    // settled yet (host unset, port undefined); deriving LAN bases from that
    // would advertise :undefined links or clear a working set, so the bases
    // only update when both facts are readable.
    const bindKnown = (ctx.webServer.host === '0.0.0.0' || ctx.webServer.host === '127.0.0.1')
        && Number.isFinite(ctx.webServer.port);
    if (bindKnown) {
        const lanBases = ctx.webServer.host === '0.0.0.0'
            ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(ctx.webServer.port)}` }))
            : [];
        service.setLanBases(lanBases);
    }
    // Push a committed settings section into the service and gate. The service
    // config object is read per operation (token mint, touch, sweep), and the
    // gate re-reads its fence flag per request, so a live edit takes effect
    // without a restart. When `enabled` turns off, the pairing routes and
    // sweep timer are dropped and all device/token state is revoked, but the
    // gate listener stays mounted so a LAN-exposed /api stays behind pairing
    // (now vetoing every non-loopback request) instead of opening the fence.
    let disposeRoutes;
    let disposeSweep;
    // ── remote update ────────────────────────────────────────────────────────
    // The dsh-web self-update surface: probe the npm registry for family
    // releases and run `pnpm update --latest` in the owning profile. Resolutions
    // anchor on the host process's own module graph, so the update always
    // targets the profile the running web GUI was booted from. The anchor path
    // is re-resolved per operation: pnpm removes the old version's .pnpm
    // directory on update, so a boot-time captured path would fail to read
    // after a successful update; versions are re-read from disk per check.
    const requireFromHost = createRequire(import.meta.url);
    /** Host-process resolve that degrades to "not installed" (undefined) instead of throwing. */
    const hostResolve = (specifier) => {
        try {
            return requireFromHost.resolve(specifier);
        }
        catch {
            return undefined;
        }
    };
    const resolveAnchorPath = () => resolveAnchorManifest(hostResolve);
    const releaseNotesCache = new Map();
    const fetchReleaseNotesCached = async (version) => {
        const cached = releaseNotesCache.get(version);
        if (cached !== undefined && Date.now() - cached.at < RELEASE_NOTES_CACHE_TTL_MS)
            return cached.notes;
        const notes = await fetchGitHubReleaseNotes(version, fetch);
        releaseNotesCache.set(version, { at: Date.now(), notes });
        return notes;
    };
    const updateRoutes = makeUpdateRoutes({
        // Control endpoints are host-surface only: a LAN/phone origin must never
        // trigger a real install on this machine.
        fence: request => isTrustedApiRequest(request, []),
        check: () => checkUpdates({
            anchorManifestPath: resolveAnchorPath(),
            resolve: hostResolve,
            fetchLatest: name => fetchLatestVersion(name, fetch),
            fetchReleaseNotes: fetchReleaseNotesCached,
        }),
        run: async () => {
            const target = resolveUpdateTarget({ anchorManifestPath: resolveAnchorPath() });
            if ('error' in target) {
                const code = target.error;
                return {
                    ok: false,
                    exitCode: null,
                    output: '',
                    error: code === 'not-found' ? 'dsh-web aggregate not installed' : 'local link install — update unavailable',
                    errorCode: code,
                };
            }
            // Verify the versions actually moved after a green pnpm exit: the pnpm
            // 11 minimumReleaseAge gate can silently keep the installed versions
            // (same-day releases), which a plain exit-0 check would report as
            // success — the user then restarts and nothing changed.
            return runUpdateVerified({
                run: { profileDir: target.profileDir, packages: target.packages },
                check: {
                    anchorManifestPath: resolveAnchorPath(),
                    resolve: hostResolve,
                    fetchLatest: name => fetchLatestVersion(name, fetch),
                    fetchReleaseNotes: fetchReleaseNotesCached,
                },
            });
        },
    });
    // LAN-bind facts for the settings card, re-read per request so a hot
    // rebind (the patch watcher recomposes the process) and a fresh toggle
    // round are both reflected without a restart.
    let lastKnownPort;
    let lastFirewallApplied;
    const lanBindStatus = () => {
        const resolvedNow = resolve();
        let state;
        try {
            state = lanBindState(resolvedNow.profile);
        }
        catch {
            // An unsafe profile value must not take the whole status endpoint down.
            state = { blockPresent: false };
        }
        const lanOn = state.host === '0.0.0.0';
        const port = Number.isFinite(ctx.webServer.port) ? ctx.webServer.port : lastKnownPort;
        if (Number.isFinite(ctx.webServer.port))
            lastKnownPort = ctx.webServer.port;
        const startup = ctx.get('webStartup');
        const desiredHost = resolvedNow.lanBind === undefined
            ? undefined
            : desiredBindHost(resolvedNow.lanBind === true, startup?.host);
        return {
            profile: resolvedNow.profile,
            setting: resolvedNow.lanBind ?? null,
            blockHost: state.host ?? null,
            bindHost: ctx.webServer.host,
            port,
            lanUrls: ctx.webServer.host === '0.0.0.0' && port !== undefined
                ? lanIPv4Addresses().map(address => `http://${address}:${String(port)}`)
                : [],
            firewall: port !== undefined ? firewallSummary(port, lanOn) : { ok: true, managed: false },
            platform: process.platform,
            // The running bind does not follow the block on every deployment (the
            // live patch watcher is profile-shape dependent): flag the divergence
            // so the card can ask for a restart instead of looking broken. The
            // comparison uses the effective desired host (a CLI --host wins over
            // the toggle), not the raw toggle.
            pendingRestart: pendingRestartOf(resolvedNow.lanBind, desiredHost, ctx.webServer.host),
        };
    };
    // The process's inner browser credential: the proxied /api re-issues to
    // 127.0.0.1, where the connection route enforces the harness browser-auth
    // cookie (authority-bound; no loopback exemption on this cohort), so a
    // device's own cookie can never satisfy the inner check. The plugin
    // redeems its own launch token once and attaches the cookie to inner
    // requests; the credential is only ever exercised behind the pairing gate
    // in remote-api.ts.
    const innerAuth = createInnerAuth(() => {
        if (!Number.isFinite(ctx.webServer.port))
            return undefined;
        try {
            return ctx.connection.authenticatedUrl?.(`http://127.0.0.1:${String(ctx.webServer.port)}/`);
        }
        catch {
            return undefined;
        }
    });
    // The official index document for the /pair-app landing, fetched from the
    // inner loopback with the process credential and cached briefly (the shell
    // is static; skins/injections settle right after boot).
    const APP_SHELL_TTL_MS = 30_000;
    let appShellCache;
    const fetchAppShell = async () => {
        if (!Number.isFinite(ctx.webServer.port))
            return undefined;
        if (appShellCache !== undefined && Date.now() - appShellCache.at < APP_SHELL_TTL_MS)
            return appShellCache.html;
        const cookie = await innerAuth.ready();
        try {
            const response = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/`, {
                headers: cookie !== undefined ? { cookie } : undefined,
            });
            if (!response.ok)
                return undefined;
            const html = await response.text();
            appShellCache = { at: Date.now(), html };
            return html;
        }
        catch {
            return undefined;
        }
    };
    const routes = [
        ...makeRoutes({
            service,
            requirePairingForLan: () => resolve().requirePairingForLan,
            lanBindStatus,
            indexDocument: fetchAppShell,
            trustedHosts: () => {
                const list = [];
                const envHosts = process.env.DSH_REMOTE_TRUSTED_HOSTS;
                if (typeof envHosts === 'string' && envHosts.trim() !== '') {
                    for (const item of envHosts.split(',')) {
                        const trimmed = item.trim();
                        if (trimmed !== '')
                            list.push(trimmed);
                    }
                }
                const cfgHosts = resolve().trustedHosts;
                if (Array.isArray(cfgHosts)) {
                    for (const item of cfgHosts) {
                        if (typeof item === 'string') {
                            const trimmed = item.trim();
                            if (trimmed !== '')
                                list.push(trimmed);
                        }
                    }
                }
                return list;
            },
        }),
        // The remote desktop channel: policy-gated `/remote` prefix that
        // re-issues fenced paths to loopback (see remote-api.ts). The live
        // requirePairingForLan is re-read per request, same as the gate listener
        // and routes above, so a stale client rewrite on an open-LAN deployment
        // proxies instead of 403ing.
        ...makeRemoteApiRoutes({
            service,
            port: ctx.webServer.port,
            requirePairingForLan: () => resolve().requirePairingForLan,
            auth: innerAuth,
        }),
        ...updateRoutes,
    ];
    const upgrades = makeRemoteApiUpgradeRoutes({
        service,
        port: ctx.webServer.port,
        requirePairingForLan: () => resolve().requirePairingForLan,
        auth: innerAuth,
    });
    const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled);
    ctx.effect(() => ctx.on('api/gate', gate), 'remote-web-ui: api gate');
    // ── posture probe ─────────────────────────────────────────────────────────
    // Guardrail for the one seam this plugin cannot mount a gate into: the
    // connection plugin's /api Host fence. Forged-Host probes against every
    // advertised origin (public base + LAN bases) make a re-opened /api (a
    // re-added --trusted-host, or the SDK's LAN auto-trust under 0.0.0.0)
    // visible on the panel and the log instead of silently trusted.
    let postureKey;
    let postureWasExposed = false;
    const runPostureProbe = () => {
        if (!resolve().enabled)
            return;
        const targets = postureTargets(service.publicBaseUrl, service.lanAddresses, ctx.webServer.port);
        if (targets.length === 0) {
            postureKey = undefined;
            service.setPosture(undefined);
            return;
        }
        const key = targets.join('|');
        const claim = claimPostureKey(postureKey, key);
        if (!claim.run)
            return;
        postureKey = claim.next;
        void probePosture({ port: ctx.webServer.port, targets }).then((snapshot) => {
            service.setPosture(snapshot);
            const exposedHosts = snapshot.hosts.filter(host => host.exposed).map(host => host.host);
            const exposed = exposedHosts.length > 0;
            if (exposed && !postureWasExposed) {
                console.error(`remote-web-ui: CRITICAL — the /api fence is OPEN for [${exposedHosts.join(', ')}]: unpaired clients reach the full host API. Remove --trusted-host for these hosts (pairing covers them) or bind loopback.`);
            }
            else if (!exposed && postureWasExposed) {
                console.log('remote-web-ui: the /api posture probe is clean again (every advertised origin refused with 403).');
            }
            postureWasExposed = exposed;
        }).catch(() => {
            // Keep the previous snapshot; drop the in-flight key so the same
            // targets retry instead of sticking on a failed round.
            postureKey = releasePostureKey(postureKey, key);
        });
    };
    // The first round waits for the connection plugin's /api route: a probe
    // before it mounts would read the SPA fallback and false-positive.
    const initialPostureTimer = nodeSetTimeout(() => { runPostureProbe(); }, 5_000);
    initialPostureTimer.unref();
    ctx.effect(() => () => { clearTimeout(initialPostureTimer); }, 'remote-web-ui: posture probe boot');
    // Sibling plugins (dsh-better-sidebar, …) look this up by name. Absent when this
    // plugin is not installed; stop() / enabled=false still refuse cookies.
    new RemoteWebUiPairing(ctx, (request) => {
        if (!resolve().enabled)
            return false;
        return isPairedDeviceRequest(service, request);
    });
    // Remote-presence to pet-visibility link: while a paired device is online
    // (an active phone mirror), hide the host-global pet through the pet's OWN
    // hide switch; when the last device has been offline for a grace window,
    // show it again (user design; the pet plugin is optional, so the seam is
    // resolved per transition and every failure degrades to a no-op).
    const presencePet = startRemotePresencePet({
        onState: listener => service.onState(listener),
        pet: () => {
            try {
                return ctx.get('pet');
            }
            catch {
                return undefined;
            }
        },
    });
    ctx.effect(() => presencePet, 'remote-web-ui: remote-presence pet visibility');
    if (service.lanAddresses.length > 0) {
        const urls = service.lanAddresses.map(ip => `http://${ip}:${String(ctx.webServer.port)}`).join(' , ');
        console.log(`remote-web-ui: the paired Web GUI is reachable on LAN at ${urls}`);
    }
    // Cohort honesty (see the README security model): the pairing gate covers
    // the plugin's own /remote channel; direct /api from LAN origins is
    // governed by the harness fence + browser-auth cookie, and this cohort's
    // api/gate seam has no emitter — so stop()/revoke() cannot invalidate a
    // browser credential a device has already redeemed.
    if (ctx.webServer.host === '0.0.0.0') {
        console.warn('remote-web-ui: LAN-exposed bind — pairing gates the /remote channel; direct /api stays under the harness fence + browser auth (stop() does not revoke an already-redeemed browser credential)');
    }
    const sync = () => {
        const value = resolve();
        service.config = pairingConfigOf(value);
        // LAN bind toggle: only write the managed patch block once the user has
        // flipped it (undefined = untouched, never write). Desired host/port come
        // from the CLI flags when given (flags win), else from the toggle and
        // the currently bound port. The block takes effect on the next start, so
        // the re-assert at every boot keeps it in sync with both the toggle and
        // the flags.
        if (value.lanBind !== undefined) {
            const startup = ctx.get('webStartup');
            const desiredHost = desiredBindHost(value.lanBind === true, startup?.host);
            const desiredPort = desiredBindPort(startup?.port, Number.isFinite(ctx.webServer.port) ? ctx.webServer.port : undefined);
            if (desiredPort === undefined) {
                console.error('remote-web-ui: cannot assert the lan-bind block — the web server port is not known yet');
            }
            else {
                try {
                    const current = lanBindState(value.profile);
                    if (current.host !== desiredHost || current.port !== desiredPort) {
                        writeLanBind(desiredHost, desiredPort, value.profile);
                        console.log(`remote-web-ui: lan-bind block written for profile ${value.profile} (${desiredHost}:${String(desiredPort)}); it takes effect when the profile next applies (the card reports pendingRestart until the running bind follows)`);
                    }
                }
                catch (error) {
                    console.error(`remote-web-ui: failed to write the lan-bind block: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            // Keep the firewall rule aligned with the toggle (managed platforms
            // only; see firewall.ts). The probes and rule rewrites are blocking
            // subprocesses, so they run only when the desired state actually moved
            // — not on every unrelated settings save. The port is the live bind
            // port; without it there is nothing to align yet.
            const livePort = Number.isFinite(ctx.webServer.port) ? ctx.webServer.port : undefined;
            if (livePort === undefined) {
                console.error('remote-web-ui: cannot align the host firewall rule — the web server port is not known yet');
            }
            else {
                const nextFirewall = { enabled: value.lanBind === true, port: livePort };
                if (firewallActionNeeded(lastFirewallApplied, nextFirewall)) {
                    const ruleOk = nextFirewall.enabled ? ensureFirewallRule(nextFirewall.port) : removeFirewallRule(nextFirewall.port);
                    if (ruleOk) {
                        lastFirewallApplied = nextFirewall;
                    }
                    else {
                        console.error('remote-web-ui: the host firewall rule could not be updated (admin rights required on managed platforms)');
                    }
                }
            }
        }
        // The plugin-managed tunnels own the public base while one runs: the URL
        // lands in the service through the tunnel's phase listener (the minted
        // quick URL, or the named tunnel's fixed public hostname). The manual
        // publicBaseUrl applies only when no tunnel runs.
        const plan = tunnelPlanOf(value, ctx.webServer.port);
        tunnelMode = plan.mode;
        if (plan.mode !== 'quick') {
            // The relay only fronts the quick tunnel; named mode owns its fixed
            // dashboard hostname and the off mode has no public base at all.
            disposeRelayRegistrar();
            if (plan.mode !== 'named')
                setPublicBase();
        }
        else if (value.relay === false) {
            // The relay toggle is off: no stable origin, the raw quick URL is the
            // QR base exactly as before the relay existed.
            disposeRelayRegistrar(true);
            setPublicBase();
        }
        else if (rawTunnelUrl !== undefined) {
            // The relay just turned on (or the registrar is new) while the tunnel
            // already runs: announce now — no phase event will fire for an
            // unchanged target.
            const registrar = ensureRelayRegistrar();
            if (registrar !== undefined)
                announceRelay(registrar, rawTunnelUrl);
        }
        if (plan.mode === 'quick') {
            for (const ignored of plan.ignored) {
                console.warn(`remote-web-ui: autoTunnel is on — ignoring the configured ${ignored}`);
            }
            // With the relay on, the connector stamps the stable origin as the
            // origin-side Host (`--http-host-header`): the plugin fence and the
            // harness browser-auth are Host-bound to the relay origin, and the
            // Workers relay cannot control the origin-side Host (fetch forces it
            // to the URL authority). The target identity change is also what
            // restarts a running tunnel on a relay toggle.
            const registrar = ensureRelayRegistrar();
            const originHostHeader = registrar === undefined ? undefined : new URL(registrar.baseUrl).host;
            tunnel.start(originHostHeader === undefined
                ? plan.targetUrl
                : { kind: 'quick', targetUrl: plan.targetUrl, originHostHeader });
        }
        else if (plan.mode === 'named') {
            tunnel.start({ kind: 'named', token: plan.token, publicUrl: plan.publicUrl });
        }
        else {
            tunnel.stop();
            // A named-tunnel token without a usable public hostname cannot serve
            // the QR: stay off and say exactly what is missing instead of running
            // a tunnel nothing points at.
            if (value.tunnelToken !== undefined && value.tunnelToken !== '') {
                console.warn('remote-web-ui: tunnelToken is set but publicBaseUrl is missing or not a valid URL — fill the fixed public hostname of the named tunnel (e.g. https://dsh.example.com) to run it');
            }
            // A malformed public base is ignored with a warning — LAN-only behavior
            // stays intact rather than silently minting unusable QR links.
            if (value.publicBaseUrl !== undefined && !isHttpUrl(value.publicBaseUrl)) {
                console.warn(`remote-web-ui: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`);
                service.setPublicBaseUrl(undefined);
            }
            else {
                service.setPublicBaseUrl(value.publicBaseUrl);
            }
        }
        const enabled = value.enabled;
        if (!enabled)
            service.stop();
        if (disposeRoutes === undefined && enabled) {
            disposeRoutes = ctx.effect(() => {
                const disposers = [
                    ...routes.map(route => ctx.webServer.register(route)),
                    ...upgrades.map(route => ctx.webServer.registerUpgrade(route)),
                ];
                return () => { for (const dispose of disposers)
                    dispose(); };
            }, 'remote-web-ui: pairing routes');
        }
        else if (disposeRoutes !== undefined && !enabled) {
            disposeRoutes();
            disposeRoutes = undefined;
        }
        if (disposeSweep === undefined && enabled) {
            disposeSweep = ctx.effect(() => {
                const timer = nodeSetInterval(() => { service.sweep(); }, SWEEP_INTERVAL_MS);
                timer.unref();
                return () => { clearInterval(timer); };
            }, 'remote-web-ui: presence sweep');
        }
        else if (disposeSweep !== undefined && !enabled) {
            disposeSweep();
            disposeSweep = undefined;
        }
        // Settings changed the reachable posture (manual publicBaseUrl, bind):
        // re-probe unless the target set is unchanged.
        runPostureProbe();
    };
    // Inject the crypto.randomUUID polyfill before any other script runs, so that
    // the main bundle doesn't crash on non-secure contexts (LAN HTTP)
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'script', placement: 'head', text: UUID_POLYFILL_SCRIPT });
    }), 'remote-web-ui: uuid polyfill');
    // Issue #987: the browser-half channel patch installs at this plugin's
    // boot entry, but dsh-client-connection boots earlier and opens its event
    // streams unrewritten — on a non-loopback origin the SDK fence rejects
    // them and the workspace list never loads. Contribute the rewrite as a
    // parse-time head script so it is active before ANY boot entry runs; the
    // client apply adopts the installed seat instead of patching twice. The
    // row follows the live steady-state decision (enabled + pairing gate); the
    // script itself skips loopback origins.
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
        const value = resolve();
        if (!value.enabled || !value.requirePairingForLan)
            return;
        table.push({ kind: 'script', placement: 'head', text: REMOTE_CHANNEL_BOOT_SCRIPT });
    }), 'remote-web-ui: remote channel boot patch');
    ctx.inject(['settings'], (settingsCtx) => {
        try {
            if (typeof settingsCtx.settings?.installSection === 'function') {
                settingsCtx.settings.installSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
                    setSource: (source) => {
                        current = source;
                        sync();
                    },
                    onChange: sync,
                });
            }
            else if (typeof settingsCtx.settings?.register === 'function') {
                const scope = settingsCtx.settings.register(REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, { base: config ?? {} });
                current = () => scope?.get?.() ?? (config ?? {});
                scope?.watch?.(() => { sync(); });
                sync();
            }
        }
        catch {
            // Defensive fallback against settings registration differences
        }
    });
    sync();
}
