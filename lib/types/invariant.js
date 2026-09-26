/**
 * Package-owned invariant companion for `dsh-remote-web-ui-moe4all`.
 * @module dsh-remote-web-ui-moe4all/invariant
 */
const PACKAGE_NAME = 'dsh-remote-web-ui-moe4all';
/** Cordis companion plugin name. */
export const name = 'remote-web-ui-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this package owns no durable package-local event
 * stream; its route-table and device-session relationships are asserted by
 * the package's own specs (route register/dispose symmetry via the
 * webServer disposer contract, token/revocation semantics on the service).
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
