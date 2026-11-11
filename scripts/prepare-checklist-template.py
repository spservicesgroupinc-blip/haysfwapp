"""Build the blank production form from the approved, completed reference PDF.

Usage: python scripts/prepare-checklist-template.py path/to/approved-checklist.pdf
Requires pypdf. The input fingerprint protects the paint-operation locations below.
Only the sanitized, compressed form is shipped; completed entries are removed
from the content stream, rather than covered with white rectangles.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject


SOURCE_SHA256 = "9e5c18c6a1923a1c7eeeb086c07b28d4d6d0f7a0efeb566b972bd49dd01825dc"
# Text-paint operations for the completed fields, two check marks, permit answer,
# and the two notes added with the source editor. All other artwork is retained.
COMPLETED_ENTRIES = {
    249, 320, 376, 386, 397, 407, 417, 427, 437, 520, 576, 640, 650,
    660, 890, 1029, 1039, 1049, 1059, 1069, 1079, 1089, 1965, 1976,
    2841, 3160, 3299, 3309, 3319, 3329, 3339, 3349, 3359, 3445,
    3897, 4654, 5266, 5272, 5278,
}


def main():
    source = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("Expected the approved October 2026 checklist reference.")
    reader = PdfReader(io.BytesIO(source))
    writer = PdfWriter()
    writer.add_page(reader.pages[0])
    page = writer.pages[0]
    stream = ContentStream(page.get_contents(), writer)
    assert len(stream.operations) == 5280
    for index in COMPLETED_ENTRIES:
        assert stream.operations[index][1] in (b"Tj", b"TJ")
    stream.operations = [
        operation for index, operation in enumerate(stream.operations)
        if index not in COMPLETED_ENTRIES
    ]
    # Empty text objects no longer need a font resource. In particular, remove
    # the editor's full-font copies that were used only by the completed notes.
    cleaned = []
    text_object = None
    for operation in stream.operations:
        if operation[1] == b"BT":
            text_object = [operation]
        elif text_object is not None:
            text_object.append(operation)
            if operation[1] == b"ET":
                def paints_text(args, op):
                    if op == b"Tj":
                        return bool(str(args[0]).strip())
                    if op == b"TJ":
                        return any(isinstance(part, str) and part.strip() for part in args[0])
                    return False
                if any(paints_text(args, op) for args, op in text_object):
                    cleaned.extend(text_object)
                text_object = None
        else:
            cleaned.append(operation)
    stream.operations = cleaned
    page.replace_contents(stream)
    fonts = page["/Resources"]["/Font"]
    used_fonts = {args[0] for args, op in cleaned if op == b"Tf"}
    for name in list(fonts):
        if name not in used_fonts:
            del fonts[name]
    # Copy only the cleaned page's reachable resources into the final document;
    # the source editor left unused streams and full-font copies in the input.
    final_writer = PdfWriter()
    final_writer.add_page(page)
    final_writer.root_object.pop(NameObject("/AcroForm"), None)
    final_writer.add_metadata({"/Title": "Production Checklist - blank approved form"})
    final_writer.pages[0].compress_content_streams()
    final_writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    output = io.BytesIO()
    final_writer.write(output)
    # Reopen before shipping, and require all remaining text to be form labels.
    blank = PdfReader(io.BytesIO(output.getvalue()))
    assert not blank.get_fields() and not blank.pages[0].get("/Annots")
    labels = blank.pages[0].extract_text()
    assert "Production Checklist" in labels
    assert "@" not in labels and not any(char.isdigit() for char in labels)
    destination = Path(__file__).resolve().parents[1] / "src/templates/production-checklist.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({
        "description": "Approved production checklist artwork; all completed entries removed. Regenerate with scripts/prepare-checklist-template.py.",
        "base64": base64.b64encode(output.getvalue()).decode("ascii"),
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {destination.name}: {len(output.getvalue())} bytes; removed {len(COMPLETED_ENTRIES)} completed text operations.")


if __name__ == "__main__":
    main()
