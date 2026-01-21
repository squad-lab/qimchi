import { Gitlab, Link, ScrollText } from "lucide-react";
import { useSidebarStore } from "../stores/sidebarStore";

const brandingLinks = [
  {
    href: "https://gitlab.com/squad-lab/qimchi/",
    label: "Open Qimchi on GitLab",
    Icon: Gitlab,
  },
  {
    href: "https://squad-lab.org/",
    label: "Visit squad-lab.org",
    Icon: Link,
  },
  {
    href: "https://gitlab.com/squad-lab/qimchi/-/blob/main/LICENSE",
    label: "View Qimchi License",
    Icon: ScrollText,
  },
];

const BrandingFooter = () => {
  const { brandingCollapsed, setBrandingCollapsed } = useSidebarStore();

  return (
    <>
      {!brandingCollapsed && (
        <div className="flex-shrink-0 bg-gradient-to-b from-slate-50 via-white to-slate-100 border-t-2 border-slate-300 shadow-lg">
          <div className="px-6 py-3 space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-5 pb-2 border-b border-slate-200">
                <a
                  href="https://squad-lab.org/"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Visit SQUAD Lab website"
                  className="transition-all duration-200"
                >
                  <img
                    src="/SQUAD-logo-dark.webp"
                    alt="SQUAD Lab logo"
                    className="h-9 sm:h-11 w-auto object-contain filter drop-shadow-sm hover:drop-shadow-md"
                    loading="lazy"
                  />
                </a>
                {/* Vertical Separator */}
                <div className="h-8 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent hidden sm:block" />
                <a
                  href="https://www.fz-juelich.de/"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Visit Forschungszentrum Jülich website"
                  className="transition-all duration-200"
                >
                  <img
                    src="/FZJ-logo.svg"
                    alt="FZJ logo"
                    className="h-8 sm:h-10 w-auto object-contain filter drop-shadow-sm hover:drop-shadow-md"
                    loading="lazy"
                  />
                </a>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-slate-100 to-slate-50 rounded-full border border-slate-200 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="font-bold text-sm text-slate-800 tracking-tight">
                    Qimchi v0.3.3
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {brandingLinks.map(({ href, label, Icon }) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={label}
                      className="p-2.5 rounded-lg bg-blue-50/50 hover:bg-gradient-to-br hover:from-blue-100 hover:to-indigo-100 active:bg-blue-200 transition-all duration-300 text-blue-600 hover:text-blue-700 hover:shadow-md border border-blue-100 hover:border-blue-200"
                    >
                      <Icon size={17} strokeWidth={1.8} />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => setBrandingCollapsed(true)}
            className="w-full py-1.5 text-[9px] uppercase tracking-wider font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 border-t border-slate-200 transition-all duration-200"
            title="Collapse Footer"
          >
            Collapse Footer
          </button>
        </div>
      )}
      {brandingCollapsed && (
        <button
          onClick={() => setBrandingCollapsed(false)}
          className="flex-shrink-0 w-full py-2 text-[9px] uppercase tracking-wider font-medium text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border-t-2 border-slate-300 transition-all duration-200 shadow-sm"
          title="Expand Footer"
        >
          Expand Footer
        </button>
      )}
    </>
  );
};

export default BrandingFooter;
