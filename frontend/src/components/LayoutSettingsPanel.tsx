/// Settings panel for document layout configuration.
/// Rendered inside ThesisPreviewModal's left sidebar when the
/// gear icon is toggled. Changes trigger the onChange callback
/// which debounces auto-save to Convex.

import { useCallback, useState } from "react";
import { RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LayoutSettings } from "@/lib/documentCompiler";
import { DEFAULT_LAYOUT, MARGIN_PRESETS } from "@/lib/documentCompiler";

interface LayoutSettingsPanelProps {
  layoutSettings: LayoutSettings;
  onChange: (settings: LayoutSettings) => void;
  onReset: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Returns the name of the matching margin preset, or "Custom".
function activeMarginPreset(margins: LayoutSettings["margins"]): string {
  for (const [name, preset] of Object.entries(MARGIN_PRESETS)) {
    if (
      preset.top === margins.top &&
      preset.bottom === margins.bottom &&
      preset.left === margins.left &&
      preset.right === margins.right
    ) {
      return name;
    }
  }
  return "Custom";
}

/// True when every field matches the HKA default.
function isDefault(settings: LayoutSettings): boolean {
  return (
    settings.fontSize === DEFAULT_LAYOUT.fontSize &&
    settings.lineSpacing === DEFAULT_LAYOUT.lineSpacing &&
    settings.margins.top === DEFAULT_LAYOUT.margins.top &&
    settings.margins.bottom === DEFAULT_LAYOUT.margins.bottom &&
    settings.margins.left === DEFAULT_LAYOUT.margins.left &&
    settings.margins.right === DEFAULT_LAYOUT.margins.right &&
    settings.pageNumbering.position === DEFAULT_LAYOUT.pageNumbering.position &&
    settings.pageNumbering.format === DEFAULT_LAYOUT.pageNumbering.format &&
    settings.pageNumbering.startPage === DEFAULT_LAYOUT.pageNumbering.startPage
  );
}

/// Shared CSS classes for small number inputs.
const INPUT_CLASS =
  "w-full rounded-md border border-border/40 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber/40";

// ── Component ────────────────────────────────────────────────────────

export default function LayoutSettingsPanel({
  layoutSettings,
  onChange,
  onReset,
}: LayoutSettingsPanelProps) {
  const presetLabel = isDefault(layoutSettings) ? "HKA Standard" : "Custom";
  const [marginsExpanded, setMarginsExpanded] = useState(false);

  const update = useCallback(
    (patch: Partial<LayoutSettings>) => {
      onChange({ ...layoutSettings, ...patch });
    },
    [layoutSettings, onChange]
  );

  const updateMargin = useCallback(
    (side: keyof LayoutSettings["margins"], value: number) => {
      onChange({
        ...layoutSettings,
        margins: { ...layoutSettings.margins, [side]: value },
      });
    },
    [layoutSettings, onChange]
  );

  const updatePageNumbering = useCallback(
    (patch: Partial<LayoutSettings["pageNumbering"]>) => {
      onChange({
        ...layoutSettings,
        pageNumbering: { ...layoutSettings.pageNumbering, ...patch },
      });
    },
    [layoutSettings, onChange]
  );

  return (
    <div className="w-56 shrink-0 border-r border-border/30 overflow-y-auto p-3 space-y-4">
      {/* Header */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Layout Settings
        </p>
        <span className="text-[10px] text-amber/80 font-medium">
          {presetLabel}
        </span>
      </div>

      {/* ── Font Size ──────────────────────────────────────────────── */}
      <Section label="Font Size">
        <SegmentedControl
          options={[10, 11, 12]}
          value={layoutSettings.fontSize}
          onChange={(v) => update({ fontSize: v })}
          format={(v) => `${v}pt`}
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <label className="text-[10px] text-muted-foreground shrink-0">Custom</label>
          <input
            type="number"
            min={8}
            max={16}
            step={1}
            value={layoutSettings.fontSize}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 8 && val <= 16) {
                update({ fontSize: val });
              }
            }}
            className={INPUT_CLASS + " !w-14"}
          />
          <span className="text-[10px] text-muted-foreground">pt</span>
        </div>
      </Section>

      {/* ── Line Spacing ───────────────────────────────────────────── */}
      <Section label="Line Spacing">
        <SegmentedControl
          options={[1.0, 1.15, 1.5]}
          value={layoutSettings.lineSpacing}
          onChange={(v) => update({ lineSpacing: v })}
          format={(v) => `${v}`}
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <label className="text-[10px] text-muted-foreground shrink-0">Custom</label>
          <input
            type="number"
            min={0.8}
            max={3.0}
            step={0.05}
            value={layoutSettings.lineSpacing}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0.8 && val <= 3.0) {
                update({ lineSpacing: val });
              }
            }}
            className={INPUT_CLASS + " !w-16"}
          />
        </div>
      </Section>

      {/* ── Page Margins ───────────────────────────────────────────── */}
      <Section label="Page Margins">
        <select
          value={activeMarginPreset(layoutSettings.margins)}
          onChange={(e) => {
            const preset = MARGIN_PRESETS[e.target.value];
            if (preset) update({ margins: { ...preset } });
          }}
          className={INPUT_CLASS}
        >
          {Object.keys(MARGIN_PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {activeMarginPreset(layoutSettings.margins) === "Custom" && (
            <option value="Custom">Custom</option>
          )}
        </select>

        {/* Collapsible custom margin inputs */}
        <button
          onClick={() => setMarginsExpanded((v) => !v)}
          className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {marginsExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          Customize
        </button>

        {marginsExpanded && (
          <div className="mt-1.5 space-y-1.5">
            {(["top", "bottom", "left", "right"] as const).map((side) => (
              <div key={side} className="flex items-center gap-1.5">
                <label className="text-[10px] text-muted-foreground w-11 capitalize">
                  {side}
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={5.0}
                  step={0.1}
                  value={layoutSettings.margins[side]}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0.5 && val <= 5.0) {
                      updateMargin(side, Math.round(val * 10) / 10);
                    }
                  }}
                  className={INPUT_CLASS + " !w-16"}
                />
                <span className="text-[10px] text-muted-foreground">cm</span>
              </div>
            ))}
          </div>
        )}

        {!marginsExpanded && (
          <p className="text-[9px] text-muted-foreground mt-1">
            L:{layoutSettings.margins.left} R:{layoutSettings.margins.right}{" "}
            T:{layoutSettings.margins.top} B:{layoutSettings.margins.bottom}cm
          </p>
        )}
      </Section>

      {/* ── Page Numbering ─────────────────────────────────────────── */}
      <Section label="Page Numbers">
        {/* Position */}
        <label className="text-[10px] text-muted-foreground">Position</label>
        <SegmentedControl
          options={["header", "footer"]}
          value={layoutSettings.pageNumbering.position}
          onChange={(v) =>
            updatePageNumbering({
              position: v as LayoutSettings["pageNumbering"]["position"],
            })
          }
          format={(v) => (v === "header" ? "Top" : "Bottom")}
        />

        {/* Format */}
        <label className="text-[10px] text-muted-foreground mt-2 block">
          Format
        </label>
        <select
          value={layoutSettings.pageNumbering.format}
          onChange={(e) =>
            updatePageNumbering({
              format: e.target.value as LayoutSettings["pageNumbering"]["format"],
            })
          }
          className={INPUT_CLASS}
        >
          <option value="automatic">Automatic (roman + arabic)</option>
          <option value="allArabic">All Arabic (1, 2, 3)</option>
          <option value="allRoman">All Roman (i, ii, iii)</option>
        </select>

        {/* Start page */}
        <label className="text-[10px] text-muted-foreground mt-2 block">
          Start Page
        </label>
        <input
          type="number"
          min={1}
          max={99}
          value={layoutSettings.pageNumbering.startPage}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1) {
              updatePageNumbering({ startPage: val });
            }
          }}
          className={INPUT_CLASS + " !w-16"}
        />
      </Section>

      {/* ── Reset button ───────────────────────────────────────────── */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground"
        onClick={onReset}
        disabled={isDefault(layoutSettings)}
      >
        <RotateCcw className="size-3 mr-1" />
        Reset to HKA Standard
      </Button>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

/// Labelled section wrapper for the settings panel.
function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

/// Button group acting as a single-select segmented control.
/// When the current value doesn't match any option, no button is highlighted.
function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="flex rounded-md border border-border/40 overflow-hidden">
      {options.map((opt) => (
        <button
          key={String(opt)}
          onClick={() => onChange(opt)}
          className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
            opt === value
              ? "bg-amber/20 text-amber"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}
