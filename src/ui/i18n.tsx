import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { english } from "./messages";
export type Language = "ja" | "en";
export const LANGUAGE_KEY = "8bitdo-micro-remap.language";
export function readLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}
export function translate(
  language: Language,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const normalized = key.replace(/\s+/g, " ").trim();
  let result =
    language === "en" ? (english[normalized] ?? normalized) : normalized;
  if (language === "en") {
    result = result
      .replace(
        /^保存後の読み戻し失敗: (.+) \/ 受信 (\d+)\/4 ページ$/,
        "Readback failed: $1 / Received $2/4 pages",
      )
      .replace(
        /^読み戻し不一致: (\d+) バイト \/ オフセット \(0始まり\): (.+)$/,
        "Readback mismatch: $1 bytes / Offsets (zero-based): $2",
      );
  }
  return result.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}
const Context = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}>({
  language: "ja" as Language,
  setLanguage: () => {},
  t: (key: string, values?: Record<string, string | number>) =>
    translate("ja", key, values),
});
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<Language>(readLanguage);
  function setLanguage(value: Language) {
    update(value);
    try {
      localStorage.setItem(LANGUAGE_KEY, value);
    } catch {
      /* Language remains usable when storage is unavailable. */
    }
  }
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <Context.Provider
      value={{
        language,
        setLanguage,
        t: (key, values) => translate(language, key, values),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLanguage() {
  return useContext(Context);
}
