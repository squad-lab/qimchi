import { Download, PackageCheck } from "lucide-react";

import { useToast } from "../hooks/useToast";
import { useUpdateStore, type UpdateState } from "../stores/updateStore";

const installNote = (platform: UpdateState["platform"]) => {
  switch (platform) {
    case "macos":
      return "Qimchi will close and open the new version's disk image. Drag Qimchi into Applications to replace this version.";
    case "linux":
      return "Qimchi will replace its AppImage and restart, or save the new AppImage to your Downloads folder if it cannot.";
    default:
      return "Qimchi will close while the installer runs. Open it again once the installer finishes.";
  }
};

/** Offers a new desktop release, and asks to install it once it has downloaded. */
const UpdateDialog = () => {
  const { state, download, install, remindAtNextLaunch, dismiss } = useUpdateStore();
  const { showToast } = useToast();

  if (state.prompt === null || !state.tag) return null;
  const ready = state.prompt === "ready";

  const startDownload = async () => {
    await download();
    showToast(
      `Downloading Qimchi ${state.tag} in the background. You'll be asked to install it when it's ready.`,
      "info",
      6000,
      "Updates",
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-gray-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          {ready ? (
            <PackageCheck size={20} className="text-green-600" />
          ) : (
            <Download size={20} className="text-blue-600" />
          )}
          <h2 id="update-dialog-title" className="text-base font-semibold text-gray-900">
            {ready ? `Qimchi ${state.tag} is ready to install` : `Qimchi ${state.tag} is available`}
          </h2>
        </div>
        <p className="text-sm text-gray-500">
          You are running {state.current ?? "an older version"}.{" "}
          {ready
            ? installNote(state.platform)
            : "It downloads in the background, so you can keep working; you'll be asked to install it once it's ready."}
        </p>
        {state.notes && (
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
            {state.notes}
          </pre>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          {ready ? (
            <>
              <button
                type="button"
                onClick={() => void remindAtNextLaunch()}
                className="qimchi-dark-hover-plain rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Remind me at next launch
              </button>
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Install now
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void dismiss()}
                className="qimchi-dark-hover-plain rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void startDownload()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
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
