import type { AxiosResponse } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadMessage, finishArchiveDownload } from "./download";

const response = (headers: Record<string, string>): AxiosResponse<BlobPart> =>
  ({ data: "zip-bytes", headers }) as unknown as AxiosResponse<BlobPart>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finishArchiveDownload", () => {
  it("reports the path the desktop backend already saved to", () => {
    // In pywebview the backend writes the file itself; the browser download
    // would be a second, broken copy.
    const result = finishArchiveDownload(
      response({ "x-qimchi-saved-to": encodeURIComponent("C:/Users/me/Downloads/run.zip") }),
      "run.zip",
    );

    expect(result.savedTo).toBe("C:/Users/me/Downloads/run.zip");
  });

  it("decodes a path with characters the header could not carry raw", () => {
    // The header is kept ASCII-safe, so it arrives percent-encoded.
    const result = finishArchiveDownload(
      response({ "x-qimchi-saved-to": encodeURIComponent("C:/data/Jülich run.zip") }),
      "run.zip",
    );

    expect(result.savedTo).toBe("C:/data/Jülich run.zip");
  });

  it("falls back to a browser download when the backend did not save", () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...window.URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const result = finishArchiveDownload(response({}), "measurements.zip");

    expect(result.savedTo).toBeUndefined();
    expect(click).toHaveBeenCalledOnce();
    // The object URL is released; leaking one pins the blob in memory.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });

  it("leaves no anchor behind in the document", () => {
    vi.stubGlobal("URL", {
      ...window.URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    finishArchiveDownload(response({}), "measurements.zip");

    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe("downloadMessage", () => {
  it("says when QCoDeS runs were saved as NetCDF", () => {
    const result = finishArchiveDownload(
      response({
        "x-qimchi-saved-to": encodeURIComponent("C:/Downloads/exp_run-5.zip"),
        "x-qimchi-qcodes-runs": "1",
      }),
      "exp_run-5.zip",
    );

    expect(result.qcodesRuns).toBe(1);
    expect(downloadMessage(result)).toBe(
      "Saved to C:/Downloads/exp_run-5.zip. The QCoDeS run is saved as a NetCDF file.",
    );
    expect(downloadMessage({ qcodesRuns: 3 }, "Download started")).toBe(
      "Download started. QCoDeS runs are saved as NetCDF files, one per run.",
    );
  });

  it("adds nothing for other downloads", () => {
    expect(downloadMessage({})).toBeUndefined();
    expect(downloadMessage({}, "Download started")).toBe("Download started");
    expect(downloadMessage({ savedTo: "C:/a.zip" })).toBe("Saved to C:/a.zip");
  });
});
