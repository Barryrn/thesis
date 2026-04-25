import { createContext, useContext, useState, type ReactNode } from "react";

export type Provider = "openai" | "anthropic";

type ProviderContextValue = {
  provider: Provider;
  setProvider: (p: Provider) => void;
};

const ProviderContext = createContext<ProviderContextValue | null>(null);

const STORAGE_KEY = "thesis-ai-provider";

export function ProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProviderState] = useState<Provider>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "anthropic" ? "anthropic" : "openai";
  });

  function setProvider(p: Provider) {
    setProviderState(p);
    localStorage.setItem(STORAGE_KEY, p);
  }

  return (
    <ProviderContext.Provider value={{ provider, setProvider }}>
      {children}
    </ProviderContext.Provider>
  );
}

export function useProvider() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error("useProvider must be used within ProviderProvider");
  return ctx;
}
