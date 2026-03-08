import { useLanguage, type Language } from "@/lib/LanguageContext";

const options: { value: Language; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "de", label: "DE" },
];

export default function LanguageSelector() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center rounded-md border border-border/50 overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setLanguage(opt.value)}
          className={`px-2 py-1 transition-colors ${
            language === opt.value
              ? "bg-amber/15 text-amber font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
