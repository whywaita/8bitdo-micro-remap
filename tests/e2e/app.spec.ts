import { test, expect, type Page } from "@playwright/test";
async function connect(page: Page, scenario = "") {
  await page.goto("./?scenario=" + scenario);
  await page.getByRole("button", { name: "コントローラーを接続" }).click();
  await expect(
    page.getByRole("heading", { name: "ボタンの割り当て" }),
  ).toBeVisible();
}
async function edit(page: Page) {
  await page.getByRole("button", { name: /^A の割り当て/ }).click();
  await page
    .getByRole("combobox", { name: "キー", exact: true })
    .selectOption("40");
  await page.getByRole("button", { name: "下書きに適用" }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "デバイスに保存" }).click();
  await expect(
    page.getByRole("heading", { name: "変更を保存しますか" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存を確定" }).click();
}
test("unsupported browser has no connect action", async ({ page }) => {
  await page.goto("./?scenario=unsupported");
  await expect(page).toHaveTitle("8BitDo Micro Remap");
  await expect(
    page.getByRole("heading", { name: "このブラウザでは接続できません" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "コントローラーを接続" }),
  ).toHaveCount(0);
});
test("connects all sixteen mappings and cancel discards editor changes", async ({
  page,
}) => {
  await connect(page);
  await expect(page.locator(".mapping-button")).toHaveCount(16);
  await page.getByRole("button", { name: /^A の割り当て/ }).click();
  await page
    .getByRole("combobox", { name: "キー", exact: true })
    .selectOption("40");
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(
    page.getByRole("button", { name: "デバイスに保存" }),
  ).toBeDisabled();
});
test("saves, backs up first, restores, and retains backup after reload", async ({
  page,
}) => {
  await connect(page);
  await edit(page);
  await save(page);
  await expect(page.getByText(/Verified/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "A の割り当て Enter", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__microTests!.writes)).toEqual([
    1, 1, 1, 1, 6,
  ]);
  expect(
    await page.evaluate(() => window.__microTests!.backedUpBeforeWrite),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "コントローラーを接続" }).click();
  await page.getByRole("button", { name: "バックアップ", exact: true }).click();
  await page.getByRole("button", { name: "復元内容を確認" }).first().click();
  await page.getByRole("button", { name: "復元を確定" }).click();
  await expect(page.getByText(/Verified/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "A の割り当て 無効", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__microTests!.unknownByte)).toBe(42);
});
test("page 3 failure does not send commit", async ({ page }) => {
  await connect(page, "write-failure");
  await edit(page);
  await save(page);
  await expect(page.getByText(/設定の転送に失敗しました/)).toBeVisible();
  expect(await page.evaluate(() => window.__microTests!.writes)).not.toContain(
    6,
  );
});
for (const scenario of ["crc-failure", "mismatch"])
  test(`verification ${scenario} never succeeds`, async ({ page }) => {
    await connect(page, scenario);
    await edit(page);
    await save(page);
    await expect(
      page.getByText(/保存・復元の結果を確認できません/),
    ).toBeVisible();
    await expect(page.getByText(/Verified/)).toHaveCount(0);
  });
test("disconnect during verification returns to disconnected", async ({
  page,
}) => {
  await connect(page, "disconnect");
  await edit(page);
  await save(page);
  await expect(
    page.getByRole("button", { name: "コントローラーを接続" }),
  ).toBeEnabled();
  await expect(page.getByText(/Verified/)).toHaveCount(0);
});
test("Pages subpath loads with static CSP and reloads without a server fallback", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("pageerror", (error) => violations.push(error.message));
  await page.goto("./");
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "コントローラーを接続" }),
  ).toBeVisible();
  expect(violations).toEqual([]);
  const missing = await page.request.get("./missing-route");
  expect(missing.status()).toBe(404);
});
test("320px layout fits and keyboard editor traps focus", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await connect(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: /^A の割り当て/ }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "キーボードから入力" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".chord-preview")).toHaveText("Escape");
});
test("profile export downloads valid JSON and import only changes draft", async ({
  page,
}) => {
  await connect(page);
  await edit(page);
  await page.getByRole("button", { name: "書き出す", exact: true }).click();
  await page.getByRole("textbox", { name: "プロファイル名" }).fill("Work");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON をダウンロード" }).click();
  const file = await downloaded;
  const path = await file.path();
  expect(path).toBeTruthy();
  const json = JSON.parse(
    await (await import("node:fs/promises")).readFile(path!, "utf8"),
  );
  expect(json.schema).toBe("8bitdo-micro-profile/v1");
  expect(json.mappings.a.key).toBe(40);
  expect(json.payloadBase64).toBeUndefined();
  await page.getByRole("button", { name: "プロファイルを読込" }).click();
  await page.getByLabel("プロファイルファイル").setInputFiles({
    name: "profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(json)),
  });
  await expect(
    page.getByRole("heading", { name: "Work", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下書きに適用" }).click();
  expect(await page.evaluate(() => window.__microTests!.writes)).toEqual([]);
  await expect(
    page.getByRole("button", { name: "デバイスに保存" }),
  ).toBeEnabled();
});
test("invalid import shows actionable error in dialog without writes", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: "プロファイルを読込" }).click();
  await page.getByLabel("プロファイルファイル").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "プロファイルの形式",
  );
  expect(await page.evaluate(() => window.__microTests!.writes)).toEqual([]);
});
test("normal client operations request only same-origin resources", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) requests.push(req.url());
  });
  await connect(page);
  await edit(page);
  await save(page);
  await expect(page.getByText(/Verified/)).toBeVisible();
  expect(
    requests.every((url) => new URL(url).origin === "http://127.0.0.1:4173"),
  ).toBe(true);
});
test("desktop and mobile review screenshots", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const raw = new Uint8Array(180);
    const mappings = [
      [12, 40],
      [16, 42],
      [20, 224, 6],
      [24, 224, 25],
      [28, 224],
      [32, 225],
      [36, 224, 29],
      [40, 224, 225, 29],
      [52, 75],
      [56, 78],
      [60, 41],
      [64, 44],
      [68, 82],
      [72, 81],
      [76, 80],
      [80, 79],
    ];
    for (const [offset, ...keys] of mappings) raw.set(keys, offset!);
    sessionStorage.setItem("fake-device", btoa(String.fromCharCode(...raw)));
  });
  await connect(page);
  await page
    .getByRole("combobox", { name: "Language / 言語" })
    .selectOption("en");
  await page.screenshot({
    path: testInfo.outputPath("mapping-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^A mapping/ }).click();
  await page
    .getByRole("combobox", { name: "Key", exact: true })
    .selectOption("22");
  await page.getByRole("checkbox", { name: "ctrl", exact: true }).check();
  await page.screenshot({
    path: testInfo.outputPath("editor-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({
    path: testInfo.outputPath("editor-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Apply to draft" }).click();
  await page.getByRole("button", { name: "Save to device" }).click();
  await expect(
    page.getByRole("heading", { name: "Save changes?" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("save-confirmation.png"),
    fullPage: true,
  });
});

test("English settings persist and support editing on a narrow screen", async ({
  page,
}) => {
  await connect(page);
  await page
    .getByRole("combobox", { name: "Language / 言語" })
    .selectOption("en");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /^A mapping/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit A mapping" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Key", exact: true })
    .selectOption("40");
  await page.getByRole("button", { name: "Apply to draft" }).click();
  await page.getByRole("checkbox", { name: "Disable automatic sleep" }).check();
  await page.getByRole("button", { name: "Save to device" }).click();
  await expect(
    page.getByRole("heading", { name: "Save changes?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Disable automatic sleep" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm save" }).click();
  await expect(page.getByText(/Verified/)).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Connect controller" }).click();
  await expect(
    page.getByRole("button", { name: "A mapping Enter", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import profile" }).click();
  await page.getByLabel("Profile file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Check the profile format, name, and mappings.",
  );
});

test("English readback failure offers translated recovery instructions", async ({
  page,
}) => {
  await connect(page, "mismatch");
  await edit(page);
  await save(page);
  await page
    .getByRole("combobox", { name: "Language / 言語" })
    .selectOption("en");
  await expect(page.getByRole("alert")).toContainText(
    "Could not verify the save or restore.",
  );
  await page.getByRole("button", { name: "Recovery instructions" }).click();
  await expect(
    page.getByRole("heading", { name: "Usage and recovery" }),
  ).toBeVisible();
});
