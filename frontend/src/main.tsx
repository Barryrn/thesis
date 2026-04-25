import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { LanguageProvider } from "./lib/LanguageContext";
import { ProviderProvider } from "./lib/ProviderContext";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import BibliographyPage from "./components/BibliographyPage";
import "./index.css";

const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL as string
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <LanguageProvider>
      <ProviderProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/bibliography" element={<BibliographyPage />} />
        </Routes>
        <Toaster richColors position="bottom-right" />
      </BrowserRouter>
      </ProviderProvider>
      </LanguageProvider>
    </ConvexProvider>
  </React.StrictMode>
);
