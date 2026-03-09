#!/usr/bin/env python3
"""Extract structured documentation from OCCT headers via Doxygen XML.

Produces build/occt-docs.json — a cached JSON lookup table keyed by C++ symbol
name, consumed by bindings.py to inject JSDoc into generated TypeScript definitions.

Usage:
    python3 src/extract-docs.py [--force]

The JSON is regenerated only when the OCCT commit changes (tracked via .docs-hash).
Pass --force to bypass the cache check.
"""

import json
import os
import subprocess
import sys
from xml.etree import ElementTree as ET


def _occt_commit(occt_root: str) -> str:
    """Return the current OCCT HEAD commit hash."""
    try:
        return subprocess.check_output(
            ["git", "-C", occt_root, "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:
        return "unknown"


def _description_text(desc_element) -> str:
    """Extract plain text from a Doxygen XML description element, handling mixed content."""
    if desc_element is None:
        return ""
    raw = ET.tostring(desc_element, encoding="unicode", method="text")
    lines = raw.strip().splitlines()
    cleaned = " ".join(line.strip() for line in lines if line.strip())
    return cleaned


def _extract_params(memberdef_element) -> list:
    """Extract @param documentation from a memberdef's detaileddescription."""
    params = []
    detailed = memberdef_element.find("detaileddescription")
    if detailed is None:
        return params
    for parameterlist in detailed.iter("parameterlist"):
        kind = parameterlist.get("kind", "")
        if kind != "param":
            continue
        for item in parameterlist.findall("parameteritem"):
            names = []
            for namelist in item.findall("parameternamelist"):
                for pn in namelist.findall("parametername"):
                    text = (pn.text or "").strip()
                    if text:
                        names.append(text)
            desc_el = item.find("parameterdescription")
            desc_text = _description_text(desc_el) if desc_el is not None else ""
            for name in names:
                params.append({"name": name, "description": desc_text})
    return params


def _extract_return(memberdef_element) -> str:
    """Extract @return documentation from a memberdef's detaileddescription."""
    detailed = memberdef_element.find("detaileddescription")
    if detailed is None:
        return ""
    for simplesect in detailed.iter("simplesect"):
        kind = simplesect.get("kind", "")
        if kind == "return":
            return _description_text(simplesect)
    return ""


def _is_deprecated(element) -> bool:
    """Check if an element has @deprecated annotation."""
    detailed = element.find("detaileddescription")
    if detailed is None:
        return False
    for simplesect in detailed.iter("simplesect"):
        if simplesect.get("kind", "") == "deprecated":
            return True
    for xrefsect in detailed.iter("xrefsect"):
        title = xrefsect.find("xreftitle")
        if title is not None and "deprecated" in (title.text or "").lower():
            return True
    brief = element.find("briefdescription")
    if brief is not None:
        brief_text = _description_text(brief).lower()
        if "@deprecated" in brief_text or "is deprecated" in brief_text:
            return True
    return False


def _extract_type_text(type_element) -> str:
    """Extract type as plain text from a Doxygen type element."""
    if type_element is None:
        return ""
    return ET.tostring(type_element, encoding="unicode", method="text").strip()


def _process_compound_xml(xml_path: str, docs: dict):
    """Parse a single compound XML file and populate the docs dict."""
    try:
        tree = ET.parse(xml_path)
    except ET.ParseError:
        return

    root = tree.getroot()

    for compounddef in root.findall("compounddef"):
        kind = compounddef.get("kind", "")
        compound_name = compounddef.findtext("compoundname", "").strip()

        if kind in ("class", "struct"):
            brief = _description_text(compounddef.find("briefdescription"))
            detailed = _description_text(compounddef.find("detaileddescription"))
            deprecated = _is_deprecated(compounddef)

            members = {}
            for sectiondef in compounddef.findall("sectiondef"):
                sec_kind = sectiondef.get("kind", "")
                if "public" not in sec_kind:
                    continue
                for memberdef in sectiondef.findall("memberdef"):
                    mem_kind = memberdef.get("kind", "")
                    mem_name = memberdef.findtext("name", "").strip()
                    if not mem_name:
                        continue
                    mem_brief = _description_text(memberdef.find("briefdescription"))
                    mem_params = _extract_params(memberdef)
                    mem_returns = _extract_return(memberdef)
                    mem_return_type = _extract_type_text(memberdef.find("type"))
                    mem_deprecated = _is_deprecated(memberdef)

                    member_entry = {
                        "kind": mem_kind,
                        "brief": mem_brief,
                    }
                    if mem_params:
                        member_entry["params"] = mem_params
                    if mem_returns:
                        member_entry["returns_description"] = mem_returns
                    if mem_return_type:
                        member_entry["returns"] = mem_return_type
                    if mem_deprecated:
                        member_entry["deprecated"] = True

                    param_elements = memberdef.findall("param")
                    member_entry["param_count"] = len(param_elements)

                    if mem_kind == "enum":
                        enum_members = {}
                        for ev in memberdef.findall("enumvalue"):
                            ev_name = ev.findtext("name", "").strip()
                            ev_brief = _description_text(ev.find("briefdescription"))
                            if ev_name:
                                enum_members[ev_name] = {
                                    "kind": "enumvalue",
                                    "brief": ev_brief,
                                }
                        if mem_brief or enum_members:
                            toplevel_key = compound_name + "_" + mem_name
                            docs[toplevel_key] = {
                                "kind": "enum",
                                "brief": mem_brief,
                                "detailed": _description_text(memberdef.find("detaileddescription")),
                                "members": enum_members,
                                "deprecated": mem_deprecated,
                            }

                    if mem_name in members:
                        existing = members[mem_name]
                        if "overloads" in existing:
                            existing["overloads"].append(member_entry)
                        else:
                            members[mem_name] = {
                                "overloads": [existing, member_entry]
                            }
                    else:
                        members[mem_name] = member_entry

            if brief or members:
                docs[compound_name] = {
                    "kind": kind,
                    "brief": brief,
                    "detailed": detailed,
                    "members": members,
                    "deprecated": deprecated,
                }

        elif kind == "file":
            for sectiondef in compounddef.findall("sectiondef"):
                sec_kind = sectiondef.get("kind", "")
                if sec_kind not in ("enum", "typedef", "func"):
                    continue
                for memberdef in sectiondef.findall("memberdef"):
                    mem_kind = memberdef.get("kind", "")
                    mem_name = memberdef.findtext("name", "").strip()
                    if not mem_name:
                        continue

                    if mem_kind == "enum":
                        enum_brief = _description_text(memberdef.find("briefdescription"))
                        enum_detailed = _description_text(memberdef.find("detaileddescription"))
                        enum_deprecated = _is_deprecated(memberdef)

                        enum_members = {}
                        for ev in memberdef.findall("enumvalue"):
                            ev_name = ev.findtext("name", "").strip()
                            ev_brief = _description_text(ev.find("briefdescription"))
                            if ev_name:
                                enum_members[ev_name] = {
                                    "kind": "enumvalue",
                                    "brief": ev_brief,
                                }

                        if enum_brief or enum_members:
                            docs[mem_name] = {
                                "kind": "enum",
                                "brief": enum_brief,
                                "detailed": enum_detailed,
                                "members": enum_members,
                                "deprecated": enum_deprecated,
                            }


def run_doxygen(ocjs_root: str, occt_root: str):
    """Run Doxygen to produce XML output."""
    doxyfile = os.path.join(ocjs_root, "src", "occt-docs.doxyfile")
    doxygen_bin = os.path.join(ocjs_root, "tools", "doxygen", "bin", "doxygen")

    if not os.path.isfile(doxygen_bin):
        doxygen_bin = "doxygen"

    env = os.environ.copy()
    env["OCCT_ROOT"] = occt_root
    env["OCJS_ROOT"] = ocjs_root

    print(f"  Running Doxygen on OCCT headers...")
    result = subprocess.run(
        [doxygen_bin, doxyfile],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  WARNING: Doxygen exited with code {result.returncode}", file=sys.stderr)
        if result.stderr:
            for line in result.stderr.strip().splitlines()[-5:]:
                print(f"    {line}", file=sys.stderr)


def extract_docs(ocjs_root: str) -> dict:
    """Parse all Doxygen XML files and return the documentation dict."""
    xml_dir = os.path.join(ocjs_root, "build", "doxygen-xml", "xml")
    index_xml = os.path.join(xml_dir, "index.xml")

    if not os.path.isfile(index_xml):
        print(f"  ERROR: Doxygen XML not found at {index_xml}", file=sys.stderr)
        return {}

    docs = {}
    tree = ET.parse(index_xml)
    root = tree.getroot()

    compound_files = []
    for compound_el in root.findall("compound"):
        kind = compound_el.get("kind", "")
        if kind in ("class", "struct", "file"):
            refid = compound_el.get("refid", "")
            if refid:
                compound_files.append(os.path.join(xml_dir, refid + ".xml"))

    total = len(compound_files)
    print(f"  Parsing {total} compound XML files...")
    for i, xml_path in enumerate(compound_files):
        if os.path.isfile(xml_path):
            _process_compound_xml(xml_path, docs)
        if (i + 1) % 2000 == 0:
            print(f"    ...{i + 1}/{total}")

    return docs


def main():
    force = "--force" in sys.argv

    ocjs_root = os.environ.get("OCJS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    occt_root = os.environ.get("OCCT_ROOT", os.path.join(os.path.dirname(ocjs_root), "OCCT"))

    if not os.path.isdir(occt_root):
        print(f"  ERROR: OCCT_ROOT not found: {occt_root}", file=sys.stderr)
        sys.exit(1)

    output_json = os.path.join(ocjs_root, "build", "occt-docs.json")
    hash_file = os.path.join(ocjs_root, "build", ".docs-hash")

    current_commit = _occt_commit(occt_root)

    if not force and os.path.isfile(hash_file) and os.path.isfile(output_json):
        with open(hash_file, "r") as f:
            cached_commit = f.read().strip()
        if cached_commit == current_commit:
            print(f"  Documentation cache hit (OCCT commit {current_commit[:12]})")
            return

    print(f"  OCCT commit: {current_commit[:12]}")

    os.makedirs(os.path.join(ocjs_root, "build"), exist_ok=True)

    run_doxygen(ocjs_root, occt_root)
    docs = extract_docs(ocjs_root)

    classes = sum(1 for v in docs.values() if v["kind"] in ("class", "struct"))
    enums = sum(1 for v in docs.values() if v["kind"] == "enum")
    total_members = sum(len(v.get("members", {})) for v in docs.values())
    documented_members = sum(
        1 for v in docs.values()
        for m in v.get("members", {}).values()
        if m.get("brief")
    )

    print(f"  Extracted docs: {classes} classes, {enums} enums, "
          f"{documented_members}/{total_members} documented members")

    with open(output_json, "w") as f:
        json.dump(docs, f, indent=None, separators=(",", ":"))

    with open(hash_file, "w") as f:
        f.write(current_commit)

    size_mb = os.path.getsize(output_json) / (1024 * 1024)
    print(f"  Written: {output_json} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
