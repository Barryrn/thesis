"""AI matcher that scores a paper against a set of user-defined groups.

The Convex action layer assembles the payload and calls the FastAPI
``/suggest-groups`` endpoint defined in ``main.py``; this module only
builds the prompt, invokes ``ai_client.chat_completion``, parses the
JSON, and applies the confidence threshold.
"""

import json

import ai_client


# Hardcoded baseline. The user-supplied group description is the only variable
# input — it appears inside the JSON payload, not the system prompt.
SYSTEM_PROMPT = (
    "You are a research-paper classifier. You receive ONE paper (title plus "
    "structured summary fields) and a list of user-defined paper groups, "
    "each with a free-form description that defines what belongs in it. "
    "Decide which groups the paper belongs to.\n\n"
    "Output a JSON array. Each element must look like: "
    '{"groupId": "<id>", "confidence": 0.0-1.0, "reason": "<one sentence>"}.\n'
    "Only include groups where confidence is at least 0.7. "
    "Return [] if no group matches. "
    "Output JSON only — no prose, no markdown fences."
)

# Suggestions below this confidence are filtered server-side as a defense
# against models that ignore the prompt's threshold instruction.
CONFIDENCE_FLOOR = 0.7


def suggest_for_paper(
    paper: dict,
    groups: list[dict],
    provider: str = "anthropic",
) -> list[dict]:
    """Return the high-confidence group matches for a single paper.

    ``paper`` must contain ``title`` and ``summary`` (with the structured
    fields ``researchQuestion``, ``methodology``, ``keyFindings``,
    ``keywords``). ``groups`` is a list of ``{"groupId", "description"}``.
    """
    if not groups:
        return []

    summary = paper.get("summary", {}) or {}
    payload = {
        "paper": {
            "title": paper.get("title", ""),
            "researchQuestion": summary.get("researchQuestion", ""),
            "methodology": summary.get("methodology", ""),
            "keyFindings": summary.get("keyFindings", []),
            "keywords": summary.get("keywords", []),
        },
        "groups": [
            {
                "groupId": g["groupId"],
                "description": g.get("description", ""),
            }
            for g in groups
        ],
    }
    user_message = json.dumps(payload, ensure_ascii=False)

    raw = ai_client.chat_completion(
        provider, "grouper", SYSTEM_PROMPT, user_message, 1024
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Model returned something un-parseable. Treat as "no match" rather
        # than blowing up the whole suggestion run.
        return []
    if not isinstance(parsed, list):
        return []

    valid_group_ids = {g["groupId"] for g in groups}
    out: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        gid = item.get("groupId")
        if gid not in valid_group_ids:
            continue
        try:
            confidence = float(item.get("confidence", 0))
        except (TypeError, ValueError):
            continue
        if confidence < CONFIDENCE_FLOOR:
            continue
        reason = str(item.get("reason", "")).strip()
        out.append(
            {
                "groupId": gid,
                "confidence": confidence,
                "reason": reason,
            }
        )
    return out
