import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { IconCloseOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from "./remote.module.css";
/** The anchor package name (aggregate first) for copy purposes. */
function anchorName(status) {
    return status?.anchor ?? status?.packages[0]?.name;
}
/** The latest npm release of the anchor, for reference copy. */
function anchorLatest(status) {
    return status?.packages[0]?.latest;
}
/**
 * Render the update panel.
 * @param props - copy, view state, and actions.
 * @returns the panel element tree.
 */
export function UpdatePanel({ t, view, onClose, onRecheck, onStartUpdate }) {
    const status = view.kind === "result" || view.kind === "updating" ? view.status : undefined;
    const title = view.kind === "done" && view.result.ok ? t("update.done") : t("update.title");
    const subtitle = subtitleOf(t, view);
    return (_jsxs("div", { className: css.panel, role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("div", { className: css.header, children: [_jsxs("div", { className: css.heading, children: [_jsx("h2", { className: css.title, children: title }), subtitle !== undefined && _jsx("p", { className: css.subtitle, children: subtitle })] }), _jsx("button", { type: "button", className: css.close, "aria-label": t("update.close"), onClick: onClose, children: _jsx(IconCloseOutline16, {}) })] }), view.kind === "checking" && _jsx("p", { className: css.updateStatus, children: t("update.checking") }), view.kind === "result" && status !== undefined && _jsx(ResultBody, { t: t, status: status }), view.kind === "result" && status !== undefined && status.mode === "npm" && status.outdated && status.error === undefined && (_jsx("div", { className: css.updateActions, children: _jsx("button", { type: "button", className: css.updateRetry, onClick: () => onStartUpdate(status), children: t("update.start") }) })), view.kind === "updating" && status !== undefined && (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.updating", { name: anchorName(status) ?? "", version: anchorLatest(status) ?? "" }) }), _jsx("p", { className: css.updateDetail, children: t("update.cooldownNotice") }), _jsx(PackageSummary, { t: t, status: status })] })), view.kind === "done" && _jsx(DoneBody, { t: t, result: view.result }), view.kind === "error" && (_jsxs("div", { children: [_jsx("p", { className: css.updateError, children: view.message }), view.detail !== undefined && _jsx("pre", { className: css.updateOutput, children: view.detail })] })), (view.kind === "done" || view.kind === "error") && (_jsx("div", { className: css.updateActions, children: _jsxs("button", { type: "button", className: css.updateRetry, onClick: onRecheck, children: [_jsx(IconRefreshOutline16, {}), " ", t("update.retry")] }) }))] }));
}
/** The subtitle copy per view state (absent on plain results). */
function subtitleOf(t, view) {
    switch (view.kind) {
        case "checking":
            return t("update.checking");
        case "updating":
            return t("update.updatingTitle");
        case "result":
            return undefined;
        case "done":
            return view.result.ok ? t("update.doneDetail") : t("update.error");
        case "error":
            // The error body below carries the message; no subtitle duplication.
            return undefined;
    }
}
/** The checked result body: mode banner + version list. */
function ResultBody({ t, status }) {
    const anchor = anchorName(status);
    const latest = anchorLatest(status);
    if (status.mode === "link") {
        return (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.linkMode") }), _jsx("p", { className: css.updateDetail, children: t("update.linkModeDetail", { version: latest ?? "-" }) })] }));
    }
    if (status.mode === "missing") {
        return (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.missing") }), _jsx("p", { className: css.updateDetail, children: t("update.missingDetail") })] }));
    }
    if (status.error === "registry-unreachable") {
        return (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.offline") }), _jsx("p", { className: css.updateDetail, children: t("update.offlineDetail") })] }));
    }
    if (status.outdated) {
        return (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.found") }), _jsx("p", { className: css.updateDetail, children: anchor !== undefined ? t("update.foundDetail", { name: anchor, version: latest ?? "" }) : "" }), _jsx("p", { className: css.updateDetail, children: t("update.cooldownNotice") }), _jsx(PackageSummary, { t: t, status: status })] }));
    }
    return (_jsxs("div", { children: [_jsx("p", { className: css.updateStatus, children: t("update.upToDate") }), anchor !== undefined && latest !== undefined && (_jsx("p", { className: css.updateDetail, children: t("update.upToDateDetail", { name: anchor, version: latest }) })), _jsx(PackageSummary, { t: t, status: status })] }));
}
/** Release-note summary when available; otherwise fall back to the package list. */
function PackageSummary({ t, status }) {
    if (status.notes === undefined)
        return _jsx(PackageList, { status: status });
    return (_jsxs("div", { children: [_jsx(ReleaseNotes, { t: t, notes: status.notes }), _jsxs("details", { className: css.updateVersions, children: [_jsx("summary", { className: css.updateVersionsSummary, children: t("update.componentVersions") }), _jsx(PackageList, { status: status })] })] }));
}
/** Render GitHub Release sections as a compact three-group list. */
function ReleaseNotes({ t, notes }) {
    const sections = [
        { key: 'features', title: t("update.releaseFeatures"), items: notes.features },
        { key: 'fixes', title: t("update.releaseFixes"), items: notes.fixes },
        { key: 'other', title: t("update.releaseOther"), items: notes.other },
    ].filter(section => section.items.length > 0);
    if (sections.length === 0)
        return _jsx("p", { className: css.updateDetail, children: t("update.releaseUnavailable") });
    return (_jsxs("div", { className: css.updateNotes, children: [_jsx("h3", { className: css.updateNotesTitle, children: t("update.releaseNotes", { version: notes.version }) }), sections.map(section => (_jsxs("section", { className: css.updateNoteSection, children: [_jsx("h4", { className: css.updateNoteHeading, children: section.title }), _jsx("ul", { className: css.updateNoteList, children: section.items.map((item, index) => (_jsx("li", { className: css.updateNoteItem, children: item }, index))) })] }, section.key)))] }));
}
/** The per-package current → latest comparison list. */
function PackageList({ status }) {
    if (status.packages.length === 0)
        return null;
    return (_jsx("ul", { className: css.updateList, children: status.packages.map(packageStatus => (_jsxs("li", { className: css.updateListItem, children: [_jsx("span", { className: css.updateListName, children: packageStatus.name }), _jsxs("span", { className: css.updateListVersions, children: [packageStatus.current, packageStatus.latest !== undefined && packageStatus.latest !== packageStatus.current && (_jsxs(_Fragment, { children: [" \u2192 ", packageStatus.latest] }))] })] }, packageStatus.name))) }));
}
/** The outcome body: success + restart hint, or the translated failure. */
function DoneBody({ t, result }) {
    if (result.ok) {
        // The title already reads "Update complete"; the body carries the details.
        return (_jsxs("div", { children: [_jsx("p", { className: css.updateDetail, children: t("update.doneDetail") }), _jsx("p", { className: css.updateDetail, children: t("update.restartHint") })] }));
    }
    const message = errorMessageOf(t, result);
    return (_jsxs("div", { children: [_jsx("p", { className: css.updateError, children: message }), result.output.trim() !== "" && _jsx("pre", { className: css.updateOutput, children: result.output.trim() })] }));
}
/** Translate a structured failure code; fall back to the raw message. */
function errorMessageOf(t, result) {
    switch (result.errorCode) {
        case "pnpm-missing": return t("update.error.pnpmMissing");
        case "timeout": return t("update.error.timeout");
        case "not-found": return t("update.error.notFound");
        case "link": return t("update.error.link");
        case "pnpm-failed": return t("update.error.pnpmFailed", { code: String(result.exitCode ?? "?") });
        case "stale": return t("update.error.stale");
        case "verify-failed": return t("update.error.verifyFailed");
        default: return result.error ?? t("update.error.unknown");
    }
}
