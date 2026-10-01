import { Bug, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";

import LogBundlePanel from "./LogBundlePanel";
import Tooltip from "./Tooltip";

const NEW_ISSUE_URL =
  "https://gitlab.com/squad-lab/qimchi/-/issues/new?issuable_template=bug_report";

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BugReportModal = ({ isOpen, onClose }: BugReportModalProps) => {
  const [logsSaved, setLogsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) setLogsSaved(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="bug-report-backdrop"
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report a bug"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-300 bg-white text-xs text-gray-700 shadow-2xl dark:border-[#3e4451] dark:bg-[#282c34] dark:text-[#d7dae0]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 dark:border-[#5c363a] dark:bg-[#342326]">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-red-200 bg-white p-1.5 shadow-sm dark:border-[#5c363a] dark:bg-[#21252b]">
              <Bug size={16} className="text-red-600 dark:text-[#e06c75]" />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-gray-800 dark:text-[#e6e6e6]">
              Report a bug
            </h2>
          </div>
          <Tooltip content="Close" position="bottom">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-100 dark:text-[#e06c75] dark:hover:bg-[#4a292e]"
              aria-label="Close bug report"
            >
              <X size={16} />
            </button>
          </Tooltip>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-[#e6e6e6]">
              Before submitting
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 leading-relaxed text-gray-600 dark:text-[#c7cbd1]">
              <li>Reproduce the problem, then save the logs below.</li>
              <li>Open a new Qimchi issue on GitLab.</li>
              <li>
                Fill out the issue template with steps to reproduce, what you expected, what
                happened, and any useful screenshots or recordings.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-[#e6e6e6]">
                  Attach the logs zip to the issue.
                </strong>
              </li>
              <li>
                If the zip is too large, upload it to a file-sharing service and include an
                accessible link.
              </li>
              <li>Review the report for sensitive measurement file or folder names.</li>
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-[#e6e6e6]">
              Save logs
            </h3>
            <LogBundlePanel onSaveStatusChange={setLogsSaved} />
          </div>
        </div>

        <div className="flex shrink-0 justify-center border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-[#3e4451] dark:bg-[#21252b]">
          <a
            href={NEW_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!logsSaved}
            tabIndex={logsSaved ? 0 : -1}
            onClick={(event) => {
              if (!logsSaved) event.preventDefault();
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold shadow-sm transition-colors ${
              logsSaved
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "cursor-not-allowed bg-gray-200 text-gray-400 shadow-none dark:bg-[#353b45] dark:text-[#828997]"
            }`}
          >
            <ExternalLink size={16} />
            Open a new GitLab issue
          </a>
        </div>
      </div>
    </div>
  );
};

export default BugReportModal;
