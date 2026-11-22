// Renders public/logo.svg to the 1024px PNG that `tauri icon` turns into all platform icons.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/logo.svg", import.meta.url));
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(new URL("../src-tauri/icons/source.png", import.meta.url), png);
console.log("wrote src-tauri/icons/source.png");
