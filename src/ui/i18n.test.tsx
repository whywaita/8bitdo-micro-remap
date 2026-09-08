// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LANGUAGE_KEY,
  LanguageProvider,
  readLanguage,
  translate,
  useLanguage,
} from "./i18n";
import { ERROR_MESSAGES } from "../application/errors";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("defaults to Japanese for missing or invalid preferences", () => {
  expect(readLanguage()).toBe("ja");
  localStorage.setItem(LANGUAGE_KEY, "fr");
  expect(readLanguage()).toBe("ja");
});
it("allows language changes when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  function Sample() {
    const { t, setLanguage } = useLanguage();
    return <button onClick={() => setLanguage("en")}>{t("ヘルプ")}</button>;
  }
  render(
    <LanguageProvider>
      <Sample />
    </LanguageProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "ヘルプ" }));
  expect(screen.getByRole("button", { name: "Help" })).toBeTruthy();
});
it("provides English recovery messages for every application error", () => {
  for (const message of Object.values(ERROR_MESSAGES))
    expect(translate("en", message)).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
});
