import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
export const ModalErrorContext = createContext<string | null>(null);
export function Modal({
  title,
  children,
  onClose,
  capture = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  capture?: boolean;
}) {
  const error = useContext(ModalErrorContext);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !capture) {
            event.preventDefault();
            close.current();
          }
          if (event.key === "Tab") {
            const elements = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
              ) ?? [],
            );
            const first = elements[0];
            const last = elements.at(-1);
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === ref.current)
            ) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id={id}>{title}</h2>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
