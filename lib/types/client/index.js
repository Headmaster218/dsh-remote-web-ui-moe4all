/**
 * Remote control — browser half. Registers the `remote` dictionaries, the
 * sidebar-foot entry (phone trigger + pairing panel + update trigger), and
 * the pair boot flow (accept + presence heartbeats) plus the one-time
 * failed-pair notice. The portrait-touch adaptation of the official UI
 * starts under the plugin lifecycle (startMobileAdapt inside apply) and reverts
 * on dispose, so disabled plugin entries stay inert. Export discipline: packages/client/AGENTS.md — the
 * /client surface carries only what cordis loading needs plus types.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FooterRemoteEntry } from "./FooterRemoteEntry.js";
import { PairFailedNotice } from "./PairFailedNotice.js";
import { RemoteSettingsCard, RemoteSettingsCardController } from "./RemoteSettingsCard.js";
import { en, zh } from "./locales.js";
import { PAIR_FAILED_MARKER, runPairBootFlow } from "./deep-link.js";
import { readPairGatePolicy, sendHeartbeat } from "./pair-api.js";
import { channelTransition, installRemoteChannel, isLoopbackHostname, remoteChannelRequired, REMOTE_CHANNEL_BOOT_GLOBAL, } from "./remote-channel.js";
import { FenceNotice } from "./FenceNotice.js";
import { reportDailyHeartbeat } from "./telemetry.js";
import { startMobileAdapt } from "./mobile-adapt.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'remote';
/** Settings namespace the remote-control card edits (the Host plugin registers it). */
const REMOTE_WEB_UI_NS = 'remote-web-ui';
/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000;
/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote'];
/**
 * Register the remote-control surface.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    // Portrait-touch adaptation of the official UI: installed under the plugin
    // lifecycle so disabling the plugin in cordis patch (disabled: true) never
    // injects mobile CSS, gesture hooks, or the whale floating button.
    startMobileAdapt();
    ctx.effect(() => () => {
        ;
        window.__dshRemoteAdapt?.setEnabled?.(false);
    }, 'remote-web-ui: mobile-adapt');
    // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
    // UTC day, package name only, silent failure.
    reportDailyHeartbeat([{ name: 'dsh-remote-web-ui-moe4all' }]);
    ctx.effect(() => {
        try {
            return ctx.locale.register(NS, { zh, en });
        }
        catch {
            return () => { };
        }
    }, 'remote-web-ui: dictionaries');
    // The mobile adapt's whale button expands the collapsed sidebar and the
    // activation closes the details panel — both through the official layout
    // service (ctx.layout.toggleSidebar / closeDetails flip the panel state;
    // the narrow-viewport semantics open the drawer).
    const layout = ctx.get('layout');
    const adapt = window.__dshRemoteAdapt;
    // The official layout face throws (by contract) when the root entry has
    // not mounted yet; these closures also fire from gestures racing that
    // first mount, so they tolerate the throw instead of surfacing it.
    const layoutCall = (call) => {
        try {
            call?.();
        }
        catch {
            // Boot-order throw: the panel action is a no-op before the root entry.
        }
    };
    if (layout !== undefined && adapt !== undefined) {
        if (typeof layout.toggleSidebar === 'function') {
            adapt.toggleSidebar = () => {
                layoutCall(layout.toggleSidebar);
            };
        }
        if (typeof layout.closeDetails === 'function') {
            adapt.closeDetails = () => {
                layoutCall(layout.closeDetails);
            };
        }
    }
    if (adapt !== undefined && adapt.toggleSidebar === null) {
        // Layout face unavailable (older composition): fall back to clicking the
        // official rail toggle when it exists.
        adapt.toggleSidebar = () => {
            document.querySelector('[class$="_railFish"] button, [class$="_logoRow"] [class*="_iconButton"]')?.click();
        };
    }
    const t = ctx.locale.bind(NS);
    // Hand the `remote` translate seat to the module-scope adaptation layer:
    // the whale/compact-picker labels were rendered with the English fallback
    // before any dictionary existed; the wiring plus the layer's own sync tick
    // re-render them in the active locale.
    if (adapt !== undefined)
        adapt.translate = t;
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope;
    const settingsScope = binder.bind({ namespace: REMOTE_WEB_UI_NS });
    const enabled = () => {
        const snapshot = settingsScope.getSnapshot();
        return snapshot.status === 'ready'
            ? snapshot.value?.enabled ?? true
            : snapshot.status === 'unavailable';
    };
    // Master switch for the adaptation layer: the module-scope install runs
    // before any config is readable, so flip it once the settings snapshot is
    // bound and on every later change (disabled plugin = no injected surface).
    // Also replay the pending closeDetails: the first portrait apply ran
    // before the layout face was wired, so its closeDetails was a no-op and a
    // restored details panel would otherwise sit hidden until landscape.
    const syncAdaptEnabled = () => {
        ;
        window.__dshRemoteAdapt?.setEnabled?.(enabled());
    };
    settingsScope.subscribe(syncAdaptEnabled);
    syncAdaptEnabled();
    // The replay closes a details panel restored before the wiring; the
    // layout face throws while the root entry has not mounted yet (a real
    // boot-order race on slow remote loads), and the plugin's apply world
    // must survive it — the replay is a best-effort no-op then.
    try {
        adapt?.flushCloseDetails?.();
    }
    catch { }
    // Sidebar foot entry: the sidebar foot seat is `sidebar.footer.action` in
    // the 0.1.2 shell composition (the legacy `sidebar.remote` seat is gone
    // upstream). The pairing link is origin-agnostic, so the entry needs no
    // workspace source.
    ctx.slots.inject('sidebar.footer.action', () => {
        let disposeEntry;
        const syncEntry = () => {
            if (enabled() && disposeEntry === undefined) {
                try {
                    disposeEntry = ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-web-ui', locale: NS }, FooterRemoteEntry);
                }
                catch {
                    // ignore registration collision
                }
            }
            else if (!enabled() && disposeEntry !== undefined) {
                disposeEntry();
                disposeEntry = undefined;
            }
        };
        const unsubscribe = settingsScope.subscribe(syncEntry);
        syncEntry();
        return () => {
            unsubscribe();
            disposeEntry?.();
        };
    });
    // Plugin configuration card: one staged form over the `remote-web-ui`
    // settings namespace, contributed to the Web UI plugin group.
    const remoteSettings = new RemoteSettingsCardController(settingsScope);
    ctx.slots.inject('web-ui.plugin.item', () => {
        try {
            const unregister = ctx.slots.register({
                name: 'web-ui.plugin.item',
                id: 'remote-web-ui',
                order: 90,
                locale: NS,
                inject: () => remoteSettings.inject(),
            }, RemoteSettingsCard);
            return () => {
                remoteSettings.dispose();
                unregister();
            };
        }
        catch {
            return () => { };
        }
    });
    // Phone-side boot flow + heartbeats. Loopback pages (the desktop) never
    // heartbeat; the server ignores unpaired heartbeats anyway. Both run only
    // while the plugin is enabled.
    let disposeRuntime;
    const syncRuntime = () => {
        if (enabled() && disposeRuntime === undefined) {
            disposeRuntime = ctx.effect(() => {
                const connection = ctx.get('connection');
                const loopback = connection?.isLoopback ?? true;
                runPairBootFlow(ctx, window.location.search);
                if (loopback)
                    return () => { };
                const timer = window.setInterval(() => { void sendHeartbeat().catch(() => { }); }, HEARTBEAT_INTERVAL_MS);
                return () => { window.clearInterval(timer); };
            }, 'remote-web-ui: pair flow + heartbeats');
        }
        else if (!enabled() && disposeRuntime !== undefined) {
            disposeRuntime();
            disposeRuntime = undefined;
        }
    };
    settingsScope.subscribe(syncRuntime);
    syncRuntime();
    // Remote desktop channel: on a non-loopback origin (LAN address or public
    // tunnel) the connection plugin's /api fence refuses this desktop Web GUI,
    // and pairing is the access control — so the SDK client's /api traffic is
    // rewritten onto this plugin's gated /remote/api prefix (remote-channel.ts)
    // while the fence setting demands it. Loopback origins are untouched.
    let disposeChannel;
    let hostPairingPolicy;
    let unpairedWhilePolicyPending = false;
    let fenceNotice;
    const showFenceNotice = () => {
        if (fenceNotice !== undefined)
            return;
        const node = document.createElement('div');
        document.body.appendChild(node);
        const root = createRoot(node);
        root.render(createElement(FenceNotice, { t, onRetry: () => { window.location.reload(); } }));
        fenceNotice = { unmount: () => { root.unmount(); node.remove(); }, node };
    };
    const hideFenceNotice = () => {
        fenceNotice?.unmount();
        fenceNotice = undefined;
    };
    const handleUnpaired = () => {
        if (settingsScope.getSnapshot().status !== 'ready' && hostPairingPolicy === undefined) {
            unpairedWhilePolicyPending = true;
            return;
        }
        showFenceNotice();
    };
    const channelActive = () => remoteChannelRequired(window.location.hostname, settingsScope.getSnapshot(), hostPairingPolicy);
    // The parse-time boot patch (issue #987), when the served index carried
    // it: already installed before any boot entry ran, so adopting its seat
    // beats patching a second time (which would double-rewrite onto
    // /remote/remote/...).
    const bootSeat = () => window[REMOTE_CHANNEL_BOOT_GLOBAL];
    const syncChannel = () => {
        const transition = channelTransition(channelActive(), disposeChannel !== undefined);
        if (transition === 'install') {
            const seat = bootSeat();
            if (seat !== undefined) {
                seat.onUnpaired = handleUnpaired;
                seat.onPaired = hideFenceNotice;
                // Replay a signal raised before adoption (early unpaired responses).
                if (seat.pendingUnpaired) {
                    seat.pendingUnpaired = false;
                    handleUnpaired();
                }
                disposeChannel = ctx.effect(() => () => {
                    seat.onUnpaired = null;
                    seat.onPaired = null;
                }, 'remote-web-ui: remote desktop channel (boot patch)');
            }
            else {
                disposeChannel = ctx.effect(() => {
                    const restore = installRemoteChannel(window, { onUnpaired: handleUnpaired, onPaired: hideFenceNotice });
                    return restore;
                }, 'remote-web-ui: remote desktop channel');
            }
        }
        else if (transition === 'retire' && disposeChannel !== undefined) {
            disposeChannel();
            disposeChannel = undefined;
            // Retire the provisional parse-time install with the channel: the
            // desktop now rides plain /api, so the rewrite must go (its seat
            // removes the global; a later re-activation patches afresh).
            bootSeat()?.restore();
            // Retire the notice with the channel: once requirePairingForLan turns
            // off (or the plugin is disabled) the desktop rides plain /api again,
            // so an unpaired notice raised while the channel was briefly active
            // (the settings snapshot loads after boot) must not outlive it. The
            // installed channel is the only path that raises the notice, so with
            // the channel gone nothing can re-raise it (issue #808).
            hideFenceNotice();
        }
        else if (transition === 'none' && !channelActive()) {
            // The channel was never adopted (policy settled to off before apply
            // ran): the provisional boot patch still retires.
            bootSeat()?.restore();
        }
    };
    settingsScope.subscribe(syncChannel);
    syncChannel();
    if (!isLoopbackHostname(window.location.hostname) && settingsScope.getSnapshot().status !== 'ready') {
        void readPairGatePolicy().then((policy) => {
            hostPairingPolicy = policy.requirePairingForLan;
            syncChannel();
            if (hostPairingPolicy && unpairedWhilePolicyPending)
                showFenceNotice();
            unpairedWhilePolicyPending = false;
        }).catch(() => {
            // Fail closed when the policy endpoint is unavailable or malformed.
            hostPairingPolicy = true;
            syncChannel();
            if (unpairedWhilePolicyPending)
                showFenceNotice();
            unpairedWhilePolicyPending = false;
        });
    }
    // One-time failed-pair toast. The accept result lands asynchronously, so
    // the marker check is deferred past the accept round trip.
    ctx.effect(() => {
        const timer = window.setTimeout(() => {
            if (sessionStorage.getItem(PAIR_FAILED_MARKER) === null)
                return;
            sessionStorage.removeItem(PAIR_FAILED_MARKER);
            const mount = document.createElement('div');
            document.body.appendChild(mount);
            const root = createRoot(mount);
            root.render(createElement(PairFailedNotice, { t }));
            // The toast owns its dismissal; the root lives for the page lifetime.
            void root;
        }, 1500);
        return () => { window.clearTimeout(timer); };
    }, 'remote-web-ui: failed-pair notice');
}
