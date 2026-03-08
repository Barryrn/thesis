import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDER = `1 Introduction
/* Motivation and thesis structure overview */
2 Literature Review
2.1 Digital Transformation
2.2 AI in Healthcare
/* Focus on ML adoption in clinical settings */
2.2.1 Machine Learning Adoption
3 Methodology
3.1 Research Design
3.2 Data Collection
4 Results
5 Discussion
6 Conclusion`;

interface OutlineTextInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function OutlineTextInput({
  value,
  onChange,
}: OutlineTextInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Raw Text</label>
        <span className="text-xs text-muted-foreground">
          Format: "1.2.3 Section Title" &middot; Notes: /* your note */
        </span>
      </div>
      <Textarea
        placeholder={PLACEHOLDER}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
        className="font-mono text-sm w-full"
      />
    </div>
  );
}
