/// Initializes react-i18next with static German and English translation bundles.
/// Reads the initial language from localStorage to stay in sync with LanguageContext.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import de from "@/locales/de.json";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: localStorage.getItem("thesis-output-language") || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
