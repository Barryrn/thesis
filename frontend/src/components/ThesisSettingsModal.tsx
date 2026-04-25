import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface ThesisSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/// Full-screen settings modal for thesis metadata (Deckblatt, abstracts, etc.).
/// Data is stored as a singleton document in the thesisMetadata table.
export default function ThesisSettingsModal({
  open,
  onOpenChange,
}: ThesisSettingsModalProps) {
  const metadata = useQuery(api.thesisMetadata.getMetadata);
  const upsert = useMutation(api.thesisMetadata.upsertMetadata);
  const [saving, setSaving] = useState(false);

  // ── Form state ──────────────────────────────────────────────────────
  const [studentName, setStudentName] = useState("");
  const [studentAddress, setStudentAddress] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [universityEmail, setUniversityEmail] = useState("");
  const [matrikelnummer, setMatrikelnummer] = useState("");
  const [titleDE, setTitleDE] = useState("");
  const [titleEN, setTitleEN] = useState("");
  const [subtitleDE, setSubtitleDE] = useState("");
  const [subtitleEN, setSubtitleEN] = useState("");
  const [studiengang, setStudiengang] = useState("");
  const [erstpruefer, setErstpruefer] = useState("");
  const [zweitpruefer, setZweitpruefer] = useState("");
  const [abgabedatum, setAbgabedatum] = useState("");
  const [abstractDE, setAbstractDE] = useState("");
  const [abstractEN, setAbstractEN] = useState("");
  const [keywordsDE, setKeywordsDE] = useState("");
  const [keywordsEN, setKeywordsEN] = useState("");

  // Sync form state from server when metadata loads
  useEffect(() => {
    if (metadata) {
      setStudentName(metadata.studentName ?? "");
      setStudentAddress(metadata.studentAddress ?? "");
      setStudentEmail(metadata.studentEmail ?? "");
      setUniversityEmail(metadata.universityEmail ?? "");
      setMatrikelnummer(metadata.matrikelnummer ?? "");
      setTitleDE(metadata.titleDE ?? "");
      setTitleEN(metadata.titleEN ?? "");
      setSubtitleDE(metadata.subtitleDE ?? "");
      setSubtitleEN(metadata.subtitleEN ?? "");
      setStudiengang(metadata.studiengang ?? "");
      setErstpruefer(metadata.erstpruefer ?? "");
      setZweitpruefer(metadata.zweitpruefer ?? "");
      setAbgabedatum(metadata.abgabedatum ?? "");
      setAbstractDE(metadata.abstractDE ?? "");
      setAbstractEN(metadata.abstractEN ?? "");
      setKeywordsDE(metadata.keywordsDE?.join(", ") ?? "");
      setKeywordsEN(metadata.keywordsEN?.join(", ") ?? "");
    }
  }, [metadata]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await upsert({
        studentName: studentName || "Unnamed",
        studentAddress: studentAddress || undefined,
        studentEmail: studentEmail || undefined,
        universityEmail: universityEmail || undefined,
        matrikelnummer: matrikelnummer || undefined,
        titleDE: titleDE || "Untitled",
        titleEN: titleEN || undefined,
        subtitleDE: subtitleDE || undefined,
        subtitleEN: subtitleEN || undefined,
        studiengang: studiengang || undefined,
        erstpruefer: erstpruefer || undefined,
        zweitpruefer: zweitpruefer || undefined,
        abgabedatum: abgabedatum || undefined,
        abstractDE: abstractDE || undefined,
        abstractEN: abstractEN || undefined,
        keywordsDE: keywordsDE
          ? keywordsDE.split(",").map((k) => k.trim()).filter(Boolean)
          : undefined,
        keywordsEN: keywordsEN
          ? keywordsEN.split(",").map((k) => k.trim()).filter(Boolean)
          : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("[SETTINGS] Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [
    upsert, onOpenChange,
    studentName, studentAddress, studentEmail, universityEmail, matrikelnummer,
    titleDE, titleEN, subtitleDE, subtitleEN, studiengang,
    erstpruefer, zweitpruefer, abgabedatum,
    abstractDE, abstractEN, keywordsDE, keywordsEN,
  ]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full !max-w-xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Thesis Settings</SheetTitle>
          <SheetDescription>
            Deckblatt, abstracts, and formatting metadata
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* ── Personal Information ─────────────────────────────────── */}
          <SettingsSection title="Personal Information">
            <Field label="Full Name *" value={studentName} onChange={setStudentName} />
            <Field label="Address" value={studentAddress} onChange={setStudentAddress} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Private Email" value={studentEmail} onChange={setStudentEmail} />
              <Field label="University Email" value={universityEmail} onChange={setUniversityEmail} />
            </div>
            <Field label="Matrikelnummer" value={matrikelnummer} onChange={setMatrikelnummer} />
          </SettingsSection>

          {/* ── Thesis Information ───────────────────────────────────── */}
          <SettingsSection title="Thesis Information">
            <Field label="Title (German) *" value={titleDE} onChange={setTitleDE} />
            <Field label="Title (English)" value={titleEN} onChange={setTitleEN} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Subtitle (German)" value={subtitleDE} onChange={setSubtitleDE} />
              <Field label="Subtitle (English)" value={subtitleEN} onChange={setSubtitleEN} />
            </div>
            <Field label="Studiengang" value={studiengang} onChange={setStudiengang} />
          </SettingsSection>

          {/* ── Supervisors ──────────────────────────────────────────── */}
          <SettingsSection title="Supervisors">
            <Field label="Erstprüfer (Titel, Vorname, Nachname)" value={erstpruefer} onChange={setErstpruefer} />
            <Field label="Zweitprüfer (Titel, Vorname, Nachname)" value={zweitpruefer} onChange={setZweitpruefer} />
            <Field label="Submission Date" value={abgabedatum} onChange={setAbgabedatum} type="date" />
          </SettingsSection>

          {/* ── Abstracts ────────────────────────────────────────────── */}
          <SettingsSection title="Abstracts">
            <TextareaField
              label="Kurzfassung (German, ~10 lines)"
              value={abstractDE}
              onChange={setAbstractDE}
            />
            <TextareaField
              label="Abstract (English, ~10 lines)"
              value={abstractEN}
              onChange={setAbstractEN}
            />
            <Field
              label="Keywords (German, comma-separated, max 10)"
              value={keywordsDE}
              onChange={setKeywordsDE}
              placeholder="e.g. Machine Learning, Datenanalyse, ..."
            />
            <Field
              label="Keywords (English, comma-separated, max 10)"
              value={keywordsEN}
              onChange={setKeywordsEN}
              placeholder="e.g. Machine Learning, Data Analysis, ..."
            />
          </SettingsSection>

          {/* ── Save button ──────────────────────────────────────────── */}
          <Button
            onClick={handleSave}
            disabled={saving || !studentName || !titleDE}
            className="w-full bg-amber hover:bg-amber/90 text-background"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Reusable form components ─────────────────────────────────────────

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border/30 bg-transparent px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber/30 transition-colors placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-border/30 bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber/30 transition-colors resize-y placeholder:text-muted-foreground/40"
      />
    </div>
  );
}
