import { useUpdateStore } from "../stores/updateStore";

const buttonClass =
  "rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = `${buttonClass} bg-blue-600 text-white hover:bg-blue-700`;
const secondaryClass = `${buttonClass} qimchi-dark-hover-plain border border-gray-300 text-gray-700 hover:bg-gray-100`;

const formatCheckedAt = (checkedAt: string | null) =>
  checkedAt
    ? new Date(checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

/** Settings > Updates: the running version, and checking, downloading and installing on demand. */
const UpdatesPanel = () => {
  const { state, check, download, install } = useUpdateStore();
  const busy = ["checking", "downloading", "installing"].includes(state.status);
  const percent = Math.round(state.progress * 100);
  const checkedAt = formatCheckedAt(state.checkedAt);

  let summary: React.ReactNode;
  switch (state.status) {
    case "checking":
      summary = "Checking for updates…";
      break;
    case "none":
      summary = "Qimchi is up to date.";
      break;
    case "available":
      summary = `Qimchi ${state.tag} is available.`;
      break;
    case "downloading":
      summary = `Downloading Qimchi ${state.tag}… ${percent}%`;
      break;
    case "downloaded":
      summary = `Qimchi ${state.tag} is downloaded and ready to install.`;
      break;
    case "installing":
      summary = `Installing Qimchi ${state.tag}…`;
      break;
    case "error":
      summary = <span className="text-red-600">{state.error ?? "The update failed."}</span>;
      break;
    default:
      summary = "Check whether a newer version of Qimchi is available.";
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-700">
            Qimchi {state.current ?? __QIMCHI_VERSION__}
          </div>
          <div className="mt-0.5 text-xs text-gray-500" role="status">
            {summary}
          </div>
          {checkedAt && state.status !== "checking" && (
            <div className="mt-0.5 text-[11px] text-gray-400">Last checked {checkedAt}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {state.status === "available" && (
            <button type="button" onClick={() => void download()} className={primaryClass}>
              Download
            </button>
          )}
          {state.status === "downloaded" && (
            <button type="button" onClick={() => void install()} className={primaryClass}>
              Install now
            </button>
          )}
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy}
            className={secondaryClass}
          >
            Check for updates
          </button>
        </div>
      </div>
      {state.status === "downloading" && (
        <div
          role="progressbar"
          aria-label="Update download"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-3 h-1.5 overflow-hidden rounded bg-gray-200"
        >
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {state.status === "downloaded" && (
        <p className="mt-2 text-xs text-gray-500">
          Qimchi closes to install the update. Not now? It will ask again the next time Qimchi
          starts.
        </p>
      )}
    </div>
  );
};

export default UpdatesPanel;
