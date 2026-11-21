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
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
