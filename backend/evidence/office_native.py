"""Read native OOXML text locations without inventing Word pages or slide order."""

import posixpath
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def xml(archive, part):
    if archive.getinfo(part).file_size > 50 * 1024 * 1024:
        raise ValueError("OOXML part is too large to parse")
    return ET.fromstring(archive.read(part))


def relations(archive, part):
    relpath = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
    if relpath not in archive.namelist():
        return {}
    result = {}
    for item in xml(archive, relpath):
        if item.get("TargetMode") == "External":
            continue
        target = item.get("Target", "")
        target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
        if target.startswith("../"):
            raise ValueError("Relationship escapes the OOXML package")
        result[item.get("Id")] = {"part": target, "type": item.get("Type", "")}
    return result


def ancestor(node, parents, tag):
    while node in parents:
        node = parents[node]
        if node.tag == tag:
            return node
    return None


def paragraph_text(paragraph, namespace):
    pieces = []

    def walk(node):
        if node is not paragraph and node.tag == f"{{{namespace}}}p":
            return  # A nested text box has its own paragraph/locator.
        if node.tag == f"{{{namespace}}}t":
            pieces.append(node.text or "")
        elif node.tag == f"{{{namespace}}}tab":
            pieces.append("\t")
        elif node.tag in (f"{{{namespace}}}br", f"{{{namespace}}}cr"):
            pieces.append("\n")
        for child in node:
            walk(child)

    walk(paragraph)
    return "".join(pieces)


def docx_blocks(path):
    blocks = []
    tracked = False
    with ZipFile(path) as archive:
        if "word/document.xml" not in archive.namelist():
            raise ValueError("Not a Word OOXML document")
        parts = ["word/document.xml"] + sorted(p for p in archive.namelist()
                  if (p.startswith(("word/header", "word/footer")) or p in
                      ("word/footnotes.xml", "word/endnotes.xml", "word/comments.xml")) and p.endswith(".xml"))
        for part in parts:
            root = xml(archive, part)
            parents = {child: parent for parent in root.iter() for child in parent}
            tables = list(root.iter(f"{{{W}}}tbl"))
            tracked = tracked or any(e.tag in (f"{{{W}}}ins", f"{{{W}}}del") for e in root.iter())
            for index, para in enumerate(root.iter(f"{{{W}}}p"), 1):
                text = paragraph_text(para, W)
                if not text.strip():
                    continue
                locator = {"kind": "docx_paragraph", "part": part, "paragraph_index": index}
                table, row, cell = (ancestor(para, parents, f"{{{W}}}{tag}") for tag in ("tbl", "tr", "tc"))
                if table is not None and row is not None and cell is not None:
                    locator.update(table_index=tables.index(table) + 1,
                                   row_index=list(table.findall(f"{{{W}}}tr")).index(row) + 1,
                                   xml_cell_index=list(row.findall(f"{{{W}}}tc")).index(cell) + 1)
                blocks.append({"text": text, "locator": locator,
                               "layer": "body" if part == "word/document.xml" else "annotation_or_auxiliary"})
        return {"format": "docx", "blocks": blocks, "tracked_changes_present": tracked,
                "media_count": sum(p.startswith("word/media/") for p in archive.namelist()),
                "limitations": ["Paragraph indices are 1-based XML traversal positions within each part, not Word page numbers.",
                                "Table cell indices refer to XML cells, not reconstructed merged-cell grid columns.",
                                "Deleted tracked text is not treated as current text; revisions and comments require review."]}


def pptx_blocks(path):
    blocks, slides = [], []
    with ZipFile(path) as archive:
        presentation = xml(archive, "ppt/presentation.xml")
        rels = relations(archive, "ppt/presentation.xml")
        ids = presentation.find(f"{{{P}}}sldIdLst")
        if ids is None:
            raise ValueError("Presentation contains no slide list")
        for slide_index, slide_id in enumerate(ids, 1):
            part = rels[slide_id.get(f"{{{R}}}id")]["part"]
            slide = xml(archive, part)
            slides.append({"slide_index": slide_index, "part": part, "hidden": slide.get("show") == "0"})
            parts = [(part, slide, "slide")]
            for rel in relations(archive, part).values():
                if rel["type"].endswith("/notesSlide"):
                    parts.append((rel["part"], xml(archive, rel["part"]), "speaker_notes"))
            for current_part, root, layer in parts:
                parents = {child: parent for parent in root.iter() for child in parent}
                tables = list(root.iter(f"{{{A}}}tbl"))
                for index, para in enumerate(root.iter(f"{{{A}}}p"), 1):
                    text = paragraph_text(para, A)
                    if not text.strip():
                        continue
                    shape = ancestor(para, parents, f"{{{P}}}sp")
                    if shape is None:
                        shape = ancestor(para, parents, f"{{{P}}}graphicFrame")
                    info = shape.find(f".//{{{P}}}cNvPr") if shape is not None else None
                    locator = {"kind": "pptx_paragraph", "part": current_part, "slide_index": slide_index,
                               "shape_id": info.get("id") if info is not None else None,
                               "paragraph_index": index, "layer": layer}
                    table, row, cell = (ancestor(para, parents, f"{{{A}}}{tag}") for tag in ("tbl", "tr", "tc"))
                    if table is not None and row is not None and cell is not None:
                        locator.update(table_index=tables.index(table) + 1,
                                       row_index=list(table.findall(f"{{{A}}}tr")).index(row) + 1,
                                       xml_cell_index=list(row.findall(f"{{{A}}}tc")).index(cell) + 1)
                    blocks.append({"text": text, "locator": locator, "layer": layer})
        return {"format": "pptx", "blocks": blocks, "slides": slides, "slide_count": len(slides),
                "media_count": sum(p.startswith("ppt/media/") for p in archive.namelist()),
                "limitations": ["Slide order comes from presentation.xml relationships, never sorted slide filenames.",
                                "Hidden slides, speaker notes, animations and embedded media may not appear in the PDF representation.",
                                "Rendered PDF pages are not assumed to equal original slide indices."]}


def read_native(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".docx":
        return docx_blocks(path)
    if suffix == ".pptx":
        return pptx_blocks(path)
    raise ValueError("Native OOXML parsing requires .docx or .pptx")
