"""Write extension-pack.js: the extension's files, for the Accounts page's
download button.

The online copy only serves files at the top of the folder, so the page
cannot fetch extension/ itself. Run this after changing anything in
extension/, and commit both:

    python tools/pack_extension.py

It stops if extension/manifest.json and EXT_VERSION in accounts.js disagree,
since that version is how the page spots laptops that need updating.
"""
import base64
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "extension")

version = json.load(io.open(os.path.join(EXT, "manifest.json"), encoding="utf-8"))["version"]
page = io.open(os.path.join(ROOT, "accounts.js"), encoding="utf-8").read()
m = re.search(r'const EXT_VERSION = "([^"]+)"', page)
if not m or m.group(1) != version:
    sys.exit("accounts.js EXT_VERSION is %s, extension/manifest.json is %s" % (m and m.group(1), version))

files = {}
for name in sorted(os.listdir(EXT)):
    path = os.path.join(EXT, name)
    # _metadata is Chrome's own, written into the folder when it loads it.
    if name.startswith("_") or not os.path.isfile(path):
        continue
    with open(path, "rb") as f:
        files[name] = base64.b64encode(f.read()).decode("ascii")

out = ("// Made by tools/pack_extension.py from extension/ -- do not edit by hand.\n"
       "window.EXTENSION_PACK = " + json.dumps({"version": version, "files": files}, indent=1) + ";\n")
io.open(os.path.join(ROOT, "extension-pack.js"), "w", encoding="utf-8", newline="\n").write(out)
print("extension-pack.js: version %s, %d files" % (version, len(files)))
