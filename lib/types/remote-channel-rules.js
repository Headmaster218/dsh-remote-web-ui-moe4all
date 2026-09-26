/**
 * The remote-channel rewrite contract as pure data (issue #987): both the
 * browser patch (client/remote-channel.ts) and the parse-time boot patch
 * (remote-channel-boot.ts, inlined into index.html by the host) decide from
 * these tables, so the two can never drift apart.
 * @module dsh-remote-web-ui-moe4all/remote-channel-rules
 */
/** The gated mirror prefix (must match src/remote-methods.ts). */
export const REMOTE_PREFIX = '/remote';
import { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY } from "./remote-methods.js";
export { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY };
/** Connection-plugin method prefix under the gated channel. */
export const REMOTE_API_PREFIX = `${REMOTE_PREFIX}/api`;
/** The live rule set. */
export const REMOTE_CHANNEL_RULES = {
    remotePrefix: REMOTE_PREFIX,
    apiPrefix: '/api/',
    pairPrefix: '/api/pair/',
    updatePrefix: '/api/update/',
    settingsBridgePrefix: '/api/dsh-web-ui-settings',
    sidebarPrefix: '/sidebar/',
    gitPrefix: '/git/',
    petPrefix: '/pet/',
    // The official 0.1.2-alpha.2 line opens exactly one stream socket (the
    // Typert gateway mux, /api/remote.mux); the legacy /api/events.* paths
    // were removed by the SDK and stay absent here.
    wsPaths: [
        '/api/remote.mux',
        '/sidebar/ws/terminal',
        '/sidebar/ws/agent-terminals',
        '/api/dsh-ssh/terminal',
    ],
    deviceHeader: REMOTE_DEVICE_HEADER,
    deviceKey: 'dsh-remote-device',
    deviceQuery: REMOTE_DEVICE_QUERY,
};
/** The window global the boot patch publishes its seat under. */
export const REMOTE_CHANNEL_BOOT_GLOBAL = '__DSH_REMOTE_CHANNEL_BOOT__';
