#!/usr/bin/env python3
"""Pack the site (without a book) into one text file, or unpack it.

    python3 tools/pack_template.py pack BUNDLE_FILE
    python3 tools/pack_template.py unpack BUNDLE_FILE TARGET_FOLDER

The bundle is how the /quiz-book skill stores this template in a
claude.ai project: one plain-text file with a line
"@@@ FILE <path> @@@" before each file and "@@@ END @@@" at the end.

Left out: questions.json (each book brings its own) and the generated
theme files, which `python3 tools/build_themes.py` rebuilds after
unpacking.
"""

import re
import sys
from pathlib import Path

SITE_FOLDER = Path(__file__).resolve().parent.parent
LEFT_OUT = {"questions.json", "css/themes.css", "js/themes-list.js"}
LEFT_OUT_FOLDERS = {"__pycache__", ".git", "work"}
FILE_LINE = "@@@ FILE {} @@@\n"
END_LINE = "@@@ END @@@\n"


def files_to_pack():
    """Relative paths of every template file, sorted."""
    paths = []
    for path in sorted(SITE_FOLDER.rglob("*")):
        relative = path.relative_to(SITE_FOLDER).as_posix()
        if path.is_dir() or relative in LEFT_OUT or \
                LEFT_OUT_FOLDERS & set(path.relative_to(SITE_FOLDER).parts):
            continue
        if path.suffix in (".zip", ".pyc"):
            continue
        paths.append(relative)
    return paths


def pack(bundle_file):
    """Write every template file into the bundle."""
    pieces = []
    for relative in files_to_pack():
        text = (SITE_FOLDER / relative).read_text()
        pieces.append(FILE_LINE.format(relative) + text + "\n")
    Path(bundle_file).write_text("".join(pieces) + END_LINE)
    print(f"Packed {len(pieces)} files into {bundle_file}")


def unpack(bundle_file, target_folder):
    """Recreate the files from a bundle."""
    bundle = Path(bundle_file).read_text()
    pattern = r"^@@@ FILE (.+?) @@@\n(.*?)(?=^@@@ (?:FILE|END) )"
    count = 0
    for relative, body in re.findall(pattern, bundle, re.S | re.M):
        target = Path(target_folder) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body[:-1])
        count += 1
    print(f"Unpacked {count} files into {target_folder}. "
          "Now run: python3 tools/build_themes.py")


def main():
    """Read the command line."""
    if len(sys.argv) == 3 and sys.argv[1] == "pack":
        pack(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "unpack":
        unpack(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
