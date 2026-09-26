/**
 * Deployment posture probe: verify that the connection plugin's `/api` fence
 * actually refuses non-loopback requests for every origin this deployment
 * advertises (the public tunnel host, the LAN bases). The fence is the SDK's
 * own Host check — the one seam a plugin cannot mount a gate into — so this
 * probe is the guardrail that makes a re-opened `/api` (for example a
 * re-added `--trusted-host`, or the SDK's LAN-literal auto-trust under
 * `--host 0.0.0.0`) visible instead of silent.
 *
 * The probe issues loopback requests with a forged Host header — the exact
 * shape a tunnel or LAN client produces — and treats anything other than a
 * 403 as exposed: the fence is documented to refuse with 403, so any other
 * status means the request reached the RPC bridge.
 */
import type { ClientRequest, ClientRequestArgs } from 'node:http';
/** One probed origin. */
export interface PostureHost {
    /** The forged Host header value that was probed. */
    host: string;
    /** True when the probe reached past the fence (anything but 403). */
    exposed: boolean;
}
/** One probe round. */
export interface PostureSnapshot {
    /** When the round completed (epoch ms). */
    checkedAt: number;
    /** Every probed origin and its verdict. */
    hosts: PostureHost[];
}
/** Whether any probed origin is currently exposed. */
export declare function anyExposed(snapshot: PostureSnapshot): boolean;
/**
 * Build the forged Host values to probe: the public base authority (host or
 * host:port as written in the URL) plus every LAN base literal.
 * @param publicBaseUrl - the configured public base URL (or undefined).
 * @param lanAddresses - the LAN interface addresses the QR advertises.
 * @param port - the local webServer port (LAN hosts are probed as host:port).
 * @returns Host header values, de-duplicated.
 */
export declare function postureTargets(publicBaseUrl: string | undefined, lanAddresses: string[], port: number): string[];
/** Injectable transport seam (defaults to node:http). */
export type ProbeRequest = (options: ClientRequestArgs, onStatus: (status: number) => void) => ClientRequest;
/** Probe options. */
export interface ProbePostureOptions {
    /** The local webServer port. */
    port: number;
    /** Forged Host header values (see {@link postureTargets}). */
    targets: string[];
    /** Transport seam (defaults to node:http). */
    request?: ProbeRequest;
    /** Per-host timeout (default 3000 ms). */
    timeoutMs?: number;
    /** Clock seam (default Date.now). */
    now?: () => number;
}
/**
 * Run one posture probe round.
 * @returns the snapshot for this round.
 */
export declare function probePosture(options: ProbePostureOptions): Promise<PostureSnapshot>;
/**
 * Reserve an advertised-target key so a second trigger with the same set
 * does not overlap an in-flight round. Pair with {@link releasePostureKey}
 * on failure — otherwise that key never retries.
 */
export declare function claimPostureKey(current: string | undefined, key: string): {
    run: boolean;
    next: string;
};
/**
 * Drop a failed in-flight key so the next trigger re-probes the same targets.
 * A newer key that started meanwhile is left alone.
 */
export declare function releasePostureKey(current: string | undefined, attempted: string): string | undefined;
//# sourceMappingURL=posture.d.ts.map