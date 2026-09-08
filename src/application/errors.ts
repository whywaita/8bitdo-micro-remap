import { ProtocolError } from "../protocol/errors";
export type ErrorCode =
  | "UNSUPPORTED_BROWSER"
  | "CHOOSER_CANCELLED"
  | "CONNECTION_FAILED"
  | "SERVICE_NOT_FOUND"
  | "CHARACTERISTIC_NOT_FOUND"
  | "DISCONNECTED"
  | "WRITE_FAILED"
  | "READ_TIMEOUT"
  | "BACKUP_FAILED"
  | "COMMIT_FAILED"
  | "VERIFY_FAILED"
  | "STALE_OPERATION"
  | "DEVICE_CHANGED"
  | "STORAGE_FAILED"
  | "INVALID_PROFILE"
  | "INVALID_BACKUP"
  | ProtocolError["code"];
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = "AppError";
  }
}
export function errorCode(
  error: unknown,
  fallback: ErrorCode = "CONNECTION_FAILED",
): ErrorCode {
  return error instanceof AppError || error instanceof ProtocolError
    ? error.code
    : fallback;
}
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_BROWSER:
    "このブラウザでは接続できません。対応する Chrome / Edge を利用してください。",
  CHOOSER_CANCELLED: "接続をキャンセルしました。",
  CONNECTION_FAILED: "接続できません。電源と K モードを確認してください。",
  SERVICE_NOT_FOUND:
    "対応する設定サービスがありません。K モードを確認してください。",
  CHARACTERISTIC_NOT_FOUND:
    "設定の通信口が見つかりません。接続し直してください。",
  DISCONNECTED: "接続が切れました。再接続して設定を読み直してください。",
  WRITE_FAILED:
    "設定の転送に失敗しました。確定は送信していません。再接続して確認してください。",
  READ_TIMEOUT: "読み込みがタイムアウトしました。接続し直してください。",
  BACKUP_FAILED:
    "バックアップを保存できません。設定を書き込んでいません。ブラウザの保存領域を確認してください。",
  COMMIT_FAILED: "設定の確定を確認できません。再接続して読み直してください。",
  VERIFY_FAILED:
    "保存・復元の結果を確認できません。バックアップを保持して復旧手順を確認してください。",
  STALE_OPERATION:
    "この確認内容は無効です。最新の設定から準備し直してください。",
  DEVICE_CHANGED:
    "本体の設定が変更されています。下書きを必要なら書き出してから再読み込みしてください。",
  STORAGE_FAILED:
    "保存領域を利用できません。サイトデータ設定と空き容量を確認してください。",
  INVALID_PROFILE: "プロファイルの形式、名前、割り当てを確認してください。",
  INVALID_BACKUP: "バックアップが破損しているか形式が正しくありません。",
  INVALID_PACKET: "設定の応答形式が正しくありません。読み直してください。",
  INVALID_CRC: "受信した設定の整合性を確認できません。読み直してください。",
  INCOMPLETE_CONFIG: "設定をすべて受信できませんでした。読み直してください。",
  CONFLICTING_PAGE:
    "同じ設定ページに異なる応答を受信しました。読み直してください。",
  INVALID_MAPPING:
    "未対応のキー、重複する修飾キー、またはキー数の上限超過があります。",
};
