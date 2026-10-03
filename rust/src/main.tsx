import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { prefersLightScheme, readStorage } from "./lib/storage";
import "./index.css";
import "./shell.css";

const savedTheme = readStorage("app_theme");
document.documentElement.setAttribute("data-theme", savedTheme || (prefersLightScheme() ? "light" : "dark"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
