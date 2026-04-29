import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

const savedColorTheme = localStorage.getItem("qbase-color-theme") ?? "slate";
document.documentElement.setAttribute("data-color-theme", savedColorTheme);
const savedColorMode = localStorage.getItem("qbase-color-mode") ?? "system";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const useDark = savedColorMode === "dark" || (savedColorMode === "system" && prefersDark);
document.documentElement.classList.toggle("dark", useDark);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
