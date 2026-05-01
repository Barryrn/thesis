/// Three-tier sentence locator used by the auto-cite detect phase.
///
/// The Python /detect-citations endpoint returns a `claim_sentence` that is
/// supposed to be a verbatim substring of the body — but in practice the LLM
/// occasionally normalises whitespace, swaps smart quotes, or drops a comma.
/// `findSentenceEnd` resolves the claim against the live body and returns the
/// character offset of the natural insertion point (end of the matching
/// sentence, before any trailing whitespace) so the caller can splice a
/// `{{citeNeeded:...}}` marker in cleanly.

/// Result tiers ordered loosest to tightest. Carrying the tier on the result
/// lets the hook tell the user "we found this fuzzily" if we ever need to.
export type SentenceMatchTier = "exact" | "normalized" | "fuzzy";

export interface SentenceMatchResult {
  /// Character offset in `body` where the citation marker should be inserted.
  /// This is *after* the matched sentence's terminal punctuation but *before*
  /// any whitespace or newline that follows.
  insertionOffset: number;
  /// Which tier of the matcher succeeded. `null` is never returned — call
  /// sites should branch on `findSentenceEnd` returning null instead.
  tier: SentenceMatchTier;
}

/// Minimum Jaccard token overlap for the fuzzy fallback to accept a match.
/// Below this we'd rather drop the suggestion than place it wrongly.
const MIN_FUZZY_JACCARD = 0.6;

/// German + English sentence terminators. We treat `.`, `!`, `?` as boundaries
/// when followed by whitespace and a capital letter — this avoids splitting
/// on common abbreviations like "S. 12" or "z. B." within a sentence.
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+(?=[A-ZÄÖÜ])/g;

/// Punctuation we strip when comparing tokens so "claim." and "claim" match.
const TRAILING_PUNCT_RE = /[.,;:!?"„"»«()\[\]]+$/;

/// Locates the end of `claim` inside `body`. Returns null when even the
/// fuzzy tier fails the minimum overlap threshold.
export function findSentenceEnd(
  body: string,
  claim: string
): SentenceMatchResult | null {
  const trimmedClaim = claim.trim();
  if (!trimmedClaim) return null;

  // Tier 1: exact substring match. The fast path covers the case where the
  // model obeyed the verbatim contract.
  const exactIdx = body.indexOf(trimmedClaim);
  if (exactIdx >= 0) {
    return {
      insertionOffset: insertionOffsetAfter(body, exactIdx + trimmedClaim.length),
      tier: "exact",
    };
  }

  // Tier 2: whitespace-normalized search. Collapse runs of whitespace on both
  // sides, search, then map the result back to an offset in the original
  // body. This catches "double  space" and stray newlines without losing
  // character-accurate insertion points.
  const normalizedMatch = matchAfterWhitespaceNormalize(body, trimmedClaim);
  if (normalizedMatch !== null) {
    return {
      insertionOffset: insertionOffsetAfter(body, normalizedMatch),
      tier: "normalized",
    };
  }

  // Tier 3: token-overlap fuzzy match. Split body into sentences, compute
  // Jaccard overlap on lowercased word tokens, and accept the best sentence
  // if it clears MIN_FUZZY_JACCARD. This is the case where the model
  // paraphrased instead of quoting verbatim.
  const claimTokens = tokenize(trimmedClaim);
  if (claimTokens.size === 0) return null;

  const sentences = splitIntoSentences(body);
  let best: { offset: number; score: number } | null = null;
  for (const s of sentences) {
    const score = jaccardOverlap(claimTokens, tokenize(s.text));
    if (score < MIN_FUZZY_JACCARD) continue;
    if (best === null || score > best.score) {
      best = { offset: s.endOffset, score };
    }
  }
  if (best !== null) {
    return {
      insertionOffset: insertionOffsetAfter(body, best.offset),
      tier: "fuzzy",
    };
  }

  return null;
}

/// Walks back past trailing whitespace from `endOffset` to find the position
/// directly after the matched sentence's terminal punctuation. Inserting at
/// the returned offset places the marker before the space/newline that
/// follows the sentence — which is the visually correct spot for a footnote.
function insertionOffsetAfter(body: string, endOffset: number): number {
  let i = endOffset;
  while (i > 0 && /\s/.test(body[i - 1])) i--;
  return i;
}

/// Searches for `needle` inside `haystack` ignoring whitespace differences,
/// returning the offset in `haystack` immediately after the matched range.
/// Returns null when no match exists.
function matchAfterWhitespaceNormalize(
  haystack: string,
  needle: string
): number | null {
  // Build a lookup from positions in the normalized haystack back to offsets
  // in the original. This way we can run a cheap indexOf on the normalized
  // pair and translate the result back without re-walking the original.
  const norm: string[] = [];
  const map: number[] = []; // map[i] = original offset of norm[i]
  let prevWasSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const c = haystack[i];
    if (/\s/.test(c)) {
      if (prevWasSpace) continue;
      norm.push(" ");
      map.push(i);
      prevWasSpace = true;
    } else {
      norm.push(c);
      map.push(i);
      prevWasSpace = false;
    }
  }
  const normHaystack = norm.join("");
  const normNeedle = needle.replace(/\s+/g, " ");

  const idx = normHaystack.indexOf(normNeedle);
  if (idx < 0) return null;

  const lastNormIdx = idx + normNeedle.length - 1;
  // The original offset just past the final matched character is map[last]+1.
  return map[lastNormIdx] + 1;
}

/// Splits `body` into rough sentences using a German-aware boundary regex.
/// Each entry carries the offset of the sentence's end (just past its
/// terminal punctuation) so the caller can compute an insertion point.
function splitIntoSentences(body: string): { text: string; endOffset: number }[] {
  const out: { text: string; endOffset: number }[] = [];
  let cursor = 0;
  // matchAll on a non-sticky regex — since the regex is a lookbehind/lookahead
  // pair, we walk through matches manually using exec on a stateful copy.
  const re = new RegExp(SENTENCE_BOUNDARY_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const sentenceEnd = m.index; // index of the whitespace after `.`
    const sentenceText = body.slice(cursor, sentenceEnd);
    out.push({ text: sentenceText, endOffset: sentenceEnd });
    cursor = m.index + m[0].length;
  }
  // Trailing sentence (or whole body when no boundary fired).
  if (cursor < body.length) {
    out.push({ text: body.slice(cursor), endOffset: body.length });
  }
  return out;
}

/// Lowercased word tokens with trailing punctuation stripped. Used by the
/// Jaccard fallback so "claim." ≈ "claim" and "Müller" ≈ "müller".
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const cleaned = raw.replace(TRAILING_PUNCT_RE, "");
    if (cleaned) out.add(cleaned);
  }
  return out;
}

/// |A∩B| / |A∪B|, returning 0 when both sets are empty.
function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
