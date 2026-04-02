# Text Optimize Toolbar — Design Spec

## Problem

Users writing thesis text in the Write tab need a way to quickly improve selected passages — enhancing clarity, formalizing tone, simplifying language, or expanding detail — without leaving the editor or risking loss of inline citations.

## Solution

Add a fixed toolbar row with four optimize buttons (Enhance, Formalize, Simplify, Expand) to the `SectionWriteEditor`. When the user selects text and clicks a button, the selected text is sent to the Python backend for AI-powered optimization via a new `/optimize` endpoint. The result appears in an inline preview panel with Accept/Discard controls. Citations are protected throughout using a placeholder-swap strategy.

## Modes

| Mode | Purpose | AI Instruction Summary |
|------|---------|----------------------|
| **Enhance** | Improve clarity, flow, and word choice | Rewrite for better readability while preserving meaning |
| **Formalize** | Convert to formal academic tone | Rewrite in formal scholarly language suitable for a thesis |
| **Simplify** | Remove unnecessary complexity | Make the text clearer and more concise |
| **Expand** | Add more detail and depth | Elaborate on the ideas with additional detail |

## Citation Safety

The critical invariant: **citations must never be lost or corrupted**.

### Strategy: Placeholder Swap

1. **Before AI call**: Scan the selected text for `{{cite:ID::Label}}` markers. Replace each with a numbered placeholder `[REF1]`, `[REF2]`, etc. Store the mapping.
2. **AI prompt**: Instruct the model to preserve all `[REFN]` markers exactly as-is, in the same positions relative to the surrounding text.
3. **After AI response**: Replace `[REF1]`, `[REF2]` back with the original `{{cite:...}}` markers using the stored mapping.
4. **Validation**: If any `[REFN]` placeholder is missing from the response, show an error ("Citation was lost during optimization — please try again") rather than silently dropping citations.

### Utility Functions (in `citationUtils.ts`)

```typescript
replaceCitationsWithPlaceholders(text: string): {
  cleanText: string;
  placeholderMap: Map<string, string>; // "[REF1]" → "{{cite:abc::Label}}"
}

restoreCitationsFromPlaceholders(
  optimizedText: string,
  placeholderMap: Map<string, string>
): { restoredText: string; missingRefs: string[] }
```

## Backend API

### `POST /optimize`

New endpoint on the existing Python FastAPI server (`python/main.py`).

**Request:**
```json
{
  "text": "selected text with [REF1] placeholders",
  "mode": "enhance",
  "context": {
    "before": "sentence before selection for flow context",
    "after": "sentence after selection for flow context"
  }
}
```

**Response:**
```json
{
  "optimizedText": "improved text with [REF1] preserved"
}
```

**Error Response (4xx/5xx):**
```json
{
  "detail": "error description"
}
```

### Implementation Details

- Uses the existing `OpenAI` client and `OPENAI_API_KEY` from the Python service
- New module `python/optimizer.py` with mode-specific system prompts
- Model: same as `summarizer.py` (GPT-4o or equivalent)
- Each mode has a tailored system prompt emphasizing:
  - The specific optimization goal
  - Preserving `[REFN]` markers exactly
  - Maintaining the same general meaning
  - Not adding new information for enhance/formalize/simplify modes
- Uses existing `pipeline_logger` for `log_openai_call` / `log_openai_response`

### Context Extraction

The frontend extracts ~1 sentence of surrounding text:
- **Before context**: text from the last period/newline before the selection start (up to 200 chars)
- **After context**: text to the next period/newline after the selection end (up to 200 chars)
- Context is stripped of citation markers by replacing `{{cite:ID::Label}}` with the Label text (e.g., `(Smith et al., 2023)`) so the AI sees readable prose without gaps
- Sent in the `context` field so the AI can produce text that flows naturally

## Frontend Design

### Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/SectionWriteEditor.tsx` | Add selection tracking, optimize buttons, preview panel, loading/error states |
| `frontend/src/lib/citationUtils.ts` | Add `replaceCitationsWithPlaceholders()` and `restoreCitationsFromPlaceholders()` |
| `frontend/src/lib/types.ts` | Add `OptimizeMode` type |

### Files Created

| File | Purpose |
|------|---------|
| `python/optimizer.py` | AI text optimization module with mode-specific prompts |

### UI States

1. **Idle**: Optimize buttons visible but disabled (no text selected)
2. **Ready**: Text selected → buttons become active (amber highlight on hover)
3. **Loading**: User clicked a mode → preview panel shows spinner + "Enhancing selected text..."
4. **Preview**: AI response received → preview panel shows optimized text + Accept/Discard buttons. Toolbar dimmed, textarea read-only.
5. **Error**: AI call failed or citation validation failed → error message in preview panel with Dismiss button

### Toolbar Layout

Buttons added to the existing toolbar row in `SectionWriteEditor`, separated from the `@ to cite` hint by a visual divider:

```
[@ to cite hint] | Optimize: [Enhance] [Formalize] [Simplify] [Expand]    [Preview] [Save status]
```

- Buttons use the existing pill-button style (`text-[11px] px-2 py-0.5 rounded-full`)
- Active/hover state matches the amber theme (`bg-amber/10 text-amber`)
- Disabled state: `text-muted-foreground/40 cursor-not-allowed`

### Preview Panel

- Appears between toolbar and textarea when AI returns a result
- Amber-accented border (`border-amber/30`)
- Header row: mode label (e.g., "Enhanced Text") + Accept/Discard buttons
- Body: the optimized text in the same font as the textarea
- Accept: splices text into body at the original selection range, triggers `scheduleSave()`
- Discard: closes preview, restores normal editing

### Selection Tracking

- Track `selectionStart` and `selectionEnd` via the textarea's `onSelect` event
- **Important**: The existing `handleSelect` in `SectionWriteEditor.tsx` already handles `@`-trigger detection for the citation picker. The new selection-tracking logic must be **added to** the existing `handleSelect` handler (not replace it). After the `@`-trigger check, read and store `textarea.selectionStart` / `textarea.selectionEnd` in refs.
- Store in local state refs (not React state, to avoid re-renders on every cursor move)
- Clear selection state when preview is active

### Flow

1. User selects text in textarea
2. Clicks an optimize button (e.g., "Enhance")
3. Frontend: `replaceCitationsWithPlaceholders()` on the selection
4. Frontend: extract surrounding context (~1 sentence before/after)
5. `POST ${PYTHON_SERVICE_URL}/optimize` with text, mode, context (reuse the existing `PYTHON_SERVICE_URL` constant from `UploadZone.tsx`, extract it to a shared config)
6. Loading spinner in preview panel
7. Response received → `restoreCitationsFromPlaceholders()`
8. If missing refs → show error in preview panel
9. If OK → show optimized text in preview panel
10. User clicks Accept → splice into body → `scheduleSave()` → close preview
11. User clicks Discard → close preview, no changes

## Verification

1. **Manual testing**:
   - Select text without citations → optimize → verify result replaces correctly
   - Select text with citations → optimize → verify citations preserved exactly
   - Select text with multiple citations → verify all preserved
   - Test all four modes produce different results
   - Test Discard does not modify the text
   - Test Accept triggers auto-save
   - Test with Python backend offline → verify error state appears
2. **Citation safety tests**:
   - Unit test `replaceCitationsWithPlaceholders` and `restoreCitationsFromPlaceholders`
   - Test edge cases: citation at start/end of selection, multiple adjacent citations, empty text between citations
   - Test validation: response missing a placeholder → error shown
3. **Backend tests**:
   - Test `/optimize` endpoint returns valid response for each mode
   - Test error handling (empty text, invalid mode)
