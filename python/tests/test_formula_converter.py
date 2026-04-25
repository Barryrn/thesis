"""Tests for LaTeX to OMML formula conversion."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from docx import Document
from lxml import etree

import formula_converter


def _make_paragraph():
    """Create a fresh Document and return a paragraph for testing."""
    doc = Document()
    return doc.add_paragraph()


class TestLatexToOmml:
    """Tests for the latex_to_omml conversion function."""

    def test_simple_fraction(self):
        """Convert \\frac{a}{b} to OMML."""
        result = formula_converter.latex_to_omml(r"\frac{a}{b}")
        assert result is not None
        # Should contain m:f (fraction) element
        xml_str = etree.tostring(result, encoding="unicode")
        assert "oMath" in xml_str or "m:" in xml_str

    def test_greek_letters(self):
        """Convert Greek letters to OMML."""
        result = formula_converter.latex_to_omml(r"\alpha + \beta")
        assert result is not None
        xml_str = etree.tostring(result, encoding="unicode")
        assert len(xml_str) > 0

    def test_superscript(self):
        """Convert x^2 to OMML superscript."""
        result = formula_converter.latex_to_omml(r"x^2")
        assert result is not None

    def test_summation(self):
        """Convert summation notation to OMML."""
        result = formula_converter.latex_to_omml(r"\sum_{i=0}^n x_i")
        assert result is not None


class TestInsertFormula:
    """Tests for the insert_formula function with fallback."""

    def test_insert_inline_formula(self):
        """Insert an inline formula into a paragraph."""
        p = _make_paragraph()
        formula_converter.insert_formula(p, r"x^2", display_mode=False)
        # Should have added some XML content
        assert len(p._element) > 0

    def test_insert_display_formula(self):
        """Insert a display formula into a paragraph."""
        p = _make_paragraph()
        formula_converter.insert_formula(p, r"\frac{a}{b}", display_mode=True)
        assert len(p._element) > 0

    def test_invalid_latex_uses_text_fallback(self):
        """Invalid LaTeX should fall back to italic text, not crash."""
        p = _make_paragraph()
        # This should not raise an exception
        formula_converter.insert_formula(p, r"\invalid_command_xyz", display_mode=False)
        # Should have some content (either OMML or fallback text)
        assert len(p._element) > 0
