import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { createRuntime } from "./application/runtime";
import "./ui/styles.css";
const runtime =
  import.meta.env.MODE === "e2e"
    ? (
        await import("../tests/helpers/browser-runtime")
      ).createBrowserTestRuntime()
    : createRuntime();
createRoot(document.getElementById("root")!).render(<App runtime={runtime} />);
