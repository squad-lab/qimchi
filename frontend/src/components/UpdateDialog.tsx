import { lazy, Suspense, useEffect } from "react";
import { ArrowRight, Download, PackageCheck, X } from "lucide-react";

import { useToast } from "../hooks/useToast";
import { useUpdateStore, type UpdateState } from "../stores/updateStore";
import { themeClasses } from "../theme";

const ReleaseNotes = lazy(() => import("./ReleaseNotes"));

const installNote = (platform: UpdateState["platform"]) => {
  switch (platform) {
    case "macos":
      return "Qimchi will close, install the update, and reopen. If installation fails, the disk image and App Management settings will open.";
    case "linux":
      return "Qimchi will update and restart. If it cannot replace the AppImage, it will save the new one to Downloads.";
    default:
      return "Qimchi will close and open the installer. Complete the setup to restart Qimchi.";
  }
};

const buttonClass =
  "inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors";
const secondaryClass = `${buttonClass} qimchi-dark-hover-plain border border-gray-300 bg-white text-gray-700 hover:bg-gray-100`;
const primaryClass = `${buttonClass} bg-[#6ea030] text-white shadow-sm hover:bg-[#5a8526] focus:outline-none focus:ring-2 ${themeClasses.accentFocusRing}`;

/** Offers a new desktop release, and asks to install it once it has downloaded. */
const UpdateDialog = () => {
  const { state, download, redownload, install, remindAtNextLaunch, dismiss } = useUpdateStore();
  const { showToast } = useToast();

  const open = state.prompt !== null && Boolean(state.tag);
  const ready = state.prompt === "ready";
  const later = ready ? remindAtNextLaunch : dismiss;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") void later();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, later]);

  if (!open) return null;

  const startDownload = async () => {
    await download();
    showToast(
      `Downloading Qimchi ${state.tag} in the background. You'll be asked to install it when it's ready.`,
      "info",
      6000,
      "Updates",
    );
  };

  const Icon = ready ? PackageCheck : Download;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          ready ? `Qimchi ${state.tag} is ready to install` : `Qimchi ${state.tag} is available`
        }
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-4 py-2 ${themeClasses.accentHeaderBg} ${themeClasses.accentBorderLight}`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`rounded-lg border p-1.5 shadow-sm ${themeClasses.accentLightBg} ${themeClasses.accentBorderLight}`}
            >
              <Icon size={20} className={themeClasses.accentIcon} />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-gray-800">
              {ready ? "Update ready to install" : "Update available"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void later()}
            className="rounded-md p-1.5 transition-colors hover:bg-black/10 dark:hover:bg-black/20"
            title={ready ? "Remind me at next launch" : "Not now"}
            aria-label="Close"
          >
            <X size={18} className="text-[#dc2626] dark:text-white" />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-gray-600">
              {state.current ?? "Current version"}
            </span>
            <ArrowRight size={16} className="text-gray-400" />
            <span
              className={`rounded border px-1.5 py-0.5 ${themeClasses.accentLightBg} ${themeClasses.accentBorderLight} ${themeClasses.accentText}`}
            >
              {state.tag}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-600">
            {ready ? (
              <>
                Qimchi {state.tag} is already downloaded. {installNote(state.platform)}
              </>
            ) : (
              <>
                A new version of Qimchi is out. It downloads in the background, so you can keep
                working, and you'll be asked to install it once it's ready.
              </>
            )}
          </p>
          {state.notes ? (
            <div>
              <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-gray-500">
                What's new
              </div>
              <div className="max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <Suspense
                  fallback={
                    <p className="whitespace-pre-wrap text-[0.8125rem] text-gray-700">
                      {state.notes}
                    </p>
                  }
                >
                  <ReleaseNotes notes={state.notes} />
                </Suspense>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Changelog unavailable for this release.</p>
          )}
          {state.error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {state.error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          {ready ? (
            <>
              <button type="button" onClick={() => void redownload()} className={secondaryClass}>
                Download again
              </button>
              <button type="button" onClick={() => void later()} className={secondaryClass}>
                Remind me at next launch
              </button>
              <button type="button" onClick={() => void install()} className={primaryClass}>
                <PackageCheck size={18} />
                Install now
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void later()} className={secondaryClass}>
                Not now
              </button>
              <button type="button" onClick={() => void startDownload()} className={primaryClass}>
                <Download size={18} />
                Download in background
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateDialog;
