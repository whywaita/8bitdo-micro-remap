// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createRuntime } from "../application/runtime";
import { ScriptedTransport } from "../../tests/helpers/scripted-transport";
import { MicroDatabase } from "../storage/database";
let db: MicroDatabase;
let device: ScriptedTransport;
let runtime: ReturnType<typeof createRuntime>;
beforeEach(() => {
  db = new MicroDatabase(`ui-${crypto.randomUUID()}`);
  device = new ScriptedTransport();
  runtime = createRuntime(() => device, db, true, {
    readTimeout: 100,
    loadDelay: 0,
    saveDelay: 0,
    preparedTtl: 60000,
  });
});
afterEach(async () => {
  cleanup();
  runtime.dispose();
  await db.delete();
});
async function connect() {
  await userEvent.click(
    screen.getByRole("button", { name: "コントローラーを接続" }),
  );
  await screen.findByRole("heading", { name: "ボタンの割り当て" });
}
it("explains unsupported browsers before connect", () => {
  render(<App runtime={{ ...runtime, supported: false }} />);
  expect(screen.getByText(/このブラウザでは接続できません/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "8BitDo Micro Remap" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "コントローラーを接続" }),
  ).toBeNull();
});
it("cancels editor draft without writes", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(device.writes.some((p) => p[1] === 1)).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "デバイスに保存" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("edits, requires confirmation and verifies", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.selectOptions(screen.getByLabelText("キー"), "40");
  await userEvent.click(screen.getByRole("button", { name: "下書きに適用" }));
  await userEvent.click(screen.getByRole("button", { name: "デバイスに保存" }));
  await screen.findByRole("heading", { name: "変更を保存しますか" });
  expect(device.writes.some((p) => p[1] === 1)).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "保存を確定" }));
  await waitFor(() => expect(screen.getByText(/Verified/)).toBeTruthy());
  expect(device.payload[12]).toBe(40);
});
it("Escape during capture is a key, not dialog dismissal", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "キーボードから入力" }),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    screen.getByText("Escape", { selector: ".chord-preview" }),
  ).toBeTruthy();
});
it("verification failure never shows success", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.selectOptions(screen.getByLabelText("キー"), "40");
  await userEvent.click(screen.getByRole("button", { name: "下書きに適用" }));
  await userEvent.click(screen.getByRole("button", { name: "デバイスに保存" }));
  await screen.findByRole("heading", { name: "変更を保存しますか" });
  device.transform = (p) => {
    p[6] = 0;
    return [p];
  };
  await userEvent.click(screen.getByRole("button", { name: "保存を確定" }));
  await screen.findByText(/保存・復元の結果を確認できません/);
  expect(screen.queryByText(/Verified/)).toBeNull();
});
it("keyboard capture lets keyboard users leave capture after a key", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "キーボードから入力" }),
  );
  await userEvent.keyboard("a");
  await userEvent.tab();
  expect(document.activeElement?.textContent).not.toContain("ここにフォーカス");
});
it("shows export errors inside the active dialog", async () => {
  device.payload[12] = 255;
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: "書き出す" }));
  await userEvent.type(screen.getByLabelText("プロファイル名"), "test");
  await userEvent.click(
    screen.getByRole("button", { name: "JSON をダウンロード" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toContain(
      "プロファイルの形式、名前、割り当てを確認してください。",
    ),
  );
});
it("restore requires confirmation and preserves unknown current bytes", async () => {
  const backup = new Uint8Array(180);
  backup[12] = 40;
  backup[150] = 99;
  await runtime.backups.save(backup, "manual");
  device.payload[150] = 42;
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^バックアップ$/ }));
  await userEvent.click(
    await screen.findByRole("button", { name: "復元内容を確認" }),
  );
  await screen.findByRole("heading", { name: "対応する設定を復元しますか" });
  expect(device.writes.some((p) => p[1] === 1)).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "復元を確定" }));
  await screen.findByText(/Verified/);
  expect(device.payload[12]).toBe(40);
  expect(device.payload[150]).toBe(42);
});
it("does not silently turn a held right modifier into a left modifier", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "キーボードから入力" }),
  );
  await userEvent.keyboard("[ControlRight>][KeyA]");
  expect(screen.getByRole("dialog").textContent).toContain(
    "右側の修飾キーは未対応",
  );
  expect(
    screen.queryByText("Ctrl + A", { selector: ".chord-preview" }),
  ).toBeNull();
});
it("chooser cancellation remains nonfatal and reconnectable", async () => {
  device.connectFromUserGesture = async () => {
    throw new (await import("../application/errors")).AppError(
      "CHOOSER_CANCELLED",
    );
  };
  render(<App runtime={runtime} />);
  await userEvent.click(
    screen.getByRole("button", { name: "コントローラーを接続" }),
  );
  await screen.findByText("接続をキャンセルしました。");
  expect(
    screen
      .getByRole("button", { name: "コントローラーを接続" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("read errors never expose an editable partial mapping", async () => {
  device.transform = () => [];
  render(<App runtime={runtime} />);
  await userEvent.click(
    screen.getByRole("button", { name: "コントローラーを接続" }),
  );
  await screen.findByText(/読み込みがタイムアウトしました/);
  expect(
    screen.queryByRole("heading", { name: "ボタンの割り当て" }),
  ).toBeNull();
});
it("disconnect clears the mapping and permits reconnect", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: "切断" }));
  await screen.findByRole("button", { name: "コントローラーを接続" });
  expect(
    screen.queryByRole("heading", { name: "ボタンの割り当て" }),
  ).toBeNull();
});
it("applying an unchanged mapping does not create dirty state", async () => {
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.click(screen.getByRole("button", { name: "下書きに適用" }));
  expect(
    screen
      .getByRole("button", { name: "デバイスに保存" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("corrupted saved profiles do not prevent importing a new file", async () => {
  const { profileFromConfig } = await import("../storage/profiles");
  const { parseConfig } = await import("../protocol/config");
  const profile = profileFromConfig("Broken", parseConfig(new Uint8Array(180)));
  await db.profiles.put({
    ...profile,
    mappings: {
      ...profile.mappings,
      a: { kind: "chord", modifiers: [], key: 255 },
    },
  });
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(
    screen.getByRole("button", { name: "プロファイルを読込" }),
  );
  await screen.findByRole("dialog");
  expect(screen.getByLabelText("プロファイルファイル")).toBeTruthy();
});
it("switches language without losing a draft and restores the preference", async () => {
  localStorage.clear();
  render(<App runtime={runtime} />);
  await connect();
  await userEvent.click(screen.getByRole("button", { name: /^A の割り当て/ }));
  await userEvent.selectOptions(screen.getByLabelText("キー"), "40");
  await userEvent.click(screen.getByRole("button", { name: "下書きに適用" }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Language / 言語" }),
    "en",
  );
  expect(screen.getByRole("heading", { name: "Button mappings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "A mapping Enter" })).toBeTruthy();
  expect(localStorage.getItem("8bitdo-micro-remap.language")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  cleanup();
  render(<App runtime={runtime} />);
  expect(screen.getByRole("button", { name: "Backups" })).toBeTruthy();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Language / 言語" }),
    "ja",
  );
  expect(document.documentElement.lang).toBe("ja");
  localStorage.clear();
});
