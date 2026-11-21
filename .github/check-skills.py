#!/usr/bin/env python3
"""Check SKILL.md files against the Agent Skills format (https://agentskills.io/specification).

Usage: check-skills.py SKILL.md_or_folder ... [--agents FILE ...]
Skills: name is 1-64 chars of a-z, 0-9, single hyphens, and equals the folder name;
description is 1-1024 chars; the file is at most 500 lines.
--agents: each file needs a non-empty description, and name equals the file name.
Also: when both plugin.json (Agent Plugins) and .claude-plugin/plugin.json exist, their versions must match.
Stdlib only. Exit 1 on any failure.
"""
import json
import os
import re
import sys
from pathlib import Path


def frontmatter(path):
    lines = path.read_text(encoding="utf-8").split("\n")
    if not lines or lines[0].strip() != "---":
        return None, len(lines)
    fm, key = {}, None
    for line in lines[1:]:
        if line.strip() == "---":
            return fm, len(lines)
        m = re.match(r"([A-Za-z][\w-]*):\s*(.*)$", line)
        if m and not line.startswith(" "):
            key, val = m.group(1), m.group(2).strip()
            fm[key] = "" if val in (">", "|", ">-", "|-") else val.strip("\"'")
        elif key and line.strip():
            fm[key] = (fm[key] + " " + line.strip()).strip()
    return None, len(lines)


def check_skill(path):
    errs = []
    fm, n = frontmatter(path)
    if fm is None:
        return ["no frontmatter"]
    name, desc = fm.get("name", ""), fm.get("description", "")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) or len(name) > 64:
        errs.append(f"name {name!r} is not 1-64 chars of a-z, 0-9 and single hyphens")
    if name != path.parent.name:
        errs.append(f"name {name!r} does not equal folder {path.parent.name!r}")
    if not desc:
        errs.append("description is empty")
    elif len(desc) > 1024:
        errs.append(f"description is {len(desc)} chars (max 1024)")
    if n > 500:
        errs.append(f"{n} lines (max 500)")
    return errs


def check_agent(path):
    fm, _ = frontmatter(path)
    if fm is None:
        return ["no frontmatter"]
    errs = []
    if fm.get("name") != path.stem:
        errs.append(f"name {fm.get('name')!r} does not equal file name {path.stem!r}")
    if not fm.get("description"):
        errs.append("description is empty")
    return errs


def check_versions(root):
    a, b = root / "plugin.json", root / ".claude-plugin" / "plugin.json"
    if not (a.is_file() and b.is_file()):
        return 0
    va, vb = (json.loads(f.read_text(encoding="utf-8")).get("version") for f in (a, b))
    if va != vb:
        print(f"FAIL plugin.json version {va!r} differs from .claude-plugin/plugin.json {vb!r}")
        return 1
    print(f"ok   plugin.json versions match ({va})")
    return 0


def check_directory(root):
    """The code-free copy in directory/: allowed file types, no shebang, shared files identical, spec in step with the core."""
    d = root / "directory"
    if not d.is_dir():
        return 0
    errs = []
    for here, _, names in os.walk(d):
        for n in names:
            f = Path(here) / n
            rel = f.relative_to(root)
            if f.suffix not in (".md", ".json", ".png") and n not in ("LICENSE", ".gitignore"):
                errs.append(f"{rel}: file type not allowed in directory/")
            elif f.suffix != ".png" and any(l.startswith("#!") for l in f.read_text(encoding="utf-8").split("\n")):
                errs.append(f"{rel}: starts a line with #!")
    for name in ("plugin.json", "icon.png"):
        if (root / ".claude-plugin" / name).read_bytes() != (d / ".claude-plugin" / name).read_bytes():
            errs.append(f"directory/.claude-plugin/{name} differs from the root copy")
    if (root / "LICENSE").read_bytes() != (d / "LICENSE").read_bytes():
        errs.append("directory/LICENSE differs from the root copy")
    src = root / "skills" / "simulate" / "references"
    dst = d / "skills" / "simulate" / "references"
    for f in sorted(src.glob("*.md")):
        if not (dst / f.name).is_file() or (dst / f.name).read_bytes() != f.read_bytes():
            errs.append(f"directory reference {f.name} differs from skills/simulate/references/{f.name}")
    cases = (dst / "core-cases.md").read_text(encoding="utf-8")
    n = 0
    for t in sorted((root / "skills" / "simulate" / "core" / "test").glob("*.test.ts")):
        for m in re.finditer(r"^\s*test\(\s*(['\"`])((?:\\.|(?!\1).)*)\1\s*,", t.read_text(encoding="utf-8"), re.M):
            title = re.sub(r"\\(.)", r"\1", m.group(2))
            n += 1
            for part in re.split(r"\$\{[^}]*\}", title):
                if part and part not in cases:
                    errs.append(f"{t.name}: test title not in core-cases.md: {title}")
                    break
    want = re.search(r"CORE_VERSION = '([^']+)'", (root / "skills/simulate/core/version.ts").read_text(encoding="utf-8")).group(1)
    got = re.search(r"`CORE_VERSION`: `([^`]+)`", (dst / "core-spec.md").read_text(encoding="utf-8"))
    if not got or got.group(1) != want:
        errs.append(f"CORE_VERSION is {want!r} in version.ts but {got and got.group(1)!r} in core-spec.md")
    for e in errs:
        print(f"FAIL {e}")
    if not errs:
        print(f"ok   directory/ checks pass ({n} test titles found in core-cases.md)")
    return 1 if errs else 0


def main(argv):
    skills, agents, bucket = [], [], None
    bucket = skills
    for a in argv:
        if a == "--agents":
            bucket = agents
            continue
        p = Path(a)
        bucket.append(p / "SKILL.md" if p.is_dir() and bucket is skills else p)
    if not skills and not agents:
        print(__doc__)
        return 2
    bad = 0
    for path, fn in [(p, check_skill) for p in skills] + [(p, check_agent) for p in agents]:
        errs = fn(path) if path.is_file() else ["file not found"]
        for e in errs:
            print(f"FAIL {path}: {e}")
        bad += bool(errs)
        if not errs:
            print(f"ok   {path}")
    bad += check_versions(Path(__file__).resolve().parent.parent)
    bad += check_directory(Path(__file__).resolve().parent.parent)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
