interface StatStripProps {
  total: number;
  completed: number;
  processing: number;
  failed: number;
}

export default function StatStrip({
  total,
  completed,
  processing,
  failed,
}: StatStripProps) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground">
        <span className="text-foreground font-semibold text-sm">{total}</span>{" "}
        papers
      </span>
      <span className="text-muted-foreground/40">|</span>
      <span className="text-sage">
        <span className="font-semibold text-sm">{completed}</span> done
      </span>
      <span className="text-muted-foreground/40">|</span>
      <span className="text-dusty-blue">
        <span className="font-semibold text-sm">{processing}</span> processing
      </span>
      {failed > 0 && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-destructive">
            <span className="font-semibold text-sm">{failed}</span> failed
          </span>
        </>
      )}
    </div>
  );
}
