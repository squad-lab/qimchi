"""
Generate license notices for Qimchi's bundled dependencies.

Run with the build's Python environment (backend/.venv) after
`npm install` in frontend/:

    backend/.venv/bin/python scripts/third_party_notices.py [--output PATH]

Lists installed runtime dependencies of qimchi-api[datasets] and the desktop
launcher, which vary by platform, plus the frontend's production dependencies.

"""

from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
import sys
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

REPO = Path(__file__).resolve().parent.parent
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|notice)", re.IGNORECASE)

# Desktop launcher dependencies in addition to qimchi-api[datasets].
DESKTOP_ROOTS = ["uvicorn", "pywebview", "pythonnet", "pygobject"]


@dataclass
class Component:
    name: str
    version: str
    license: str
    url: str = ""
    texts: list[str] = field(default_factory=list)


UNKNOWN = "see license text"


def _guess(text: str) -> str:
    if "Permission is hereby granted, free of charge" in text:
        return "MIT"
    if "Apache License" in text and "Version 2.0" in text:
        return "Apache-2.0"
    if "Redistribution and use in source and binary forms" in text:
        return "BSD-3-Clause" if "Neither the name" in text else "BSD-2-Clause"
    if "Permission to use, copy, modify, and/or distribute" in text:
        return "ISC"
    return UNKNOWN


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace").strip()


def _python_license(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    if meta.get("License-Expression"):
        return meta["License-Expression"]
    classifiers = [
        c.split(" :: ")[-1]
        for c in meta.get_all("Classifier") or []
        if c.startswith("License :: ")
    ]
    if classifiers:
        return " / ".join(classifiers)
    text = (meta.get("License") or "").strip()
    if "\n" in text:
        return _guess(text)
    return text or UNKNOWN


def _python_url(dist: metadata.Distribution) -> str:
    urls = dict(
        u.split(", ", 1)
        for u in dist.metadata.get_all("Project-URL") or []
        if ", " in u
    )
    for key in ("Source", "Source Code", "Repository", "Homepage", "homepage"):
        if key in urls:
            return urls[key]
    return dist.metadata.get("Home-page") or f"https://pypi.org/project/{dist.name}/"


def python_components() -> list[Component]:
    roots = [("qimchi-api", {"datasets"})] + [(r, set()) for r in DESKTOP_ROOTS]
    seen: dict[str, tuple[metadata.Distribution, set[str]]] = {}
    stack = list(roots)
    while stack:
        name, extras = stack.pop()
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue  # Skip packages not installed on this platform.
        key = canonicalize_name(name)
        if key in seen and extras <= seen[key][1]:
            continue
        extras = extras | (seen[key][1] if key in seen else set())
        seen[key] = (dist, extras)
        for spec in dist.requires or []:
            req = Requirement(spec)
            environments = [{"extra": e} for e in extras] or [{"extra": ""}]
            if req.marker and not any(req.marker.evaluate(e) for e in environments):
                continue
            stack.append((req.name, set(req.extras)))

    components = []
    for key, (dist, _) in seen.items():
        if key == "qimchi-api":
            continue
        texts = [
            _read(Path(dist.locate_file(f)))
            for f in dist.files or []
            if ".dist-info" in str(f) and LICENSE_FILE.match(Path(str(f)).name)
        ]
        # Older packages put the whole license text in the License field.
        full_text = (dist.metadata.get("License") or "").strip()
        if not texts and "\n" in full_text:
            texts = [full_text]
        components.append(
            Component(
                dist.metadata["Name"],
                dist.version,
                _python_license(dist),
                _python_url(dist),
                texts,
            )
        )
    return components


def javascript_components() -> list[Component]:
    frontend = REPO / "frontend"
    out = subprocess.run(
        "npm ls --omit=dev --all --parseable --long",
        cwd=frontend,
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    components: dict[str, Component] = {}
    for line in out.splitlines():
        path_str, _, ident = line.rpartition(":")
        path = Path(path_str)
        if path == frontend or "@" not in ident.lstrip("@"):
            continue
        manifest = json.loads((path / "package.json").read_text(encoding="utf-8"))
        name, version = manifest["name"], manifest["version"]
        lic = manifest.get("license") or manifest.get("licenses") or UNKNOWN
        if isinstance(lic, dict):
            lic = lic.get("type", UNKNOWN)
        if isinstance(lic, list):
            lic = " OR ".join(
                x.get("type", "?") if isinstance(x, dict) else x for x in lic
            )
        repo = manifest.get("repository")
        url = repo.get("url", "") if isinstance(repo, dict) else repo or ""
        url = re.sub(r"^git\+|\.git$", "", url).replace("git://", "https://")
        if url.startswith("github:") or re.fullmatch(r"[\w.-]+/[\w.-]+", url):
            url = "https://github.com/" + url.removeprefix("github:")
        texts = [
            _read(f)
            for f in sorted(path.iterdir())
            if f.is_file() and LICENSE_FILE.match(f.name)
        ]
        components[f"{name}@{version}"] = Component(
            name, version, lic, url or f"https://www.npmjs.com/package/{name}", texts
        )
    return list(components.values())


def other_components() -> list[Component]:
    licenses = REPO / "packaging" / "licenses"
    python_license = next(
        (
            p
            for p in (
                Path(sys.base_prefix) / "LICENSE.txt",
                Path(sys.base_prefix)
                / "lib"
                / f"python{sys.version_info.major}.{sys.version_info.minor}"
                / "LICENSE.txt",
            )
            if p.is_file()
        ),
        None,
    )
    components = [
        Component(
            "Python",
            sys.version.split()[0],
            "PSF-2.0",
            "https://www.python.org/",
            [_read(python_license)] if python_license else [],
        ),
        Component(
            "fd",
            "latest release at build time",
            "MIT OR Apache-2.0 (used under MIT)",
            "https://github.com/sharkdp/fd",
            [_read(licenses / "fd-LICENSE-MIT")],
        ),
    ]
    try:
        # The desktop build ships PyInstaller's bootloader.
        pyinstaller = metadata.distribution("pyinstaller")
    except metadata.PackageNotFoundError:
        return components
    texts = [
        _read(Path(pyinstaller.locate_file(f)))
        for f in pyinstaller.files or []
        if ".dist-info" in str(f) and LICENSE_FILE.match(Path(str(f)).name)
    ]
    components.append(
        Component(
            "PyInstaller bootloader",
            pyinstaller.version,
            "GPL-2.0-or-later WITH Bootloader-exception",
            "https://pyinstaller.org/",
            texts,
        )
    )
    return components


def render(sections: list[tuple[str, list[Component]]]) -> str:
    lines = [
        "# Third-party notices",
        "",
        "<!-- Generated by scripts/third_party_notices.py. Do not edit by hand. -->",
        "",
        "Qimchi is Copyright © 2024–2026 Forschungszentrum Jülich GmbH, PGI-11, and is "
        "licensed under the AGPL-3.0-or-later (see LICENSE). It includes the third-party "
        "software listed below, each under its own license. The license texts follow the "
        "lists; components with identical texts share one entry.",
        "",
        "The desktop app downloads Google Chrome for Testing on first use of image export, "
        "when no Chrome is installed. It is not part of Qimchi and is used under Google's terms.",
        "",
        f"This list was generated on {platform.system()}. Some Python packages differ by "
        "platform, and each desktop app carries the list for its own platform.",
        "",
    ]
    texts: dict[str, list[str]] = {}
    without_text: list[Component] = []
    for title, components in sections:
        lines += [
            f"## {title}",
            "",
            "| Component | Version | License |",
            "|---|---|---|",
        ]
        for c in sorted(components, key=lambda c: c.name.lower()):
            if c.license == UNKNOWN and c.texts:
                c.license = _guess(c.texts[0])
            if not c.texts:
                without_text.append(c)
            label = f"[{c.name}]({c.url})" if c.url else c.name
            lines.append(f"| {label} | {c.version} | {c.license.replace('|', '/')} |")
            for text in c.texts:
                texts.setdefault(text, []).append(f"{c.name} {c.version}")
        lines.append("")
    lines += ["## License texts", ""]
    for text, users in sorted(texts.items(), key=lambda kv: kv[1][0].lower()):
        lines += [
            f"### {', '.join(users)}",
            "",
            "```text",
            text.replace("```", "'''"),
            "```",
            "",
        ]
    if without_text:
        lines += [
            "### Components without a license file",
            "",
            "These packages ship no license file. The license named is the one their "
            "metadata declares.",
            "",
        ]
        lines += [f"- {c.name} {c.version}: {c.license}" for c in without_text]
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=REPO / "THIRD_PARTY_NOTICES.md")
    args = parser.parse_args()
    sections = [
        ("Python packages", python_components()),
        (
            "JavaScript packages (bundled into the web interface)",
            javascript_components(),
        ),
        ("Other components", other_components()),
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(sections), encoding="utf-8", newline="\n")
    counts = ", ".join(f"{len(c)} {t.split(' ')[0]}" for t, c in sections)
    print(f"Wrote {args.output} ({counts})")


if __name__ == "__main__":
    main()
