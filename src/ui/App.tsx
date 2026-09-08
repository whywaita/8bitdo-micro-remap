import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Runtime } from "../application/runtime";
import {
  BUTTONS,
  BUTTON_BY_ID,
  isButtonId,
  type ButtonId,
} from "../protocol/buttons";
import { applyConfigEdits, parseConfig, equalBytes } from "../protocol/config";
import { formatChord } from "../protocol/hid-codec";
import type { ConfigEdits } from "../protocol/types";
import {
  AppError,
  ERROR_MESSAGES,
  errorCode,
  type ErrorCode,
} from "../application/errors";
import type { PreparedSave } from "../application/controller-service";
import {
  profileFromConfig,
  parseProfile,
  serializeProfile,
} from "../storage/profiles";
import type { Profile, RawBackup } from "../storage/schemas";
import { Modal, ModalErrorContext } from "./components/Modal";
import { MappingEditor } from "./components/MappingEditor";
const phaseLabels = {
  disconnected: "未接続",
  choosing: "コントローラーを選択してください",
  connecting: "接続しています",
  subscribing: "設定の受信を準備しています",
  reading: "設定を読み込んでいます",
  ready: "接続済み",
  preparing: "最新設定を読み込み、バックアップを保存しています",
  confirming: "変更内容の確認",
  saving: "設定を転送しています",
  committing: "設定を確定しています",
  verifying: "本体から読み直して照合しています",
  error: "操作を完了できませんでした",
};
type Panel =
  | "backups"
  | "help"
  | "log"
  | "import"
  | "export"
  | "discard"
  | "disconnect"
  | "delete"
  | null;
export function App({ runtime }: { runtime: Runtime }) {
  const state = useStore(runtime.store);
  const [edits, setEdits] = useState<ConfigEdits>({ mappings: {} });
  const [editing, setEditing] = useState<ButtonId | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [prepared, setPrepared] = useState<PreparedSave | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [backups, setBackups] = useState<RawBackup[]>([]);
  const [invalidBackupCount, setInvalidBackupCount] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [imported, setImported] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [notice, setNotice] = useState("");
  const busy = !["ready", "disconnected", "error"].includes(state.phase);
  const draft = state.snapshot
    ? parseConfig(applyConfigEdits(state.snapshot, edits))
    : null;
  const dirty = Boolean(
    draft && state.snapshot && !equalBytes(draft.raw, state.snapshot.raw),
  );
  const ready = state.phase === "ready";
  const activeError = error ?? state.error;
  useEffect(() => {
    if (state.phase === "disconnected") {
      setPrepared(null);
      setEditing(null);
      setEdits({ mappings: {} });
    }
  }, [state.phase]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function run(action: () => Promise<unknown>) {
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorCode(e, "STORAGE_FAILED"));
    }
  }
  function reset() {
    setEdits({ mappings: {} });
    setPanel(null);
    setEditing(null);
    setPrepared(null);
  }
  async function read() {
    reset();
    await runtime.service.readCurrentConfig();
  }
  async function showBackups() {
    const inventory = await runtime.backups.inspect();
    setBackups(inventory.backups);
    setInvalidBackupCount(inventory.invalidCount);
    setPanel("backups");
  }
  function cancelPrepared() {
    runtime.service.cancelPrepared();
    setPrepared(null);
  }
  function showImport() {
    void run(async () => {
      setImported(null);
      setProfiles([]);
      setPanel("import");
      setProfiles(await runtime.profiles.list());
    });
  }
  async function saveProfile() {
    if (!draft) return;
    const profile = profileFromConfig(name, draft);
    await runtime.profiles.save(profile);
    const blob = new Blob([serializeProfile(profile)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.name.replace(/[^\p{L}\p{N}_ -]/gu, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPanel(null);
    setNotice("プロファイルを書き出しました。");
  }
  const clearPanel = () => {
    setPanel(null);
    setImported(null);
  };
  return (
    <ModalErrorContext.Provider
      value={activeError ? ERROR_MESSAGES[activeError] : null}
    >
      <a className="skip" href="#main">
        本文へ
      </a>
      <header>
        <a className="brand" href="#main">
          MICRO<span>WEB CONFIGURATOR</span>
        </a>
        <nav aria-label="メイン">
          <button disabled={busy} onClick={() => void run(showBackups)}>
            バックアップ
          </button>
          <button disabled={busy} onClick={() => setPanel("help")}>
            ヘルプ
          </button>
        </nav>
      </header>
      <main id="main">
        <p className="eyebrow">8BITDO MICRO / KEYBOARD MODE</p>
        <div role="status" aria-live="polite" className="status">
          {phaseLabels[state.phase]}
          {busy && <span> · {state.progress} / 4</span>}
        </div>
        {state.verified && !dirty && (
          <p className="success">
            Verified · ページCRCと設定178バイトの一致を確認しました。
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {activeError && (
          <section role="alert" className="notice">
            <p>{ERROR_MESSAGES[activeError]}</p>
            {[
              "VERIFY_FAILED",
              "WRITE_FAILED",
              "COMMIT_FAILED",
              "DISCONNECTED",
            ].includes(activeError) && (
              <button onClick={() => setPanel("help")}>復旧手順を見る</button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                setError(null);
                runtime.service.dismissError();
              }}
            >
              閉じる
            </button>
          </section>
        )}
        {!runtime.supported ? (
          <section>
            <h1>このブラウザでは接続できません</h1>
            <p>
              Windows・macOS・ChromeOS・Android の Web Bluetooth 対応 Chrome /
              Edge を利用してください。
            </p>
            <p>
              実機接続には HTTPS または localhost が必要です。Safari / Firefox
              は未対応です。
            </p>
          </section>
        ) : !state.snapshot ? (
          <section className="welcome">
            <h1>
              小さなコントローラーに、
              <br />
              あなたの操作を。
            </h1>
            <div className="controller" aria-label="Micro の模式図">
              <span>✚</span>
              <small>
                − &nbsp; +<br />
                MICRO
              </small>
              <span className="face">
                X<br />Y &nbsp; A<br />B
              </span>
            </div>
            <ol>
              <li>本体を K モードに切り替える</li>
              <li>Bluetooth を有効にして本体を接続可能にする</li>
              <li>ブラウザの一覧から Micro を選ぶ</li>
            </ol>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run(() => runtime.service.connect())}
            >
              コントローラーを接続
            </button>
            {busy && (
              <button onClick={() => runtime.service.disconnect()}>
                接続を中止
              </button>
            )}
            <p>設定とバックアップはこのブラウザ内で扱います。</p>
          </section>
        ) : (
          <section>
            <div className="title-row">
              <h1>ボタンの割り当て</h1>
              <span>{dirty ? "未保存の変更あり" : "未保存の変更なし"}</span>
            </div>
            <div className="mapping-grid">
              {BUTTONS.map((b) => (
                <button
                  className={
                    !equalBytes(
                      draft!.raw.slice(b.offset, b.offset + 4),
                      state.snapshot!.raw.slice(b.offset, b.offset + 4),
                    )
                      ? "mapping-button changed"
                      : "mapping-button"
                  }
                  key={b.id}
                  disabled={!ready}
                  aria-label={`${b.label} の割り当て ${formatChord(draft!.mappings[b.id])}`}
                  onClick={() => setEditing(b.id)}
                >
                  <b>{b.label}</b>
                  <span>{formatChord(draft!.mappings[b.id])}</span>
                </button>
              ))}
            </div>
            <label className="sleep">
              <input
                type="checkbox"
                disabled={!ready || draft?.disableSleep === null}
                checked={draft?.disableSleep ?? false}
                onChange={(e) =>
                  setEdits({ ...edits, disableSleep: e.target.checked })
                }
              />
              自動スリープを無効化
            </label>
            {draft?.disableSleep === null && (
              <p>現在のスリープ設定は未対応です。そのまま保持します。</p>
            )}
            <div className="actions">
              <button
                className="primary"
                disabled={!ready || !dirty}
                onClick={() =>
                  void run(async () =>
                    setPrepared(await runtime.service.prepareSave(edits)),
                  )
                }
              >
                デバイスに保存
              </button>
              <button
                disabled={busy}
                onClick={() => (dirty ? setPanel("discard") : void run(read))}
              >
                再読み込み
              </button>
              <button disabled={!ready} onClick={showImport}>
                プロファイルを読込
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setName("");
                  setPanel("export");
                }}
              >
                書き出す
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  dirty ? setPanel("disconnect") : runtime.service.disconnect()
                }
              >
                切断
              </button>
            </div>
          </section>
        )}
        {busy && state.phase !== "confirming" && (
          <section className="progress" aria-label="処理中">
            <progress value={state.progress} max={4} />
            <p>
              完了まで本体を近くに置き、このページを開いたままにしてください。転送だけでは成功になりません。
            </p>
          </section>
        )}
      </main>
      <footer>
        <span>非公式プロジェクト · 実機検証は未完了</span>
        <button disabled={busy} onClick={() => setPanel("log")}>
          操作ログ
        </button>
        <a
          href="https://support.8bitdo.com/ultimate/micro.html"
          target="_blank"
          rel="noreferrer"
        >
          公式サポート ↗
        </a>
      </footer>
      {editing && draft && ready && (
        <MappingEditor
          button={editing}
          value={draft.mappings[editing]}
          onClose={() => setEditing(null)}
          onApply={(value) => {
            setEdits({
              ...edits,
              mappings: { ...edits.mappings, [editing]: value },
            });
            setEditing(null);
          }}
        />
      )}
      {prepared && state.phase === "confirming" && (
        <Modal
          title={
            prepared.reason === "pre-restore"
              ? "対応する設定を復元しますか"
              : "変更を保存しますか"
          }
          onClose={cancelPrepared}
        >
          <p>復旧用バックアップを保存しました。</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>対象</th>
                  <th>現在</th>
                  <th>変更後</th>
                </tr>
              </thead>
              <tbody>
                {prepared.changes.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prepared.changes.length === 0 && (
            <p>変更する設定はありません。本体への書き込みは行いません。</p>
          )}
          {prepared.reason === "pre-restore" && (
            <>
              <p>
                現在の未知の設定を保持します。バックアップ全体の上書きは行いません。
              </p>
              <h3>スキップする設定</h3>
              <p>
                {prepared.skipped
                  .map((id) =>
                    id === "disableSleep"
                      ? "自動スリープ"
                      : isButtonId(id)
                        ? BUTTON_BY_ID[id].label
                        : id,
                  )
                  .join("、") || "なし"}
              </p>
            </>
          )}
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await runtime.service.commitSave(prepared);
                  reset();
                })
              }
            >
              {prepared.reason === "pre-restore" ? "復元を確定" : "保存を確定"}
            </button>
            <button onClick={cancelPrepared}>キャンセル</button>
          </div>
        </Modal>
      )}
      {panel === "discard" && (
        <Modal title="下書きを破棄して再読み込みしますか" onClose={clearPanel}>
          <p>未保存の変更は失われます。本体の設定は変更しません。</p>
          <button onClick={() => void run(read)}>破棄して読み込む</button>
          <button onClick={clearPanel}>編集を続ける</button>
        </Modal>
      )}
      {panel === "disconnect" && (
        <Modal title="未保存の変更があります" onClose={clearPanel}>
          <p>必要なら先にプロファイルを書き出してください。</p>
          <button
            onClick={() => {
              runtime.service.disconnect();
              reset();
            }}
          >
            破棄して切断
          </button>
          <button onClick={clearPanel}>編集を続ける</button>
          <button onClick={() => setPanel("export")}>書き出す</button>
        </Modal>
      )}
      {panel === "backups" && (
        <Modal title="ローカルバックアップ" onClose={clearPanel}>
          <p>このブラウザのサイトデータを消去すると失われます。</p>
          {invalidBackupCount > 0 && (
            <p role="alert" className="notice">
              読み込めないバックアップが {invalidBackupCount}{" "}
              件あります。データは削除していません。正常なバックアップを選んでください。
            </p>
          )}
          {backups.length === 0 ? (
            <p>
              バックアップはまだありません。保存・復元の前に自動作成します。
            </p>
          ) : (
            backups.map((b) => (
              <div className="backup" key={b.id}>
                <p>
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {
                    {
                      "pre-save": "保存前",
                      "pre-restore": "復元前",
                      manual: "手動保存",
                    }[b.reason]
                  }
                </p>
                <button
                  disabled={!ready}
                  onClick={() =>
                    void run(async () => {
                      setPanel(null);
                      setPrepared(await runtime.service.prepareRestore(b.id));
                    })
                  }
                >
                  復元内容を確認
                </button>
                <button
                  onClick={() => {
                    setDeleteId(b.id);
                    setPanel("delete");
                  }}
                >
                  削除
                </button>
              </div>
            ))
          )}
          {!ready && <p>復元するには接続して設定を読み込んでください。</p>}
          <button onClick={clearPanel}>閉じる</button>
        </Modal>
      )}
      {panel === "delete" && (
        <Modal title="バックアップを削除しますか" onClose={clearPanel}>
          <p>この復旧用コピーは元に戻せません。本体は変更しません。</p>
          <button
            onClick={() =>
              void run(async () => {
                await runtime.backups.remove(deleteId);
                await showBackups();
              })
            }
          >
            削除を確定
          </button>
          <button onClick={() => setPanel("backups")}>キャンセル</button>
        </Modal>
      )}
      {panel === "export" && (
        <Modal title="プロファイルを書き出す" onClose={clearPanel}>
          <label>
            プロファイル名
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p>
            既知の割り当てだけを JSON
            に保存します。未対応の割り当てを含む場合は書き出せません。
          </p>
          <button
            disabled={!name.trim() || !draft}
            onClick={() => void run(saveProfile)}
          >
            JSON をダウンロード
          </button>
          <button onClick={clearPanel}>キャンセル</button>
        </Modal>
      )}
      {panel === "import" && (
        <Modal title="プロファイルを読み込む" onClose={clearPanel}>
          {imported ? (
            <>
              <h3>{imported.name}</h3>
              <p>
                下書きの対応項目を置き換えます。本体への保存は別途確認します。
              </p>
              <ul>
                {BUTTONS.map((b) => (
                  <li key={b.id}>
                    {b.label}：{draft && formatChord(draft.mappings[b.id])} →{" "}
                    {formatChord(imported.mappings[b.id])}
                  </li>
                ))}
              </ul>
              {imported.disableSleep !== undefined && (
                <p>
                  自動スリープを無効化：
                  {draft?.disableSleep === null
                    ? "現在の値が未対応のため保持"
                    : imported.disableSleep
                      ? "オン"
                      : "オフ"}
                </p>
              )}
              <button
                onClick={() => {
                  setEdits({
                    mappings: structuredClone(imported.mappings),
                    ...(draft?.disableSleep !== null &&
                    imported.disableSleep !== undefined
                      ? { disableSleep: imported.disableSleep }
                      : {}),
                  });
                  clearPanel();
                }}
              >
                下書きに適用
              </button>
            </>
          ) : (
            <>
              <label>
                プロファイルファイル
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run(async () => {
                        if (file.size > 65536)
                          throw new AppError("INVALID_PROFILE");
                        setImported(parseProfile(await file.text()));
                      });
                  }}
                />
              </label>
              <h3>保存済みプロファイル</h3>
              {profiles.length === 0 ? (
                <p>保存済みプロファイルはありません。</p>
              ) : (
                profiles.map((p) => (
                  <button key={p.name} onClick={() => setImported(p)}>
                    {p.name}
                  </button>
                ))
              )}
            </>
          )}
          <button onClick={clearPanel}>キャンセル</button>
        </Modal>
      )}
      {panel === "help" && (
        <Modal title="使い方と復旧手順" onClose={clearPanel}>
          <h3>接続</h3>
          <p>
            K モード専用。Web Bluetooth 対応の Chrome / Edge と HTTPS
            が必要です。別のアプリが接続中なら終了してください。
          </p>
          <h3>復旧</h3>
          <ol>
            <li>バックアップを削除しない</li>
            <li>電源・K モードを確認して再接続する</li>
            <li>
              設定を読み直し、必要ならバックアップから対応する項目を復元する
            </li>
            <li>続く場合はブラウザを切断し、公式モバイルアプリで確認する</li>
          </ol>
          <p>
            未知の設定は復元しません。スキップ項目は現在値を保持します。バックアップはこのブラウザ専用です。共有にはプロファイル
            JSON を使ってください。
          </p>
          <p>
            保存後、本体が先頭2バイトを更新することがあります。この2バイトは一致比較から除外し、
            全4ページのCRCと残り178バイトを検証します。先頭2バイトの意味は未解明です。
          </p>
          <p>
            調査対象の実機でAボタンの保存と公式アプリ表示を確認済みです。復元と他の環境は未検証です。
          </p>
          <button onClick={clearPanel}>閉じる</button>
        </Modal>
      )}
      {panel === "log" && (
        <Modal title="操作ログ" onClose={clearPanel}>
          <p>個体情報や生の設定値は記録しません。</p>
          <ol>
            {state.log.map((entry, i) => (
              <li key={i}>
                {new Date(entry.time).toLocaleTimeString()} ·{" "}
                {phaseLabels[entry.event as keyof typeof phaseLabels] ??
                  entry.event}
              </li>
            ))}
          </ol>
          {import.meta.env.DEV &&
            import.meta.env.VITE_DIAGNOSTICS === "true" && (
              <section>
                <h3>開発用診断</h3>
                <p>
                  フェーズ：{state.phase} / 受信ページ数：{state.progress} /
                  最後の通知長：{state.notificationLength ?? "未受信"}
                </p>
              </section>
            )}
          <button onClick={clearPanel}>閉じる</button>
        </Modal>
      )}
    </ModalErrorContext.Provider>
  );
}
