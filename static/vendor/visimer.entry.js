// Bundle entry. Re-exports only the Visimer symbols the app uses, so the
// global `window.Visimer` surface stays narrow.
// Built with esbuild to a single IIFE that exposes `window.Visimer`.
// `parse` is the headless capability probe (static/js/mermaid-designer.js
// uses it to disable the menu item for render-only diagram types).
export { MermaidWysiwygEditor, parse } from "@visimer/core";
export { MermaidCanvasView } from "@visimer/dom";
