/**
 * The remote-channel rewrite contract as pure data (issue #987): both the
 * browser patch (client/remote-channel.ts) and the parse-time boot patch
 * (remote-channel-boot.ts, inlined into index.html by the host) decide from
 * these tables, so the two can never drift apart.
 * @module dsh-remote-web-ui-moe4all/remote-channel-rules
 */
/** The gated mirror prefix (must match src/remote-methods.ts). */
export declare const REMOTE_PREFIX = "/remote";
import { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY } from './remote-methods.ts';
export { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY };
/** Connection-plugin method prefix under the gated channel. */
export declare const REMOTE_API_PREFIX = "/remote/api";
/** Every decision input of the remote-channel rewrite, JSON-serializable. */
export interface RemoteChannelRules {
    readonly remotePrefix: string;
    readonly apiPrefix: string;
    readonly pairPrefix: string;
    readonly updatePrefix: string;
    readonly settingsBridgePrefix: string;
    readonly sidebarPrefix: string;
    readonly gitPrefix: string;
    readonly petPrefix: string;
    readonly wsPaths: readonly string[];
    /** Header carrying the cookieless device credential on gated fetches. */
    readonly deviceHeader: string;
    /** sessionStorage key holding the device credential (set by /pair-app). */
    readonly deviceKey: string;
    /** Query parameter carrying it on WebSocket upgrades. */
    readonly deviceQuery: string;
}
/** The live rule set. */
export declare const REMOTE_CHANNEL_RULES: RemoteChannelRules;
/** The window global the boot patch publishes its seat under. */
export declare const REMOTE_CHANNEL_BOOT_GLOBAL = "__DSH_REMOTE_CHANNEL_BOOT__";
/**
 * The seat the parse-time boot patch installs: hook seats the plugin's
 * client apply adopts, a pending-unpaired flag for signals raised before
 * adoption, and restore() retiring the patch (also removes the global).
 */
export interface RemoteChannelBootSeat {
    onUnpaired: (() => void) | null;
    onPaired: (() => void) | null;
    pendingUnpaired: boolean;
    restore(): void;
}
//# sourceMappingURL=remote-channel-rules.d.ts.map