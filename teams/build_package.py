#!/usr/bin/env python3
"""Builds the Teams app package (a zip with manifest.json and two icons).

Usage:
  python3 teams/build_package.py --client-id <Application (client) ID> --host <site hostname>

Example:
  python3 teams/build_package.py \
    --client-id 00000000-0000-0000-0000-000000000000 \
    --host victorious-coast-06011241e.3.azurestaticapps.net

The client ID is the app registration that has "Expose an API" set up for Teams
single sign-on (the login registration, AAD_CLIENT_ID). The host is the site's
address without https://. Raise --version each time you change the package, or
Teams will not treat the upload as an update.
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUID = re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
HOST = re.compile(r"^(?=.{4,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--client-id", required=True, help="Application (client) ID of the SSO app registration")
    parser.add_argument("--host", required=True, help="Site hostname, without https://")
    parser.add_argument("--version", default="1.0.0", help="Package version, for example 1.0.1")
    parser.add_argument("--out", default=str(HERE / "dist" / "planner-tasks-teams.zip"), help="Output zip path")
    args = parser.parse_args()

    host = args.host.strip().lower()
    if host.startswith(("http://", "https://")) or "/" in host:
        sys.exit("--host must be just the hostname, for example mysite.azurestaticapps.net")
    if not HOST.match(host):
        sys.exit(f"--host does not look like a hostname: {args.host}")
    if not GUID.match(args.client_id):
        sys.exit("--client-id must be a GUID like 00000000-0000-0000-0000-000000000000")
    if not VERSION.match(args.version):
        sys.exit("--version must look like 1.0.0")

    text = (HERE / "manifest.template.json").read_text(encoding="utf-8")
    text = (
        text.replace("{{HOST}}", host)
        .replace("{{CLIENT_ID}}", args.client_id.lower())
        .replace("{{VERSION}}", args.version)
    )
    manifest = json.loads(text)  # fails loudly if anything went wrong
    if "{{" in text:
        sys.exit("The manifest still has an unfilled {{placeholder}}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        package.write(HERE / "color.png", "color.png")
        package.write(HERE / "outline.png", "outline.png")

    print(f"Wrote {out}")
    print(f"  tab address : {manifest['staticTabs'][0]['contentUrl']}")
    print(f"  SSO resource: {manifest['webApplicationInfo']['resource']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
