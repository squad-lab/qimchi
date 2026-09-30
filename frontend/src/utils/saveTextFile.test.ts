import { afterEach, describe, expect, it, vi } from "vitest";

import { saveTextFile } from "./saveTextFile";

afterEach(() => {
  delete window.pywebview;
  vi.restoreAllMocks();
});

describe("saveTextFile", () => {
  it("uses the desktop app's save dialog when there is one", async () => {
    const save_text_file = vi.fn().mockResolvedValue("C:/Users/me/settings.json");
    window.pywebview = { api: { save_text_file } } as unknown as typeof window.pywebview;

    await expect(saveTextFile("settings.json", "{}")).resolves.toBe("C:/Users/me/settings.json");
    expect(save_text_file).toHaveBeenCalledWith("settings.json", "{}");
  });

  it("downloads the file in a browser", async () => {
    URL.createObjectURL = vi.fn(() => "blob:settings");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(saveTextFile("settings.json", "{}")).resolves.toBeNull();

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("settings.json");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:settings");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
