"""Tests for the smart paper recommender.

Covers batching, JSON parsing, score clamping, low-context fallback, and
language propagation. The LLM call (``ai_client.chat_completion``) is
patched so the tests are deterministic and offline.
"""

import asyncio
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import recommender


def _make_paper(pid: str, title: str = "") -> dict:
    """Build a payload-shaped paper with the structured summary fields."""
    return {
        "paperId": pid,
        "title": title or f"Paper {pid}",
        "authors": ["Doe, Jane"],
        "year": 2024,
        "summary": {
            "researchQuestion": "Does X cause Y?",
            "methodology": "Mixed methods",
            "keyFindings": ["X correlates with Y"],
            "keywords": ["x", "y"],
        },
    }


def _run(coro):
    """Drive the async recommender from sync test code."""
    return asyncio.get_event_loop().run_until_complete(coro)


class TestIsLowContext:
    """Threshold check for the title-only fallback flag."""

    def test_short_body_and_notes_is_low_context(self):
        assert recommender.is_low_context({"body": "x", "notes": "y"}) is True

    def test_long_body_alone_is_high_context(self):
        body = "a" * 60
        assert recommender.is_low_context({"body": body, "notes": ""}) is False

    def test_combined_body_and_notes_clear_threshold(self):
        body = "a" * 30
        notes = "b" * 30
        assert recommender.is_low_context({"body": body, "notes": notes}) is False

    def test_missing_keys_treated_as_empty(self):
        assert recommender.is_low_context({}) is True


class TestParseBatchResponse:
    """JSON robustness: malformed rows must not poison the batch."""

    def test_clean_response_returns_all_rows(self):
        raw = json.dumps(
            [
                {"paperId": "p1", "score": 0.8, "reasoning": "fits"},
                {"paperId": "p2", "score": 0.3, "reasoning": "weak"},
            ]
        )
        out = recommender._parse_batch_response(raw, {"p1", "p2"})
        assert len(out) == 2
        assert out[0]["paperId"] == "p1" and out[0]["score"] == 0.8

    def test_unknown_paper_id_is_dropped(self):
        raw = json.dumps([{"paperId": "ghost", "score": 0.9, "reasoning": "x"}])
        out = recommender._parse_batch_response(raw, {"p1"})
        assert out == []

    def test_score_above_one_is_clamped(self):
        raw = json.dumps([{"paperId": "p1", "score": 1.7, "reasoning": "x"}])
        out = recommender._parse_batch_response(raw, {"p1"})
        assert out[0]["score"] == 1.0

    def test_score_below_zero_is_clamped(self):
        raw = json.dumps([{"paperId": "p1", "score": -0.4, "reasoning": "x"}])
        out = recommender._parse_batch_response(raw, {"p1"})
        assert out[0]["score"] == 0.0

    def test_invalid_json_returns_empty(self):
        out = recommender._parse_batch_response("not json", {"p1"})
        assert out == []

    def test_non_list_response_returns_empty(self):
        out = recommender._parse_batch_response('{"oops": true}', {"p1"})
        assert out == []


class TestRecommendBatching:
    """End-to-end: batches are formed correctly and merged into ranked output."""

    def test_papers_are_chunked_into_batches_of_twelve(self):
        papers = [_make_paper(f"p{i}") for i in range(25)]
        seen_batch_sizes: list[int] = []

        def fake_chat(provider, module, system, user_message, max_tokens):
            payload = json.loads(user_message)
            batch = payload["papers"]
            seen_batch_sizes.append(len(batch))
            return json.dumps(
                [
                    {"paperId": p["paperId"], "score": 0.5, "reasoning": "ok"}
                    for p in batch
                ]
            )

        with patch.object(recommender.ai_client, "chat_completion", fake_chat):
            result = _run(
                recommender.recommend(
                    {"title": "T", "body": "a" * 200, "notes": ""},
                    papers,
                    language="en",
                )
            )

        # 25 papers / 12 = batches of 12, 12, 1.
        assert sorted(seen_batch_sizes) == [1, 12, 12]
        assert len(result["recommendations"]) == 25

    def test_results_are_sorted_by_score_desc(self):
        papers = [_make_paper(f"p{i}") for i in range(3)]
        scores = {"p0": 0.2, "p1": 0.9, "p2": 0.5}

        def fake_chat(provider, module, system, user_message, max_tokens):
            payload = json.loads(user_message)
            return json.dumps(
                [
                    {
                        "paperId": p["paperId"],
                        "score": scores[p["paperId"]],
                        "reasoning": "x",
                    }
                    for p in payload["papers"]
                ]
            )

        with patch.object(recommender.ai_client, "chat_completion", fake_chat):
            result = _run(
                recommender.recommend(
                    {"title": "T", "body": "a" * 200, "notes": ""},
                    papers,
                )
            )

        ordered = [r["paperId"] for r in result["recommendations"]]
        assert ordered == ["p1", "p2", "p0"]

    def test_low_context_flag_propagates_to_response(self):
        """Title-only input flows through to the lowContext flag."""
        papers = [_make_paper("p1")]

        with patch.object(
            recommender.ai_client,
            "chat_completion",
            return_value=json.dumps(
                [{"paperId": "p1", "score": 0.5, "reasoning": "ok"}]
            ),
        ):
            result = _run(
                recommender.recommend(
                    {"title": "Only a title", "body": "", "notes": ""},
                    papers,
                )
            )

        assert result["lowContext"] is True

    def test_german_language_selects_german_system_prompt(self):
        """The DE prompt is used when language='de' so reasoning lands in German."""
        papers = [_make_paper("p1")]
        captured_system: list[str] = []

        def fake_chat(provider, module, system, user_message, max_tokens):
            captured_system.append(system)
            return json.dumps([{"paperId": "p1", "score": 0.5, "reasoning": "x"}])

        with patch.object(recommender.ai_client, "chat_completion", fake_chat):
            _run(
                recommender.recommend(
                    {"title": "T", "body": "a" * 200, "notes": ""},
                    papers,
                    language="de",
                )
            )

        # The German prompt contains "Forschungsfrage"-flavoured German;
        # the English one does not. A spot-check is enough.
        assert "JSON" in captured_system[0]
        assert "Empfehlungssystem" in captured_system[0]

    def test_empty_papers_list_skips_llm(self):
        """No candidates → no API calls, lowContext still computed."""
        with patch.object(recommender.ai_client, "chat_completion") as mock:
            result = _run(
                recommender.recommend(
                    {"title": "T", "body": "", "notes": ""},
                    [],
                )
            )
        mock.assert_not_called()
        assert result["recommendations"] == []
        assert result["lowContext"] is True
