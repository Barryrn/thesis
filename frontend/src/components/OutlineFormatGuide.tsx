import { Info, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface OutlineFormatGuideProps {
  onClose: () => void;
}

export default function OutlineFormatGuide({ onClose }: OutlineFormatGuideProps) {
  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Info className="size-4 text-blue-600" /> Outline Format Guide
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Each line should follow:{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                &lt;number&gt; &lt;Section Title&gt;
              </code>
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium mb-1">Input format:</p>
            <pre className="text-xs font-mono bg-muted/70 p-2 rounded-md whitespace-pre leading-relaxed">
{`1 Introduction
2 Literature Review
2.1 Digital Transformation
2.2 AI in Healthcare
2.2.1 Machine Learning Adoption
3 Methodology
3.1 Research Design
3.2 Data Collection
4 Results
5 Discussion
6 Conclusion`}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Resulting structure:</p>
            <div className="text-xs bg-muted/70 p-2 rounded-md space-y-0.5 font-mono leading-relaxed">
              <div>1 Introduction</div>
              <div>2 Literature Review</div>
              <div className="pl-4">2.1 Digital Transformation</div>
              <div className="pl-4">2.2 AI in Healthcare</div>
              <div className="pl-8">2.2.1 Machine Learning Adoption</div>
              <div>3 Methodology</div>
              <div className="pl-4">3.1 Research Design</div>
              <div className="pl-4">3.2 Data Collection</div>
              <div>4 Results</div>
              <div>5 Discussion</div>
              <div>6 Conclusion</div>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-medium mb-1">Section notes (optional):</p>
          <pre className="text-xs font-mono bg-muted/70 p-2 rounded-md whitespace-pre leading-relaxed">
{`1 Introduction
/* This section covers motivation and thesis structure */
2 Literature Review
2.1 Digital Transformation
/* Focus specifically on healthcare DT, not general DT
- Include recent case studies
- Compare with non-healthcare sectors */`}
          </pre>
          <p className="text-xs text-muted-foreground mt-1">
            Notes help the AI better match papers to sections during upload.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
