const XLINK = "http://www.w3.org/1999/xlink";

const isSvgImage = (node: Node): boolean =>
  node instanceof Element &&
  node.localName === "image" &&
  node.namespaceURI === "http://www.w3.org/2000/svg";

/**
 * Replace Plotly's PNG data URLs with revocable blob URLs. Chromium retains
 * loaded data URLs, causing live heat-map redraws to leak about 1 MB per second.
 */
export function releaseHeatmapImages(root: HTMLElement): () => void {
  const blobUrls = new Map<Element, string>();

  const swap = (image: Element, namespace: string | null, name: string) => {
    const href = image.getAttributeNS(namespace, "href");
    if (!href?.startsWith("data:image/png;base64,")) return;
    const binary = atob(href.slice(href.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    image.setAttributeNS(namespace, name, url);
    const previous = blobUrls.get(image);
    if (previous) URL.revokeObjectURL(previous);
    blobUrls.set(image, url);
  };

  const swapWithin = (node: Node) => {
    if (!(node instanceof Element)) return;
    const images = isSvgImage(node) ? [node] : node.querySelectorAll("image");
    for (const image of images) {
      if (!isSvgImage(image)) continue;
      if (image.hasAttributeNS(XLINK, "href")) swap(image, XLINK, "xlink:href");
      if (image.hasAttribute("href")) swap(image, null, "href");
    }
  };

  const forgetRemoved = () => {
    for (const [image, url] of blobUrls) {
      if (root.contains(image)) continue;
      URL.revokeObjectURL(url);
      blobUrls.delete(image);
    }
  };

  // attributeFilter cannot match namespaced attributes such as xlink:href.
  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.attributeName === "href" && isSvgImage(record.target)) {
          swap(
            record.target as Element,
            record.attributeNamespace,
            record.attributeNamespace ? "xlink:href" : "href",
          );
        }
      } else {
        record.addedNodes.forEach(swapWithin);
        removed ||= record.removedNodes.length > 0;
      }
    }
    if (removed) forgetRemoved();
  });
  observer.observe(root, { attributes: true, childList: true, subtree: true });
  swapWithin(root);

  return () => {
    observer.disconnect();
    for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    blobUrls.clear();
  };
}
