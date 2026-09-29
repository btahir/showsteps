import { createRoot } from "react-dom/client";
import "../../ui/theme.css";
import "../../ui/shot.css";
import "../../ui/guide.css";
import "../../ui/export.css";
import "./editor.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
