import { renderStartupFailure, startDfmResultsApp } from "./app.ts";

const root = document.getElementById("root");
if (!root) throw new Error("The DFM results viewer root is missing.");

void startDfmResultsApp(root).catch((error) => {
  root.replaceChildren(renderStartupFailure(error));
  root.setAttribute("aria-busy", "false");
  console.error(error);
});
