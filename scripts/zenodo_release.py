"""
Archive a stable release on Zenodo using metadata from CITATION.cff.

Each release has its own version DOI and shares the project's concept DOI.

    python scripts/zenodo_release.py --tag v1.2.3 --file source.zip

Environment:
    ZENODO_TOKEN        personal access token (deposit:write, deposit:actions)
    ZENODO_URL          default https://zenodo.org (https://sandbox.zenodo.org to test)
    ZENODO_CONCEPT_ID   existing concept record ID; if unset, search the user's
                        uploads by title or create a record if none match
    ZENODO_DRY_RUN=1    print the metadata and stop, without network access

Requires PyYAML.

"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import yaml


def load_metadata(cff_path: Path, version: str, tag: str) -> dict[str, Any]:
    cff = yaml.safe_load(cff_path.read_text(encoding="utf-8"))
    for key in ("title", "abstract", "authors", "license"):
        if not cff.get(key):
            sys.exit(f"{cff_path} has no {key!r}")

    creators = []
    for author in cff["authors"]:
        creator: dict[str, str] = {
            "name": f"{author['family-names']}, {author['given-names']}"
        }
        if author.get("affiliation"):
            creator["affiliation"] = author["affiliation"]
        if author.get("orcid"):
            creator["orcid"] = author["orcid"].rsplit("/", 1)[-1]
        creators.append(creator)

    metadata: dict[str, Any] = {
        "upload_type": "software",
        "title": cff["title"],
        "description": cff["abstract"],
        "creators": creators,
        "version": version,
        "publication_date": dt.date.today().isoformat(),
        "license": cff["license"].lower(),
        "keywords": cff.get("keywords", []),
    }
    repository = cff.get("repository-code")
    if repository:
        metadata["related_identifiers"] = [
            {
                "identifier": f"{repository.rstrip('/')}/-/tree/{tag}",
                "relation": "isSupplementTo",
                "resource_type": "software",
            }
        ]
    return metadata


class Zenodo:
    def __init__(self, base_url: str, token: str) -> None:
        self.api = base_url.rstrip("/") + "/api"
        self.token = token

    def request(
        self,
        method: str,
        url: str,
        *,
        json_body: Any = None,
        data: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        if not url.startswith("http"):
            url = self.api + url
        headers = {"Authorization": f"Bearer {self.token}", **(headers or {})}
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                body = resp.read()
        except urllib.error.HTTPError as err:
            sys.exit(
                f"{method} {url} failed with {err.code}: {err.read().decode(errors='replace')}"
            )
        return json.loads(body) if body else None

    def own_depositions(self) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self.request(
                "GET", f"/deposit/depositions?size=100&page={page}&sort=mostrecent"
            )
            found.extend(batch)
            if len(batch) < 100:
                return found
            page += 1


def find_concept(depositions: list[dict[str, Any]], title: str) -> str | None:
    concept = os.environ.get("ZENODO_CONCEPT_ID", "").strip()
    if concept:
        return concept
    concepts = {
        str(d["conceptrecid"])
        for d in depositions
        if d.get("title") == title and d.get("conceptrecid")
    }
    if len(concepts) > 1:
        sys.exit(
            f"Several Zenodo records are titled {title!r}: {sorted(concepts)}. Set ZENODO_CONCEPT_ID."
        )
    return concepts.pop() if concepts else None


def open_draft(
    zenodo: Zenodo, depositions: list[dict[str, Any]], concept: str | None, version: str
) -> dict[str, Any] | None:
    """Return a new or existing draft, or None if this version is already published."""
    if concept is None:
        return zenodo.request("POST", "/deposit/depositions", json_body={})

    versions = [d for d in depositions if str(d.get("conceptrecid")) == concept]
    for d in versions:
        if d.get("submitted") and d.get("metadata", {}).get("version") == version:
            print(f"Version {version} is already on Zenodo: https://doi.org/{d['doi']}")
            return None
    # Reuse an unpublished draft; it blocks creation of a new version.
    for d in versions:
        if not d.get("submitted"):
            return zenodo.request("GET", f"/deposit/depositions/{d['id']}")

    published = [d for d in versions if d.get("submitted")]
    if not published:
        # Fall back to the public record if no published deposition was listed.
        published = [{"id": zenodo.request("GET", f"/records/{concept}")["id"]}]
    latest = max(published, key=lambda d: int(d["id"]))
    created = zenodo.request(
        "POST", f"/deposit/depositions/{latest['id']}/actions/newversion"
    )
    return zenodo.request("GET", created["links"]["latest_draft"])


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--tag", required=True, help="release tag, e.g. v1.2.3")
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        type=Path,
        help="file to archive (repeatable)",
    )
    parser.add_argument("--cff", default=Path("CITATION.cff"), type=Path)
    args = parser.parse_args()

    if not re.fullmatch(r"v?\d+\.\d+\.\d+", args.tag):
        sys.exit(f"{args.tag} is not a stable release tag; only those are archived")
    version = args.tag.removeprefix("v")
    metadata = load_metadata(args.cff, version, args.tag)

    if os.environ.get("ZENODO_DRY_RUN") == "1":
        print(json.dumps(metadata, indent=2, ensure_ascii=False))
        return
    if not args.file:
        sys.exit("Nothing to archive: pass --file")
    token = os.environ.get("ZENODO_TOKEN")
    if not token:
        sys.exit("ZENODO_TOKEN is not set")

    zenodo = Zenodo(os.environ.get("ZENODO_URL", "https://zenodo.org"), token)
    depositions = zenodo.own_depositions()
    concept = find_concept(depositions, metadata["title"])
    draft = open_draft(zenodo, depositions, concept, version)
    if draft is None:
        return

    # Save the title before uploading so retries can find the draft.
    zenodo.request(
        "PUT", f"/deposit/depositions/{draft['id']}", json_body={"metadata": metadata}
    )
    # Remove inherited files before uploading the release files.
    for old in draft.get("files", []):
        zenodo.request("DELETE", old["links"]["self"])
    for path in args.file:
        with path.open("rb") as fh:
            zenodo.request(
                "PUT",
                f"{draft['links']['bucket']}/{path.name}",
                data=fh,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(path.stat().st_size),
                },
            )
        print(f"Uploaded {path.name}")

    record = zenodo.request(
        "POST", f"/deposit/depositions/{draft['id']}/actions/publish"
    )

    print(f"Version DOI: https://doi.org/{record['doi']}")
    print(f"Concept DOI: https://doi.org/{record['conceptdoi']}")
    if concept is None:
        print(
            "\nThis was the first Zenodo upload. Add the concept DOI to CITATION.cff and the "
            f"README, and set ZENODO_CONCEPT_ID={record['conceptrecid']} as a CI/CD variable."
        )


if __name__ == "__main__":
    main()
