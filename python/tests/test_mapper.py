"""Tests for mapper.score_sections.

Covers the two prompt modes (default multi-section ranking vs. single-section
on-demand citation) and the score-floor behaviour that protects user-assigned
papers from being dropped by the downstream ``score > 0.0`` filter.

The LLM call (``ai_client.chat_completion``) is patched so tests are
deterministic and offline.
"""

import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import mapper


def _section(sid: str, order: str, title: str, notes: str = "") -> dict:
    """Build a section payload in the shape mapper.score_sections expects."""
    return {"_id": sid, "orderNumber": order, "title": title, "notes": notes}


class TestPromptSelection:
    """Verify the right system prompt is built for each mode."""

    def test_default_mode_uses_strict_prompt(self):
        prompt = mapper._build_score_prompt("en", single_section_mode=False)
        assert "Be strict" in prompt
        assert "Include every section in the response" in prompt

    def test_single_section_mode_uses_relaxed_prompt(self):
        prompt = mapper._build_score_prompt("en", single_section_mode=True)
        # User-assignment framing should be present.
        assert "user has explicitly assigned" in prompt
        # Strict gate language should be absent in this mode.
        assert "Be strict" not in prompt

    def test_german_relevance_note_directive_in_single_mode(self):
        prompt = mapper._build_score_prompt("de", single_section_mode=True)
        assert "German" in prompt


class TestScoreSections:
    """End-to-end behaviour of score_sections with a mocked LLM."""

    def test_single_section_mode_floors_low_score_when_excerpts_present(self):
        """User assigned the paper — a low-score, has-excerpts response must
        survive the ``score > 0.0`` filter applied downstream."""
        sections = [_section("sec_a", "2.1.1", "EMH", "Fama 1970")]
        fake_response = json.dumps([
            {
                "sectionId": "sec_a",
                "score": 0.2,
                "excerpts": [
                    {
                        "text": "Markets are efficient when prices reflect all available information.",
                        "relevanceNote": "Defines EMH directly.",
                        "pageNumber": "12",
                    }
                ],
            }
        ])
        with patch("mapper.chat_completion", return_value=fake_response):
            result = mapper.score_sections(
                {}, sections, paper_text="...some paper text...",
                single_section_mode=True,
            )
        assert len(result) == 1
        assert result[0]["score"] == 0.5
        assert len(result[0]["excerpts"]) == 1

    def test_single_section_mode_preserves_zero_when_no_excerpts(self):
        """Paper genuinely has no relevant content — don't fabricate a score."""
        sections = [_section("sec_a", "2.1.1", "EMH")]
        fake_response = json.dumps([
            {"sectionId": "sec_a", "score": 0.0, "excerpts": []}
        ])
        with patch("mapper.chat_completion", return_value=fake_response):
            result = mapper.score_sections(
                {}, sections, paper_text="unrelated", single_section_mode=True,
            )
        assert result[0]["score"] == 0.0
        assert result[0]["excerpts"] == []

    def test_default_mode_does_not_floor_score(self):
        """Multi-section ranking must keep the strict 0.4 threshold semantics."""
        sections = [
            _section("sec_a", "1", "Intro"),
            _section("sec_b", "2", "Method"),
        ]
        fake_response = json.dumps([
            {"sectionId": "sec_a", "score": 0.2, "excerpts": [
                {"text": "Quote.", "relevanceNote": "n/a", "pageNumber": "1"},
            ]},
            {"sectionId": "sec_b", "score": 0.0, "excerpts": []},
        ])
        with patch("mapper.chat_completion", return_value=fake_response):
            result = mapper.score_sections({}, sections, paper_text="t")
        scores_by_id = {r["sectionId"]: r["score"] for r in result}
        # Default mode: low score stays low even when excerpts are present.
        assert scores_by_id["sec_a"] == 0.2
