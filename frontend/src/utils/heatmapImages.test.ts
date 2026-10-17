import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseHeatmapImages } from "./heatmapImages";

const XLINK = "http://www.w3.org/1999/xlink";
const SVG = "http://www.w3.org/2000/svg";
const PNG = `data:image/png;base64,${btoa("png bytes")}`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("releaseHeatmapImages", () => {
  let created: string[];
  let revoked: string[];
  let root: HTMLDivElement;

  beforeEach(() => {
    created = [];
    revoked = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:image-${created.length}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
  });

  const addImage = () => {
    const svg = document.createElementNS(SVG, "svg");
    const image = document.createElementNS(SVG, "image") as SVGImageElement;
    svg.appendChild(image);
    root.appendChild(svg);
    return image;
  };

  it("swaps each new data URL for a blob URL and revokes the one before", async () => {
    const release = releaseHeatmapImages(root);
    const image = addImage();

    image.setAttributeNS(XLINK, "xlink:href", PNG);
    await flush();
    expect(image.getAttributeNS(XLINK, "href")).toBe("blob:image-0");

    image.setAttributeNS(XLINK, "xlink:href", PNG);
    await flush();
    expect(image.getAttributeNS(XLINK, "href")).toBe("blob:image-1");
    expect(revoked).toEqual(["blob:image-0"]);

    release();
    expect(revoked).toEqual(["blob:image-0", "blob:image-1"]);
  });

  it("handles a plain href and images that were already drawn", async () => {
    const image = addImage();
    image.setAttribute("href", PNG);
    const release = releaseHeatmapImages(root);
    expect(image.getAttribute("href")).toBe("blob:image-0");
    release();
  });

  it("revokes the blob URL of an image that is removed", async () => {
    const release = releaseHeatmapImages(root);
    const image = addImage();
    image.setAttributeNS(XLINK, "xlink:href", PNG);
    await flush();

    image.parentElement?.remove();
    await flush();
    expect(revoked).toEqual(["blob:image-0"]);
    release();
  });

  it("leaves other images alone", async () => {
    const release = releaseHeatmapImages(root);
    const image = addImage();
    image.setAttributeNS(XLINK, "xlink:href", "logo.svg");
    await flush();
    expect(image.getAttributeNS(XLINK, "href")).toBe("logo.svg");
    expect(created).toEqual([]);
    release();
  });
});
