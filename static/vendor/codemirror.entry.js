// Bundle entry. Re-exports the public surface we use from CM6.
// Bundled with esbuild to a single IIFE; the IIFE exposes
// `window.CM6` (a flat object of the named exports).
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { keymap, ViewPlugin, Decoration, drawSelection, lineNumbers, highlightActiveLine, ViewUpdate } from "@codemirror/view";
import { indentWithTab, history, defaultKeymap, historyKeymap, undo, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches, SearchQuery, setSearchQuery, findNext, findPrevious, getSearchQuery, openSearchPanel, closeSearchPanel, search } from "@codemirror/search";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { StreamLanguage, StringStream, LanguageSupport } from "@codemirror/language";
import { vim, Vim, getCM, CodeMirror } from "@replit/codemirror-vim";

window.CM6 = {
  // state + view
  EditorView, EditorState, Compartment, Prec, keymap, ViewPlugin, Decoration, drawSelection, lineNumbers, highlightActiveLine,
  // commands
  indentWithTab, history, defaultKeymap, historyKeymap, undo, redo,
  // languages
  markdown, StreamLanguage, StringStream, LanguageSupport,
  // search
  searchKeymap, highlightSelectionMatches, SearchQuery, setSearchQuery, findNext, findPrevious, getSearchQuery, openSearchPanel, closeSearchPanel, search,
  // language helpers
  indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
  // vim
  vim, Vim, getCM, CodeMirror,
  // pre-bundled basic setup (we don't use this since we want a custom
  // layout, but it's exported for convenience)
  basicSetup,
};
