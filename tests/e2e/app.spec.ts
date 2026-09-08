import { test, expect, type Page } from "@playwright/test";
async function connect(page: Page, scenario = "") {
  await page.goto("/?scenario=" + scenario);
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
  await page.goto("/?scenario=unsupported");
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
test("nested route through Worker carries security headers", async ({
  page,
}) => {
  const response = await page.goto("/mapping/edit");
  expect(response?.headers()["permissions-policy"]).toBe("bluetooth=(self)");
  expect(response?.headers()["content-security-policy"]).not.toContain(
    "unsafe-inline",
  );
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "コントローラーを接続" }),
  ).toBeVisible();
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connect(page);
  await page.screenshot({
    path: testInfo.outputPath("mapping-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^A の割り当て/ }).click();
  await page.screenshot({
    path: testInfo.outputPath("editor-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({
    path: testInfo.outputPath("editor-mobile.png"),
    fullPage: true,
  });
});
