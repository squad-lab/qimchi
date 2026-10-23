"""
Archive a stable release on Zenodo using metadata from CITATION.cff.

Each release has its own version DOI and shares the project's concept DOI.
The script reads metadata from CITATION.cff, the README copyright line and
the release's CHANGELOG section. It preserves fields not managed by the script,
such as funding, from the previous version.

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
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import yaml

# CITATION.cff has no field for a creator's role or an affiliation's ROR ID.
CREATOR_ROLES = {"0000-0003-1522-7403": "projectleader"}  # Vincent Mourik
AFFILIATION_IDS = {"Forschungszentrum Jülich": "02nv7yv05"}


def read_copyright(readme: Path) -> str | None:
    """Return the README copyright text without "Copyright" or a final period."""
    if not readme.is_file():
        return None
    for line in readme.read_text(encoding="utf-8").splitlines():
        if line.startswith("Copyright ©"):
            return line.removeprefix("Copyright").strip().rstrip(".")
    return None


def _inline(text: str) -> str:
    """Escape Markdown text and convert its links, code and bold to HTML."""
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    return re.sub(
        r"\[([^\]]+)\]\((https?://[^)\s]+)\)",
        lambda m: f'<a href="{html.escape(m[2])}">{m[1]}</a>',
        text,
    )


def release_notes(changelog: Path, version: str) -> str | None:
    """Return the version's CHANGELOG section as HTML, or None if unavailable."""
    if not changelog.is_file():
        return None
    lines = changelog.read_text(encoding="utf-8").splitlines()
    heading = re.compile(rf"^(#+)\s+v?{re.escape(version)}\b")
    start = next((i for i, line in enumerate(lines) if heading.match(line)), None)
    if start is None:
        return None
    level = len(heading.match(lines[start])[1])

    # Parse paragraphs, subheadings and lists. Join wrapped lines.
    blocks: list[str] = []
    for line in lines[start + 1 :]:
        title = re.match(r"^(#+)\s+(.*)", line)
        if title and len(title[1]) <= level:
            break
        if title:
            blocks.append(f"# {title[2]}")
        elif re.match(r"^\s*[-*]\s+", line):
            blocks.append("- " + re.sub(r"^\s*[-*]\s+", "", line))
        elif line.strip().startswith("<!--"):
            continue
        elif line.strip():
            if blocks and blocks[-1] and not blocks[-1].startswith("# "):
                blocks[-1] += " " + line.strip()
            else:
                blocks.append(line.strip())
        else:
            blocks.append("")

    parts: list[str] = []
    items: list[str] = []
    for block in [*blocks, ""]:
        if block.startswith("- "):
            items.append(f"<li>{_inline(block[2:])}</li>")
            continue
        if items:
            parts.append("<ul>" + "".join(items) + "</ul>")
            items = []
        if block.startswith("# "):
            parts.append(f"<p><strong>{_inline(block[2:])}</strong></p>")
        elif block:
            parts.append(f"<p>{_inline(block)}</p>")
    return "".join(parts) or None


def load_record(
    cff_path: Path,
    readme: Path,
    changelog: Path,
    version: str,
    tag: str,
    languages: list[str],
) -> dict[str, Any]:
    """Build the Zenodo record from CITATION.cff, the README and the CHANGELOG."""
    cff = yaml.safe_load(cff_path.read_text(encoding="utf-8"))
    for key in ("title", "abstract", "authors", "license"):
        if not cff.get(key):
            sys.exit(f"{cff_path} has no {key!r}")

    creators = []
    for author in cff["authors"]:
        person: dict[str, Any] = {
            "type": "personal",
            "given_name": author["given-names"],
            "family_name": author["family-names"],
        }
        creator: dict[str, Any] = {"person_or_org": person}
        orcid = (author.get("orcid") or "").rsplit("/", 1)[-1]
        if orcid:
            person["identifiers"] = [{"scheme": "orcid", "identifier": orcid}]
            if orcid in CREATOR_ROLES:
                creator["role"] = {"id": CREATOR_ROLES[orcid]}
        affiliation = author.get("affiliation")
        if affiliation in AFFILIATION_IDS:
            creator["affiliations"] = [{"id": AFFILIATION_IDS[affiliation]}]
        elif affiliation:
            creator["affiliations"] = [{"name": affiliation}]
        creators.append(creator)

    metadata: dict[str, Any] = {
        "resource_type": {"id": "software"},
        "title": cff["title"],
        "description": " ".join(cff["abstract"].split()),
        "creators": creators,
        "version": version,
        "publication_date": dt.date.today().isoformat(),
        "publisher": "Zenodo",
        "rights": [{"id": cff["license"].lower()}],
        "subjects": [{"subject": keyword} for keyword in cff.get("keywords", [])],
        "languages": [{"id": "eng"}],
    }
    copyright_line = read_copyright(readme)
    if copyright_line:
        metadata["copyright"] = copyright_line
    notes = release_notes(changelog, version)
    if notes:
        metadata["additional_descriptions"] = [
            {"description": notes, "type": {"id": "notes"}}
        ]
    custom_fields: dict[str, Any] = {
        "code:developmentStatus": {"id": "active"},
        "code:programmingLanguage": [{"id": language} for language in languages],
    }
    related = []
    repository = cff.get("repository-code")
    if repository:
        custom_fields["code:codeRepository"] = repository
        related.append(
            {
                "identifier": f"{repository.rstrip('/')}/-/tree/{tag}",
                "scheme": "url",
                "relation_type": {"id": "issupplementto"},
                "resource_type": {"id": "software"},
            }
        )
    if cff.get("url"):
        related.append(
            {
                "identifier": cff["url"],
                "scheme": "url",
                "relation_type": {"id": "isdocumentedby"},
            }
        )
    if related:
        metadata["related_identifiers"] = related
    return {
        "metadata": metadata,
        "custom_fields": custom_fields,
        "access": {"record": "public", "files": "public"},
        "files": {"enabled": True},
    }


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
        # The token goes with every request, so never follow a link off Zenodo.
        if not url.startswith(self.api + "/"):
            sys.exit(f"Refusing to send the Zenodo token to {url}")
        headers = {
            "Authorization": f"Bearer {self.token}",
            # Request the InvenioRDM response format.
            "Accept": "application/vnd.inveniordm.v1+json",
            **(headers or {}),
        }
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

    def own_records(self, query: str) -> list[dict[str, Any]]:
        """Return all versions and drafts of the user's records that match the query."""
        found: list[dict[str, Any]] = []
        page = 1
        while True:
            params = urllib.parse.urlencode(
                {"q": query, "allversions": "true", "size": 100, "page": page}
            )
            hits = self.request("GET", f"/user/records?{params}")["hits"]["hits"]
            found.extend(hits)
            if len(hits) < 100:
                return found
            page += 1


def as_input(value: Any) -> Any:
    """
    Convert Zenodo response metadata to the accepted input format.

    Keep only the ID for vocabulary references, such as licenses, affiliations
    and roles. Zenodo rejects expanded fields, such as titles, in update requests.
    """
    if isinstance(value, list):
        return [as_input(item) for item in value]
    if isinstance(value, dict):
        if "id" in value:
            return {"id": value["id"]}
        return {key: as_input(item) for key, item in value.items()}
    return value


def merge_into_draft(draft: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """
    Merge generated metadata into the draft and preserve other fields.

    Replace fields managed by this script. Preserve other metadata, such as
    funding and contributors. Remove the previous release's repository links
    and release notes.
    """
    previous = as_input(draft.get("metadata", {}))
    ours = body["metadata"]
    managed = {r["identifier"] for r in ours.get("related_identifiers", [])}
    repository = body["custom_fields"].get("code:codeRepository") or "\0"
    links = [
        r
        for r in previous.get("related_identifiers", [])
        if r.get("identifier") not in managed
        and not r.get("identifier", "").startswith(repository)
    ]
    descriptions = [
        d
        for d in previous.get("additional_descriptions", [])
        if d.get("type", {}).get("id") != "notes"
    ]
    metadata = {
        **previous,
        **ours,
        "related_identifiers": ours.get("related_identifiers", []) + links,
        "additional_descriptions": ours.get("additional_descriptions", [])
        + descriptions,
    }
    return {
        **body,
        "metadata": metadata,
        "custom_fields": {
            **as_input(draft.get("custom_fields", {})),
            **body["custom_fields"],
        },
        "pids": draft.get("pids", {}),
    }


def find_concept(zenodo: Zenodo, title: str) -> str | None:
    concept = os.environ.get("ZENODO_CONCEPT_ID", "").strip()
    if concept:
        return concept
    titled = zenodo.own_records(f'metadata.title:"{title}"')
    concepts = {
        r["parent"]["id"] for r in titled if r["metadata"].get("title") == title
    }
    if len(concepts) > 1:
        sys.exit(
            f"Several Zenodo records are titled {title!r}: {sorted(concepts)}. Set ZENODO_CONCEPT_ID."
        )
    return concepts.pop() if concepts else None


def open_draft(
    zenodo: Zenodo, concept: str | None, body: dict[str, Any]
) -> dict[str, Any] | None:
    """Return a new or existing draft, or None if this version is already published."""
    if concept is None:
        return zenodo.request("POST", "/records", json_body=body)

    versions = zenodo.own_records(f"parent.id:{concept}")
    version = body["metadata"]["version"]
    published = [r for r in versions if r.get("is_published")]
    for record in published:
        if record["metadata"].get("version") == version:
            print(
                f"Version {version} is already on Zenodo: "
                f"https://doi.org/{record['pids']['doi']['identifier']}"
            )
            return None
    # Reuse an unpublished draft; it blocks creation of a new version.
    for record in versions:
        if not record.get("is_published"):
            return zenodo.request("GET", f"/records/{record['id']}/draft")
    if not published:
        sys.exit(f"Zenodo concept {concept} has no published version to build on")
    latest = max(published, key=lambda r: int(r["id"]))
    return zenodo.request("POST", f"/records/{latest['id']}/versions")


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
    parser.add_argument("--readme", default=Path("README.md"), type=Path)
    parser.add_argument("--changelog", default=Path("CHANGELOG.md"), type=Path)
    parser.add_argument(
        "--language",
        action="append",
        help="Zenodo programming language ID. Repeat for each language. Default: python.",
    )
    args = parser.parse_args()

    if not re.fullmatch(r"v?\d+\.\d+\.\d+", args.tag):
        sys.exit(f"{args.tag} is not a stable release tag; only those are archived")
    version = args.tag.removeprefix("v")
    body = load_record(
        args.cff,
        args.readme,
        args.changelog,
        version,
        args.tag,
        args.language or ["python"],
    )

    if os.environ.get("ZENODO_DRY_RUN") == "1":
        print(json.dumps(body, indent=2, ensure_ascii=False))
        return
    if not args.file:
        sys.exit("Nothing to archive: pass --file")
    missing = [str(path) for path in args.file if not path.is_file()]
    if missing:
        sys.exit(f"Files to archive not found: {', '.join(missing)}")
    token = os.environ.get("ZENODO_TOKEN")
    if not token:
        sys.exit("ZENODO_TOKEN is not set")

    zenodo = Zenodo(os.environ.get("ZENODO_URL", "https://zenodo.org"), token)
    concept = find_concept(zenodo, body["metadata"]["title"])
    draft = open_draft(zenodo, concept, body)
    if draft is None:
        return
    draft_url = f"/records/{draft['id']}/draft"

    # Save the metadata before uploading so retries can find the draft.
    saved = zenodo.request("PUT", draft_url, json_body=merge_into_draft(draft, body))
    # Ignore missing-file errors before uploading.
    # Report other errors. Zenodo checks them again before publication.
    for error in saved.get("errors", []):
        if error.get("field") != "files.enabled":
            print(f"Zenodo warning: {error.get('field')}: {error.get('messages')}")

    # Remove inherited files and incomplete uploads before uploading release files.
    for old in zenodo.request("GET", f"{draft_url}/files").get("entries", []):
        zenodo.request("DELETE", f"{draft_url}/files/{urllib.parse.quote(old['key'])}")
    for path in args.file:
        key = urllib.parse.quote(path.name)
        zenodo.request("POST", f"{draft_url}/files", json_body=[{"key": path.name}])
        with path.open("rb") as fh:
            zenodo.request(
                "PUT",
                f"{draft_url}/files/{key}/content",
                data=fh,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(path.stat().st_size),
                },
            )
        zenodo.request("POST", f"{draft_url}/files/{key}/commit")
        print(f"Uploaded {path.name}")

    record = zenodo.request("POST", f"{draft_url}/actions/publish")

    print(f"Version DOI: https://doi.org/{record['pids']['doi']['identifier']}")
    print(
        f"Concept DOI: https://doi.org/{record['parent']['pids']['doi']['identifier']}"
    )
    if concept is None:
        print(
            "\nThis was the first Zenodo upload. Add the concept DOI to CITATION.cff and the "
            f"README, and set ZENODO_CONCEPT_ID={record['parent']['id']} as a CI/CD variable."
        )


if __name__ == "__main__":
    main()
