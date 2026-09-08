import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { type ButtonId, BUTTON_BY_ID } from "../../protocol/buttons";
import {
  KEY_LABELS,
  MODIFIERS,
  encodeChord,
  formatChord,
} from "../../protocol/hid-codec";
import type { DecodedMapping, HidChord, Modifier } from "../../protocol/types";
import { Modal } from "./Modal";
const codeKeys: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  PrintScreen: 70,
  ScrollLock: 71,
  Pause: 72,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  NumLock: 83,
  NumpadDivide: 84,
  NumpadMultiply: 85,
  NumpadSubtract: 86,
  NumpadAdd: 87,
  NumpadEnter: 88,
  Numpad0: 98,
  NumpadDecimal: 99,
  IntlBackslash: 100,
  ContextMenu: 101,
  NumpadEqual: 103,
};
export function keyUsage(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) - 65 + 4;
  if (/^Digit[0-9]$/.test(code))
    return code === "Digit0" ? 39 : Number(code[5]) + 29;
  if (/^Numpad[1-9]$/.test(code)) return Number(code[6]) + 88;
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (f) {
    const n = Number(f[1]);
    return n <= 12 ? 57 + n : 91 + n;
  }
  return codeKeys[code];
}
export function MappingEditor({
  button,
  value,
  onApply,
  onClose,
}: {
  button: ButtonId;
  value: DecodedMapping;
  onApply: (value: HidChord) => void;
  onClose: () => void;
}) {
  const [chord, setChord] = useState<HidChord>(
    value.kind === "chord"
      ? structuredClone(value)
      : { kind: "chord", modifiers: [], key: null },
  );
  const [search, setSearch] = useState("");
  const [capture, setCapture] = useState(false);
  const [error, setError] = useState("");
  const [replacing, setReplacing] = useState(value.kind === "chord");
  const startButton = useRef<HTMLButtonElement>(null);
  const captured = useRef(false);
  const rightHeld = useRef(false);
  useEffect(() => {
    if (!capture && captured.current) {
      startButton.current?.focus();
      captured.current = false;
    }
  }, [capture]);
  function stopCapture() {
    captured.current = true;
    setCapture(false);
  }
  function record(event: KeyboardEvent) {
    if (!capture) return;
    event.preventDefault();
    event.stopPropagation();
    const modifierOnly = /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(
      event.code,
    );
    if (modifierOnly && event.code.endsWith("Right")) rightHeld.current = true;
    if (rightHeld.current) {
      setError("右側の修飾キーは未対応です。左側のキーを使用してください。");
      return;
    }
    const key = keyUsage(event.code);
    if (key === undefined && !modifierOnly) {
      setError("このキーは未対応です。キー一覧から選択してください。");
      return;
    }
    const modifiers: Modifier[] = [];
    if (event.ctrlKey) modifiers.push("ctrl");
    if (event.altKey) modifiers.push("alt");
    if (event.shiftKey) modifiers.push("shift");
    if (event.metaKey) modifiers.push("meta");
    setChord({ kind: "chord", modifiers, key: key ?? null });
    setReplacing(true);
    setError("");
    if (!modifierOnly) stopCapture();
  }
  const keys = Object.entries(KEY_LABELS).filter(([, label]) =>
    label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Modal
      title={`${BUTTON_BY_ID[button].label} の割り当てを編集`}
      onClose={onClose}
      capture={capture}
    >
      <p>現在：{formatChord(value)}</p>
      {value.kind === "unknown" && (
        <p className="notice">
          未対応の割り当てです。変更しなければ元の値を保持します。
        </p>
      )}
      <label>
        キーを検索
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        キー
        <select
          value={chord.key ?? ""}
          onChange={(e) => {
            setChord({
              ...chord,
              key: e.target.value === "" ? null : Number(e.target.value),
            });
            setReplacing(true);
          }}
        >
          <option value="">通常キーなし</option>
          {keys.map(([usage, label]) => (
            <option key={usage} value={usage}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {keys.length === 0 && <p>一致するキーがありません。</p>}
      <fieldset>
        <legend>左側の修飾キー</legend>
        {MODIFIERS.map((mod) => (
          <label key={mod}>
            <input
              type="checkbox"
              checked={chord.modifiers.includes(mod)}
              onChange={(e) => {
                setChord({
                  ...chord,
                  modifiers: e.target.checked
                    ? [...chord.modifiers, mod]
                    : chord.modifiers.filter((m) => m !== mod),
                });
                setReplacing(true);
              }}
            />
            {mod}
          </label>
        ))}
      </fieldset>
      <p className="chord-preview">{formatChord(chord)}</p>
      {capture ? (
        <>
          <div
            className="capture"
            tabIndex={0}
            autoFocus
            ref={(element) => element?.focus()}
            onKeyDown={record}
            onKeyUp={(event) => {
              if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code))
                stopCapture();
            }}
          >
            ここにフォーカスしてキーを押す。Escape も割り当て可能。
          </div>
          <button onClick={() => setCapture(false)}>入力を終了</button>
        </>
      ) : (
        <button
          ref={startButton}
          onClick={() => {
            rightHeld.current = false;
            setCapture(true);
          }}
        >
          キーボードから入力
        </button>
      )}
      <button
        onClick={() => {
          setChord({ kind: "chord", modifiers: [], key: null });
          setReplacing(true);
        }}
      >
        無効にする
      </button>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button
          className="primary"
          disabled={!replacing}
          onClick={() => {
            try {
              encodeChord(chord);
              onApply(chord);
            } catch {
              setError(
                "通常キーは1個、組み合わせる修飾キーは3個まで。重複・未対応キーは使用できません。",
              );
            }
          }}
        >
          下書きに適用
        </button>
        <button onClick={onClose}>キャンセル</button>
      </div>
    </Modal>
  );
}
