export interface MicroTransport {
  connectFromUserGesture(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  writeWithResponse(packet: Uint8Array): Promise<void>;
  /** Each read operation opens a fresh subscription. return() releases it. */
  notifications(): AsyncIterableIterator<Uint8Array>;
  onDisconnected(listener: () => void): () => void;
}
