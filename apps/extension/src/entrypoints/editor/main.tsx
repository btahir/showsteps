import { createRoot } from "react-dom/client";
import "../../ui/theme.css";
import "../../ui/shot.css";
import "./editor.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
