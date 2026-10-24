"""Preserve Office originals, build native locators and render a PDF reading view."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .office_native import read_native
from .prepare_pdf import prepare_pdf
from .prepare_circle import sha256, write_json


def resolve_soffice():
    configured = os.environ.get("SOFFICE_BIN")
    if configured:
        path = Path(configured).expanduser()
        if not path.is_file():
            raise ValueError("SOFFICE_BIN does not point to a file")
        return str(path)
    bundled = Path(sys.executable).parents[2] / "bin/override/soffice"
    if bundled.is_file():
        return str(bundled)
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    app = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    if app.is_file():
        return str(app)
    raise ValueError("Office rendering needs LibreOffice; set SOFFICE_BIN to its executable")


def convert_office(source, output, target, executable):
    output.mkdir(parents=True, exist_ok=True)
    expected = output / (source.stem + "." + target)
    if expected.exists():
        raise ValueError("Conversion output exists")
    env = os.environ.copy()
    if sys.platform == "darwin":
        env["TMPDIR"] = "/private/tmp"
    with tempfile.TemporaryDirectory(prefix="office-profile-") as profile:
        args = [executable, "-env:UserInstallation=" + Path(profile).as_uri(),
                "--headless", "--norestore", "--convert-to", target, "--outdir", str(output), str(source)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=120, env=env)
    if result.returncode != 0 or not expected.is_file() or expected.stat().st_size == 0:
        raise ValueError("LibreOffice conversion failed; no valid output file produced")
    return expected


def prepare_office(source, deal_id, output, **options):
    source, output = Path(source).expanduser().resolve(), Path(output).expanduser().resolve()
    suffix = source.suffix.lower()
    if suffix not in (".doc", ".docx", ".ppt", ".pptx") or not source.is_file():
        raise ValueError("Input must be a Word or PowerPoint file")
    if output.exists():
        raise ValueError("Output exists; choose a new directory")
    executable = resolve_soffice()
    original_sha = sha256(source)
    output.mkdir(parents=True)
    original = output / "sources" / ("original" + suffix)
    original.parent.mkdir()
    shutil.copyfile(source, original)
    if sha256(original) != original_sha or sha256(source) != original_sha:
        raise ValueError("Office source changed during snapshot creation")
    converted = output / "converted"
    native_source = original
    if suffix in (".doc", ".ppt"):
        native_source = convert_office(original, converted, "docx" if suffix == ".doc" else "pptx", executable)
    native = read_native(native_source)
    native["original_sha256"] = original_sha
    native["locator_origin"] = "original_ooxml" if native_source == original else "legacy_format_conversion"
    native["native_package_sha256"] = sha256(native_source)
    write_json(output / "native-blocks.json", native)
    pdf = convert_office(original, converted, "pdf", executable)
    summary = prepare_pdf(pdf, deal_id, output / "prepared", **options)
    registry_path = output / "prepared/registry.json"
    registry = json.loads(registry_path.read_text())
    document = registry["document"]
    pdf_file_id = document["file_id"]
    original_id = "file_" + hashlib.sha256(json.dumps([deal_id, str(source), options.get("source_url"), original_sha]).encode()).hexdigest()[:20]
    document.update(file_id=original_id, source_id="source_" + original_id.removeprefix("file_"),
                    original_filename=source.name, title=source.stem, original_format=suffix.removeprefix("."),
                    original_file_path=str(original), original_sha256=original_sha,
                    representation="converted_pdf", representation_file_id=pdf_file_id,
                    native_blocks_file=str(output / "native-blocks.json"),
                    native_blocks_sha256=sha256(output / "native-blocks.json"),
                    native_package_path=str(native_source), native_package_sha256=sha256(native_source),
                    original_locator_origin=native["locator_origin"])
    registry["files"].insert(0, {"file_id": original_id, "path": str(original), "original_path": str(source),
                                  "sha256": original_sha, "bytes": original.stat().st_size,
                                  "format": suffix.removeprefix(".")})
    version = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=20).stdout.strip()
    document["conversion_engine"] = "LibreOffice"
    document["conversion_version"] = version
    registry["conversion"] = {"engine": "LibreOffice", "version": version, "original_sha256": original_sha,
                               "pdf_sha256": document["sha256"], "source_file_id": original_id,
                               "representation_file_id": pdf_file_id, "original_slide_count": native.get("slide_count"),
                               "rendered_page_count": summary["total_pdf_pages"],
                               "slide_page_mapping": "not_assumed_use_native_quote_locators"}
    registry["limitations"].extend(native["limitations"])
    registry["limitations"].append("PDF pages belong to a rendered reading view, not native Word pagination or confirmed slide order.")
    registry["sources"] = [document]
    write_json(registry_path, registry)
    packet_path = output / "prepared/packet.json"
    packet = json.loads(packet_path.read_text())
    packet["file_id"] = original_id
    packet["original_sha256"] = original_sha
    write_json(packet_path, packet)
    return {**summary, "source_format": suffix.removeprefix("."), "prepared_run": str(output / "prepared"),
            "original_file": str(original), "native_blocks": len(native["blocks"]),
            "original_slide_count": native.get("slide_count"), "network_called": False}
