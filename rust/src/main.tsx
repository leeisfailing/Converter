import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./shell.css";

const savedTheme = localStorage.getItem("app_theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
document.documentElement.setAttribute("data-theme", savedTheme || (prefersLight ? "light" : "dark"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
