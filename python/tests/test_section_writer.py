"""Tests for the auto-citation detect + validate prompt helpers.

These functions are pure: they build prompts and parse model output
without I/O. Each test exercises one decision in the parser/prompt
contract so a regression in one branch doesn't get masked by the
others.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import section_writer


def _sample_payload(num_papers: int = 2) -> dict:
    """Minimal payload shaped like the Convex getGenerationContext result.

    Section + outline + N papers with one excerpt each. Reused across
    the detect + validate tests so they share a stable fixture.
    """
    matches = []
    for i in range(num_papers):
        pid = f"p{i + 1}"
        matches.append({
            "paperId": pid,
            "title": f"Paper {i + 1}",
            "authors": ["Doe, Jane"],
            "year": 2024,
            "kuerzel": f"DJ2{i}",
            "summary": {
                "researchQuestion": "Does X cause Y?",
                "methodology": "Mixed methods",
                "keyFindings": [f"Finding {i + 1}"],
                "keywords": ["x", "y"],
                "language": "en",
            },
            "excerpts": [
                {
                    "text": f"Excerpt for paper {pid}.",
                    "pageNumber": f"S. {(i + 1) * 10}",
                    "relevanceNote": "supports the claim",
                },
            ],
        })
    return {
        "section": {
            "_id": "sec1",
            "orderNumber": "1.1",
            "title": "Sample Section",
            "depth": 1,
            "notes": None,
        },
        "parents": [],
        "siblings": [],
        "body": None,
        "matches": matches,
        "thesisLanguage": "en",
        "resolvedLanguage": "en",
    }


# ---------------------------------------------------------------------------
# build_detect_messages
# ---------------------------------------------------------------------------


class TestBuildDetectMessages:
    """Prompt-construction guarantees for /detect-citations."""

    def test_includes_allowed_paper_ids(self):
        """The user prompt must list every match's paperId so the model
        knows which ids are acceptable in suggested_paper_ids."""
        payload = _sample_payload(num_papers=2)
        body = "First sentence. Second sentence."
        _, user = section_writer.build_detect_messages(payload, body)
        assert "<allowed_paper_ids>" in user
        assert "p1" in user
        assert "p2" in user

    def test_wraps_body_in_draft_block(self):
        """The body must appear inside its own <draft> tag so the model
        cannot confuse it with the corpus excerpts."""
        payload = _sample_payload()
        body = "A claim sentence with details."
        _, user = section_writer.build_detect_messages(payload, body)
        assert "<draft>" in user
        assert "</draft>" in user
        assert body in user

    def test_system_prompt_lists_claim_types(self):
        """All four claim_type values must appear in the system prompt
        so the model knows the enum it's expected to populate."""
        payload = _sample_payload()
        system, _ = section_writer.build_detect_messages(payload, "x")
        for claim_type in ("empirical", "theoretical", "data", "general"):
            assert claim_type in system


# ---------------------------------------------------------------------------
# parse_detect_response
# ---------------------------------------------------------------------------


class TestParseDetectResponse:
    """Robustness of the strict-JSON detect parser."""

    def test_parses_well_formed_response(self):
        raw = json.dumps({
            "items": [
                {
                    "claim_sentence": "Recent surveys show X.",
                    "claim_type": "empirical",
                    "suggested_paper_ids": ["p1"],
                    "reason": "Empirical claim.",
                },
            ],
        })
        result = section_writer.parse_detect_response(raw, ["p1", "p2"])
        assert len(result["items"]) == 1
        assert result["items"][0]["suggested_paper_ids"] == ["p1"]
        assert result["warnings"] == []

    def test_drops_unknown_paper_ids(self):
        """Entries whose suggested ids are entirely outside the allowed
        list are dropped (not just filtered) — there's nothing useful
        the user can do with a citation suggestion that points outside
        their corpus."""
        raw = json.dumps({
            "items": [
                {
                    "claim_sentence": "Claim with bad ids.",
                    "claim_type": "general",
                    "suggested_paper_ids": ["unknown1", "unknown2"],
                    "reason": "r",
                },
                {
                    "claim_sentence": "Claim with mixed ids.",
                    "claim_type": "general",
                    "suggested_paper_ids": ["unknown1", "p1"],
                    "reason": "r",
                },
            ],
        })
        result = section_writer.parse_detect_response(raw, ["p1"])
        assert len(result["items"]) == 1
        assert result["items"][0]["suggested_paper_ids"] == ["p1"]
        assert any("Dropped 1" in w for w in result["warnings"])

    def test_drops_empty_claim_sentence(self):
        raw = json.dumps({
            "items": [
                {
                    "claim_sentence": "",
                    "claim_type": "empirical",
                    "suggested_paper_ids": ["p1"],
                    "reason": "r",
                },
                {
                    "claim_sentence": "Real claim.",
                    "claim_type": "empirical",
                    "suggested_paper_ids": ["p1"],
                    "reason": "r",
                },
            ],
        })
        result = section_writer.parse_detect_response(raw, ["p1"])
        assert len(result["items"]) == 1
        assert result["items"][0]["claim_sentence"] == "Real claim."

    def test_normalises_unknown_claim_type_to_general(self):
        raw = json.dumps({
            "items": [{
                "claim_sentence": "X.",
                "claim_type": "philosophical",
                "suggested_paper_ids": ["p1"],
                "reason": "r",
            }],
        })
        result = section_writer.parse_detect_response(raw, ["p1"])
        assert result["items"][0]["claim_type"] == "general"

    def test_tolerates_trailing_prose(self):
        """Real-world models occasionally leak natural-language prose
        around the JSON despite the contract. The first-to-last brace
        slice rescues a valid object."""
        raw = (
            "Here is the analysis:\n\n"
            + json.dumps({"items": [{
                "claim_sentence": "X.",
                "claim_type": "empirical",
                "suggested_paper_ids": ["p1"],
                "reason": "r",
            }]})
            + "\n\nLet me know if you need more."
        )
        result = section_writer.parse_detect_response(raw, ["p1"])
        assert len(result["items"]) == 1

    def test_caps_at_max_items(self):
        big = {"items": [
            {
                "claim_sentence": f"Claim {i}.",
                "claim_type": "general",
                "suggested_paper_ids": ["p1"],
                "reason": "r",
            }
            for i in range(500)
        ]}
        result = section_writer.parse_detect_response(json.dumps(big), ["p1"])
        # The cap is an internal soft limit (200). We only assert that the
        # result is materially smaller than the input and that a warning
        # surfaces — the exact cap value is an implementation detail.
        assert len(result["items"]) < 500
        assert any("Capped" in w for w in result["warnings"])

    def test_returns_empty_on_invalid_json(self):
        result = section_writer.parse_detect_response(
            "not json at all", ["p1"]
        )
        assert result["items"] == []
        assert result["warnings"]


# ---------------------------------------------------------------------------
# chunk_body_for_detection
# ---------------------------------------------------------------------------


class TestChunkBodyForDetection:
    def test_short_body_returns_single_chunk(self):
        body = "Short body."
        assert section_writer.chunk_body_for_detection(body) == [body]

    def test_long_body_splits_on_paragraph_boundary(self):
        # Build a body well above the 40k char budget composed of many
        # paragraphs, so we can assert the split happens between them.
        para = "x" * 10_000
        body = "\n\n".join([para] * 6)  # ~60k chars
        chunks = section_writer.chunk_body_for_detection(body)
        assert len(chunks) >= 2
        # No chunk should contain a sub-paragraph split — every chunk
        # must end on a complete paragraph.
        for chunk in chunks:
            assert chunk.startswith("x")
            assert chunk.endswith("x")


# ---------------------------------------------------------------------------
# build_validate_messages + parse_validate_response
# ---------------------------------------------------------------------------


class TestBuildValidateMessages:
    def test_lists_each_placeholder_with_candidates(self):
        payload = _sample_payload(num_papers=2)
        items = [
            {
                "placeholder_id": "abc12345",
                "claim_sentence": "Claim text.",
                "candidate_paper_ids": ["p1", "p2"],
            },
        ]
        _, user = section_writer.build_validate_messages(payload, items)
        assert "<placeholders>" in user
        assert "abc12345" in user
        assert "Claim text." in user
        assert "p1" in user and "p2" in user


class TestParseValidateResponse:
    def test_parses_well_formed_results(self):
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {
                        "paper_id": "p1",
                        "score": 0.92,
                        "page_ref_from_excerpt": "S. 10",
                        "justification": "Excerpt directly supports.",
                    },
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1", "p2"], {"p1": {"S. 10"}, "p2": set()}
        )
        assert len(result["results"]) == 1
        cand = result["results"][0]["candidates"][0]
        assert cand["paper_id"] == "p1"
        assert cand["score"] == 0.92
        assert cand["page_ref_from_excerpt"] == "S. 10"

    def test_filters_unknown_candidate_paper_ids(self):
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "unknown", "score": 0.9, "page_ref_from_excerpt": "S. 1"},
                    {"paper_id": "p1", "score": 0.5, "page_ref_from_excerpt": "S. 10"},
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1"], {"p1": {"S. 10"}}
        )
        assert len(result["results"][0]["candidates"]) == 1
        assert result["results"][0]["candidates"][0]["paper_id"] == "p1"

    def test_clamps_score_to_unit_interval(self):
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "p1", "score": 1.5, "page_ref_from_excerpt": "S. 10"},
                    {"paper_id": "p1", "score": -0.3, "page_ref_from_excerpt": "S. 10"},
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1"], {"p1": {"S. 10"}}
        )
        scores = [c["score"] for c in result["results"][0]["candidates"]]
        for s in scores:
            assert 0.0 <= s <= 1.0
        # Sorted high-to-low so the clamped-to-1.0 entry leads.
        assert scores[0] >= scores[-1]

    def test_clamps_page_to_allowed_set(self):
        """Page numbers the model invents are forced to 'S. ?' rather
        than dropped — matches the validate_citation_markers policy."""
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "p1", "score": 0.9, "page_ref_from_excerpt": "S. 999"},
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1"], {"p1": {"S. 10"}}
        )
        assert result["results"][0]["candidates"][0]["page_ref_from_excerpt"] == "S. ?"

    def test_accepts_numeric_page_form_against_excerpt(self):
        """Excerpt page 'S. 10' should validate when model returns '10' —
        loose match against the trailing digits."""
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "p1", "score": 0.9, "page_ref_from_excerpt": "10"},
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1"], {"p1": {"S. 10"}}
        )
        assert result["results"][0]["candidates"][0]["page_ref_from_excerpt"] == "10"

    def test_sorts_candidates_by_score_desc(self):
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "p1", "score": 0.4, "page_ref_from_excerpt": "S. 10"},
                    {"paper_id": "p2", "score": 0.9, "page_ref_from_excerpt": "S. 20"},
                    {"paper_id": "p1", "score": 0.7, "page_ref_from_excerpt": "S. 10"},
                ],
            }],
        })
        result = section_writer.parse_validate_response(
            raw, ["p1", "p2"], {"p1": {"S. 10"}, "p2": {"S. 20"}}
        )
        scores = [c["score"] for c in result["results"][0]["candidates"]]
        assert scores == sorted(scores, reverse=True)

    def test_returns_empty_on_invalid_json(self):
        result = section_writer.parse_validate_response("not json", ["p1"])
        assert result == {"results": []}

    def test_missing_page_falls_back_to_question_mark(self):
        raw = json.dumps({
            "results": [{
                "placeholder_id": "abc12345",
                "candidates": [
                    {"paper_id": "p1", "score": 0.9, "page_ref_from_excerpt": ""},
                ],
            }],
        })
        result = section_writer.parse_validate_response(raw, ["p1"], {"p1": set()})
        assert result["results"][0]["candidates"][0]["page_ref_from_excerpt"] == "S. ?"


class TestChunkValidateItems:
    def test_under_cap_returns_single_batch(self):
        items = [{"placeholder_id": str(i)} for i in range(5)]
        assert section_writer.chunk_validate_items(items) == [items]

    def test_above_cap_splits(self):
        items = [{"placeholder_id": str(i)} for i in range(60)]
        batches = section_writer.chunk_validate_items(items)
        assert len(batches) >= 2
        total = sum(len(b) for b in batches)
        assert total == 60
