import { useEffect, useRef } from "react";

type MathJaxApi = {
  startup?: { promise?: Promise<unknown> };
  tex2svgPromise?: (tex: string, options?: { display?: boolean }) => Promise<Element>;
};

const mathJax = () => (window as unknown as { MathJax?: MathJaxApi }).MathJax;

/** Render TeX with MathJax, retaining fallback text until rendering succeeds. */
const TexMath = ({
  tex,
  fallback,
  display = false,
}: {
  tex: string;
  fallback: string;
  display?: boolean;
}) => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const render = async () => {
      const api = mathJax();
      // Before startup, window.MathJax contains configuration only.
      if (!api?.tex2svgPromise) {
        if (attempts++ < 50) timer = window.setTimeout(render, 200);
        return;
      }
      try {
        await api.startup?.promise;
        const node = await api.tex2svgPromise(tex, { display });
        // MathJax's container is a block; inline math has to sit in the text.
        if (!display && node instanceof HTMLElement) {
          node.style.display = "inline-block";
          node.style.margin = "0";
        }
        // The wrapper carries the accessible text; the SVG is only a picture.
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
        if (!cancelled && ref.current) ref.current.replaceChildren(node);
      } catch {
        // Keep the fallback text if MathJax fails.
      }
    };
    void render();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tex, display]);

  return (
    <span ref={ref} role="math" aria-label={fallback}>
      {fallback}
    </span>
  );
};

export default TexMath;
