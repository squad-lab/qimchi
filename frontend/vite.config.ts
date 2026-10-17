import { createReadStream, cpSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Bundle MathJax so plot titles work offline.
const mathjaxPlugin = (): Plugin => {
  const require = createRequire(import.meta.url);
  const packageRoot = (name: string) => dirname(require.resolve(`${name}/package.json`));
  const fonts = packageRoot("@mathjax/mathjax-fira-font");
  const core = packageRoot("mathjax");

  // Files requested by the component, its fonts and speech worker.
  const tree: Record<string, string> = {
    "tex-mml-svg-mathjax-fira.js": join(fonts, "tex-mml-svg-mathjax-fira.js"),
    svg: join(fonts, "svg"),
    sre: join(core, "sre"),
  };

  const resolveRequest = (url: string): string | null => {
    const parts = decodeURIComponent(url.split("?")[0]).split("/").filter(Boolean);
    const source = tree[parts[0]];
    if (!source) return null;
    const file = join(source, ...parts.slice(1));
    return file.startsWith(source) ? file : null;
  };

  // Dev serves packages directly; builds copy them into dist.
  const serveFromPackage = (req: { url?: string }, res: any, next: () => void) => {
    const file = resolveRequest(req.url ?? "/");
    if (!file) return next();
    try {
      if (statSync(file).isDirectory()) return next();
    } catch {
      return next();
    }
    res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "text/javascript");
    createReadStream(file).pipe(res);
  };

  return {
    name: "qimchi-mathjax",
    configureServer(server) {
      server.middlewares.use("/mathjax", serveFromPackage);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/mathjax", serveFromPackage);
    },
    writeBundle(options) {
      const outDir = options.dir ?? resolve("dist");
      for (const [target, source] of Object.entries(tree)) {
        cpSync(source, join(outDir, "mathjax", target), { recursive: true });
      }
    },
  };
};

const packageVersion = (): string => {
  try {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const qimchiVersion = (
    env.QIMCHI_VERSION ||
    env.CI_COMMIT_TAG ||
    env.npm_package_version ||
    packageVersion() ||
    "unknown"
  ).replace(/^v/, "");

  return {
    plugins: [
      react(),
      mathjaxPlugin(),
      {
        name: "qimchi-html-version",
        transformIndexHtml: (html: string) => html.replaceAll("%QIMCHI_VERSION%", qimchiVersion),
      },
    ],

    // CHANGELOG.md lives alongside frontend; serve its raw import in development.
    server: { fs: { allow: [resolve("..")] } },

    define: {
      global: "globalThis",
      __QIMCHI_VERSION__: JSON.stringify(qimchiVersion),
    },

    resolve: {
      alias: {
        stream: "stream-browserify",
      },
    },

    build: {
      // Allow a larger single bundle without warnings.
      chunkSizeWarningLimit: 8000,
      // For debug
      // minify: false, // Disables minification for both JavaScript and CSS
    },
  };
});
