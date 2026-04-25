import { useProvider, type Provider } from "@/lib/ProviderContext";

const options: { value: Provider; label: string }[] = [
  { value: "openai", label: "GPT" },
  { value: "anthropic", label: "Claude" },
];

export default function ProviderToggle() {
  const { provider, setProvider } = useProvider();

  return (
    <div className="flex items-center rounded-md border border-border/50 overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setProvider(opt.value)}
          className={`px-2 py-1 transition-colors ${
            provider === opt.value
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
