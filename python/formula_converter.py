"""Converts LaTeX formulas to Word-compatible formats.

Primary path: LaTeX → MathML (via latex2mathml) → OMML (via XSLT).
Fallback: insert raw LaTeX as italic text if conversion fails.
"""

import logging
import re

from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from lxml import etree

logger = logging.getLogger(__name__)

# ── XSLT for MathML → OMML ───────────────────────────────────────────

# Microsoft's MML2OMML.XSL is proprietary, but we can do a simplified
# conversion for common math elements. For full fidelity we use
# latex2mathml to get MathML, then wrap it in an OMML oMath element.

def latex_to_omml(latex: str) -> etree._Element:
    """Convert a LaTeX string to an OMML (Office Math) XML element.

    Uses latex2mathml as an intermediate step to produce MathML,
    then converts to OMML structure that python-docx can embed.

    Returns an oMath element ready for insertion into a paragraph.
    """
    import latex2mathml.converter

    # Convert LaTeX to MathML string
    mathml_str = latex2mathml.converter.convert(latex)

    # Parse the MathML
    mathml_tree = etree.fromstring(mathml_str.encode("utf-8"))

    # Build a minimal OMML oMath wrapper
    # For basic formulas, we extract the text content and wrap it
    # in OMML run elements.
    omath = OxmlElement("m:oMath")

    # Walk the MathML tree and convert elements
    _mathml_to_omml(mathml_tree, omath)

    return omath


def _mathml_to_omml(mathml_elem, omml_parent):
    """Recursively converts MathML elements to OMML elements."""
    tag = _local_name(mathml_elem)

    if tag == "math":
        for child in mathml_elem:
            _mathml_to_omml(child, omml_parent)

    elif tag == "mfrac":
        # Fraction: <m:f><m:num>...</m:num><m:den>...</m:den></m:f>
        frac = OxmlElement("m:f")
        children = list(mathml_elem)
        if len(children) >= 2:
            num = OxmlElement("m:num")
            _mathml_to_omml(children[0], num)
            frac.append(num)
            den = OxmlElement("m:den")
            _mathml_to_omml(children[1], den)
            frac.append(den)
        omml_parent.append(frac)

    elif tag == "msup":
        # Superscript
        children = list(mathml_elem)
        if len(children) >= 2:
            ssup = OxmlElement("m:sSup")
            e = OxmlElement("m:e")
            _mathml_to_omml(children[0], e)
            ssup.append(e)
            sup = OxmlElement("m:sup")
            _mathml_to_omml(children[1], sup)
            ssup.append(sup)
            omml_parent.append(ssup)

    elif tag == "msub":
        # Subscript
        children = list(mathml_elem)
        if len(children) >= 2:
            ssub = OxmlElement("m:sSub")
            e = OxmlElement("m:e")
            _mathml_to_omml(children[0], e)
            ssub.append(e)
            sub = OxmlElement("m:sub")
            _mathml_to_omml(children[1], sub)
            ssub.append(sub)
            omml_parent.append(ssub)

    elif tag == "msubsup":
        # Sub-superscript
        children = list(mathml_elem)
        if len(children) >= 3:
            ssubsup = OxmlElement("m:sSubSup")
            e = OxmlElement("m:e")
            _mathml_to_omml(children[0], e)
            ssubsup.append(e)
            sub = OxmlElement("m:sub")
            _mathml_to_omml(children[1], sub)
            ssubsup.append(sub)
            sup = OxmlElement("m:sup")
            _mathml_to_omml(children[2], sup)
            ssubsup.append(sup)
            omml_parent.append(ssubsup)

    elif tag == "msqrt":
        rad = OxmlElement("m:rad")
        deg = OxmlElement("m:deg")
        rad.append(deg)
        e = OxmlElement("m:e")
        for child in mathml_elem:
            _mathml_to_omml(child, e)
        rad.append(e)
        omml_parent.append(rad)

    elif tag in ("mi", "mn", "mo", "mtext"):
        # Simple text run
        text = mathml_elem.text or ""
        if text.strip():
            _add_omml_run(omml_parent, text.strip(), italic=(tag == "mi"))

    elif tag == "mrow":
        for child in mathml_elem:
            _mathml_to_omml(child, omml_parent)

    elif tag == "mover":
        # Overset (e.g., hat, bar) — simplified: just render base
        children = list(mathml_elem)
        if children:
            _mathml_to_omml(children[0], omml_parent)

    elif tag == "munder":
        children = list(mathml_elem)
        if children:
            _mathml_to_omml(children[0], omml_parent)

    else:
        # Fallback: try to extract text content
        text = "".join(mathml_elem.itertext())
        if text.strip():
            _add_omml_run(omml_parent, text.strip())


def _add_omml_run(parent, text: str, italic: bool = False):
    """Add an OMML run element with text content."""
    r = OxmlElement("m:r")
    if italic:
        rpr = OxmlElement("m:rPr")
        sty = OxmlElement("m:sty")
        sty.set(qn("m:val"), "i")
        rpr.append(sty)
        r.append(rpr)
    t = OxmlElement("m:t")
    t.text = text
    r.append(t)
    parent.append(r)


def _local_name(elem) -> str:
    """Get the local name of an element, stripping namespace."""
    tag = elem.tag
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def insert_formula(paragraph, latex: str, display_mode: bool = False):
    """Insert a formula into a python-docx paragraph.

    Tries OMML conversion first. On failure, inserts the raw LaTeX
    as italic text as a fallback.
    """
    try:
        omath = latex_to_omml(latex)
        # For display mode, wrap in oMathPara for centered display
        if display_mode:
            omath_para = OxmlElement("m:oMathPara")
            omath_para.append(omath)
            paragraph._element.append(omath_para)
        else:
            paragraph._element.append(omath)
    except Exception as e:
        logger.warning(f"OMML conversion failed for '{latex}': {e}. Using text fallback.")
        run = paragraph.add_run(latex)
        run.italic = True
        run.font.name = "Cambria Math"
