# PKM & AI-Agent Folder/File Naming Conventions — Evidence Report

**Date:** 2026-10-01
**Requested by:** Shaun (choosing names for a personal Markdown notebook)
**Method:** Read primary sources (author's own site/book pages, project docs, official
help pages, upstream repos). SearXNG was down (all engines suspended/CAPTCHA), so
sources were reached by direct fetch. Local grounding: this project already uses
lowercase topic folders (`notebook/agent/`, `notebook/llm/`, `notebook/projects/`,
…) with `CLAUDE.md` at repo root.

**Legend:** `[OBS]` = directly observed in the cited source. `[INF]` = inference drawn
by me. `[NOT PRESCRIBED]` = the system does not define names for this; anything beyond
is idiosyncratic.

---

## 1. PARA — Tiago Forte (Building a Second Brain)

**Question:** What are the four top-level folders, exactly?

| Level | Literal names (as written by Forte) | Citation |
|---|---|---|
| Top-level folders | **Projects, Areas, Resources, Archives** | fortelabs.com/blog/para/ — "Four top-level folders – Projects, Areas, Resources, and Archives" |
| Category definition | projects; areas of responsibility; resources; archives | same page, "4 Categories to Encompass Your Entire Life" |

Exact quote `[OBS]`: *"Four top-level folders – Projects, Areas, Resources, and
Archives – each containing a small number of subfolders dedicated to each active
project, area of responsibility, resource, and archive in your life."*
(https://fortelabs.com/blog/para/, published 2023-02-24, updated 2026-04-15)

**Naming of subfolders** `[NOT PRESCRIBED]` — Forte says subfolders are "dedicated to
each active project/area/resource/archive"; he gives example item titles ("Complete
webpage design", "Health", "Finances") but no naming rule. `[INF]` No prefixes,
numbers, or casing are mandated.

**Case/format** `[OBS]` — Forte writes them capitalized (Projects, Areas, Resources,
Archives); the accompanying diagram uses the same. No separator/numbering convention.

---

## 2. Zettelkasten / Luhmann

| Aspect | Finding | Citation |
|---|---|---|
| ID scheme (Luhmann) | Branching alternating number/letter: first note `1`, unrelated `2`; continuation `1a`, `1b`; comment on `1a` → `1a1`; alternate numbers and characters | zettelkasten.de/introduction/ — "The Fixed Address of Each Note" |
| Luhmann's actual ID | Included **one slash** for readability (didactic simplification omitted it) | same, footnote 3 |
| Time-based ID | e.g. `202006110955` (YYYYMMDDHHMM) | same, "The Unique Identifier" |
| Arbitrary ID | incremental number, random unique string, hex-shortened timestamp (e.g. `2F08729AEA`) | same |
| Title as ID | allowed if unique; discouraged because renaming breaks links | same |
| Folder vs folderless | The method itself is **folderless**; "with a digital Zettelkasten ... there is no real place for a note" | same, "The Unique Identifier" |
| The Archive (software) | Manages **a folder of plain text files**; ID is in **both filename and file contents**; links are `[[ID]]`; tags are `#hashtags`; Markdown body | same, "The Archive" section |
| Note anatomy | unique identifier + body + references (footer) | same, "The Anatomy of a Zettel" |
| Structure notes | notes about notes; Luhmann called them "hub notes" | same |

Exact quotes `[OBS]`:
- *"The very first note is assigned the number `1`. ... That new note would get
  assigned the number `1a`. ... you would create a note with the address `1a1`."*
- *"In The Archive, an individual Zettel ... The ID of the Zettel is both in the
  filename and in the contents of the file. ... The ID is time-based."*
- *"The Archive manages a folder of plain text files."*

**No prescribed folder names** `[NOT PRESCRIBED]` — The Archive is "a folder of plain
text files" accessed by search, not a folder tree. `[OBS]` Obsidian itself (see §7)
imposes no folder scheme either.

**Luhmann archive (primary artefact):** niklas-luhmann-archiv.de holds the digitized
slip box; the register (`Schlagwortregister`) is the entry-point list, not a tag list
(cited by zettelkasten.de/introduction/).

---

## 3. Johnny.Decimal

| Level | Literal form | Example (from docs) | Citation |
|---|---|---|---|
| System | **area → category → ID** | `10-19 Life admin` → `15 Travel` → `15.22 Travel insurance` | johnnydecimal.com/documentation/introduction/ |
| Area | two-digit range + title | `10–19 Life admin`, `20–29 Home business`, `30–39 Tennis club` | …/documentation/areas-and-categories/ |
| Category | two digits + title, starting at `11` | `11 Me`, `12 Home`, `13 Money`, `14 Online`, `15 Travel` | introduction |
| ID | always **two digits, a decimal, two digits** | `15.22`, `22.11`, `31.17` | introduction, "Benefits of the ID" |
| Header (optional) | ID ending in `0` + black square `■` + emoji | `14.10 ■ Computers & other devices 🖥️` | …/documentation/headers/ |

Exact quotes `[OBS]`:
- *"Everything gets an ID like `11.21 Health records & registrations`."*
  (https://johnnydecimal.com/)
- *"It always has two digits, a decimal, and two digits. For example, `15.22` `22.11`
  `31.17`."*
- *"no more than 10 area folders ... no more than 10 category folders ... no more
  than 100 IDs."*
- Headers: *"An ID ending in 0, a black symbol (■) ... an emoji."*

**Casing/spacing** `[OBS]` — Folder name is `<ID> <Title>` (e.g. `15.22 Travel
insurance`), title in sentence case. Headers add `■` and an emoji. `00–09` exists but
is documented only in advanced topics.

---

## 4. GTD — David Allen

**Important distinction `[OBS]`:** GTD is a **workflow with lists**, not a folder
taxonomy. The canonical "folder-like" names are list names, not filesystem folders.

| Concept | Literal list name | Citation |
|---|---|---|
| Capture bucket | **In** / "in" list | hamberg.no/gtd/ — "The 'in' list" |
| Next actions | **Next actions** (one list per context) | hamberg.no/gtd/ — "The 'next actions' list" |
| Delegated | **Waiting for** | hamberg.no/gtd/ — "The 'waiting for' list" |
| Multi-step outcomes | **Projects** | hamberg.no/gtd/ — "Projects" |
| Deferred | **Some day/maybe** ("Someday/Maybe") | hamberg.no/gtd/ — "The 'some day/maybe' list" |
| Non-actionable material | **Reference** | gettingthingsdone.com/what-is-gtd/ Step 2 CLARIFY |
| Contexts | prefixed with `@`, e.g. `@ home`, `@ computer`, `@ office`, `@ everywhere`, `@ Foobert Agenda` | hamberg.no/gtd/ — "Contexts" |
| Physical tools | **Tickler file** (43 folders), **read/review folder** | hamberg.no/gtd/ — "Tools" |

Exact `[OBS]`: *"You will have to make the following lists: 1. In 2. Next actions ...
3. Waiting for 4. Projects 5. Some day/maybe"* (hamberg.no/gtd/). Official site Step 2:
*"If not, decide if it is trash, reference, or something to put on hold."*
(https://gettingthingsdone.com/what-is-gtd/)

**"Areas of focus"** `[NOT on the official what-is-gtd page]` — The official page
lists the five steps only. "Areas of focus" appears in Allen's broader Horizon
2 material but is not among the five canonical list names above. `[INF]` Treat
"Areas" as GTD vocabulary, not a prescribed folder name from the primary page.

**Folders** `[NOT PRESCRIBED]` — GTD does not prescribe top-level folder names.
The `@` prefix for contexts is the only literal notation. `[INF]` Any
`Inbox/ Projects/ Areas/ Someday/ Reference/` tree is an adaptation, not Allen's text.

---

## 5. LATCH (Richard Saul Wurman) and ACCESS

### LATCH

| Aspect | Finding | Citation |
|---|---|---|
| Source | *Information Anxiety* (1989); also called "Five Hat Racks" | en.wikipedia.org/wiki/Richard_Saul_Wurman (LATCH principles section) |
| Acronym | **L**ocation, **A**lphabet, **T**ime, **C**ategory, **H**ierarchy | same |
| Purpose | "five ways to organize information" / a finite set of structures | en.wikipedia.org/wiki/LATCH_(information_management) (redirect target) |

Exact `[OBS]`: *"LATCH, an acronym, stands for Location, Alphabet, Time, Category,
and Hierarchy. These principles provide a finite set of ways to structure
information…"* (Wikipedia, Richard Saul Wurman, retrieved 2026-10-01).

`[INF]` LATCH is a set of organizing **axes**, not a folder naming scheme. It defines
no literal folder names.

### ACCESS (Nick Milo — note this overlaps with §6)

**Correct attribution `[OBS]`:** ACCESS is Nick Milo's, not Wurman's. The LYT Kit page
states: *"It then dives deeper into my new ACCESS folder structure: the first PKM
solution designed from the ground up to seamlessly marry folders and links into a
holistic system."* (https://www.linkingyourthinking.com/lyt-kit)

| Aspect | Finding |
|---|---|
| Status | `[OBS]` Named as a folder structure by Milo |
| Exact folder names | `[NOT ESTABLISHED]` — I could not read a primary page that enumerates the seven folder names. The Medium URL I tried 404s; linkingyourthinking.com has no page at the guessed slugs. |
| What would settle it | The Ideaverse/LYT Kit download itself, or a live lesson page under `linkingyourthinking.com/ideaverse-for-obsidian/`. |

`[INF]` Do not use an ACCESS expansion from memory or a third-party summary; I have
not verified the literal names.

---

## 6. Nick Milo / Linking Your Thinking (LYT)

| Concept | Finding | Citation |
|---|---|---|
| **MOC** | "Map of Content" — a note that links out to related notes; Milo's signature device | linkingyourthinking.com/lyt-kit/; wiki index at notes.linkingyourthinking.com/ (site nav) |
| **Home note** | Named literally `Home` (file `Home.md`); "Your launchpad and home base" | raw `Home.md` in the LYT Kit mirror, github.com/thebrianbug/LYT-Kit |
| Folder structure | LYT Kit top-level folders: **Atlas, Calendar, Cards, Extras, Sources, Spaces** (+ `Home.md`, `LYT Kit.md`, plugin folder `.obsidian`) | github.com/thebrianbug/LYT-Kit (master tree) |
| Atlas contents (as links, not folders) | `Thinking MOC`, `Inbox`, `Notebox`, `Outbox`, `Daily Notes`, `Library`, `People MOC`, `Sources MOC`, `Concepts MOC`, `Efforts`, `Plan and Review`, `Health MOC`, `Finance MOC`, `Life Map`, `LYT Kit`, `Meta PKM` | Home.md |
| Ideaverse | Current product name for the Kit; "ACCESS folder structure"; Ideaverse Lite has "250+ notes linked 1000+ times" | linkingyourthinking.com/lyt-kit/, start.linkingyourthinking.com/ideaverse-for-obsidian |
| Daily notes folder in this Kit | `Calendar` (folder), with daily/periodic notes | LYT-Kit tree |

Exact `[OBS]` from `Home.md`:
- `# Home 🌎` / *"Your launchpad and home base."*
- `## Atlas` / *"These are maps to launch your `efforts`."*

**Caveat `[OBS]`:** The `thebrianbug/LYT-Kit` repo is a **third-party copy** ("Copy of
the Linking Your Thinking Kit for Obsidian"), not Milo's own repo. The names match the
official screenshots and the site's description of `Home` and `Atlas`, but treat the
exact folder list as *observed in a mirror*, not from a first-party repo.
`[INF]` `Atlas` is likely the ACCESS "A"; `Calendar`, `Cards`, `Extras`, `Sources`,
`Spaces` fit the remaining letters but I have **not** verified the mapping.

---

## 7. Obsidian — official stance and community conventions

| Aspect | Finding | Citation |
|---|---|---|
| Storage unit | A **vault** = a folder on the local filesystem, including subfolders | Obsidian Help, "How Obsidian stores data" (github.com/obsidianmd/obsidian-help, `en/Files and folders/How Obsidian stores data.md`) |
| Config folder | `.obsidian` created in the vault root | same |
| Folder requirement | **Folders are optional.** Notes are plain-text Markdown files; the app supports folders but requires none | Obsidian Help "Manage notes" + "File explorer" plugin docs; obsidian.md home page |
| Filename rule | Respects OS filename limits; avoid characters that break links: `# \| ^ : %% [[ ]]` | Obsidian Help, "Internal links"; "Manage notes" points to safe-filename practices |
| Link forms | `[[Note]]` wikilink or `[Note](Note.md)`; folder paths use `/` from vault root, e.g. `[[Projects/Three laws of motion]]` | Obsidian Help, "Internal links" |
| Attachments | No prescribed folder; `Accepted file formats` lists types only | Obsidian Help, "Accepted file formats" |
| No default folder tree | Obsidian ships **no** `Inbox/ Projects/` scaffold | Obsidian Help, "Create your first note" |

Exact `[OBS]`: *"Obsidian stores your notes as Markdown-formatted plain text files in
a vault. A vault is a folder on your local file system, including any subfolders."*
and *"Obsidian creates an `.obsidian` configuration folder in the root folder of the
vault."*

The help tree's own top-level categories (`Files and folders/`, `Getting started/`,
`Linking notes and files/`, …) are **documentation categories, not a prescribed vault
layout** `[OBS]` (github.com/obsidianmd/obsidian-help tree).

---

## 8. Logseq and Dendron

### Logseq

| Aspect | Finding | Citation |
|---|---|---|
| Auto-created folders | **`journals`**, **`pages`**, **`assets`** | Logseq docs, "How to create a Logseq graph using existing Markdown files" (github.com/logseq/docs, `pages/`) |
| Journals filename | Date-based, e.g. `2020_09_14.md` (also `.org` historically) | logseq/docs `journals/` tree |
| Folderless claim | Logseq's own tutorial says it "lacks a hierarchical structure like folders" | Logseq docs, "How to create pages in Logseq" |
| Namespaces | Use `/` in page titles; filename encoding depends on format | Logseq docs, "Filename format" |
| Filename format | `:legacy` (percent-encoding; older used `.` for `/`, `_` for specials) or `:triple-lowbar` (new default since 0.8.9; `___` encodes `/`) | Logseq docs, "Filename format"; setting key `:file/name-format` in `config.edn` |

Exact `[OBS]`: *"Logseq will automatically create the following folders: `journals`
... `pages` ... `assets`."* And: *"Use triple underscore `___` for slash `/` in the
page title … Use Percent-encoding for other invalid characters."*

### Dendron

| Aspect | Finding | Citation |
|---|---|---|
| Naming style | **All lower kebab-case**, e.g. `awesome apples` → `awesome-apples.md` | Dendron wiki, "Best Practices" (wiki.dendron.so) |
| Hierarchy | **Dot-delimited filenames**, no nesting required | Dendron wiki, "Hierarchies" |
| Example tree (flattened) | `project1.md`, `project1.designs.md`, `project1.designs.promotion.md`, `project1.paperwork.md`, `project1.paperwork.legal.md`, `project1.tasks.md`, `project1.tasks.task1.md` | same |
| "Domain" | the root of a hierarchy (e.g. `project1`) | same |
| Vaults | By default a **`vaults`** folder; vaults named like `vault.main`, `vault.secret` | Dendron wiki, "Concepts" |
| Schema files | `{name}.schema.yml` | same |
| Titles | Auto-generated from the last hierarchy part (Chicago style) | "Best Practices" |

Exact `[OBS]`: *"Dendron organizes your notes into hierarchies. These are `.` ("dot"
or "period") delimited Markdown files."* And the default workspace tree shows
`vault.main/` and `vault.secret/`.

---

## 9. Digital-garden conventions

| Aspect | Finding | Citation |
|---|---|---|
| Definition | Evolving, linked notes; "topography over timelines"; not reverse-chronological | maggieappleton.com/garden-history ("A Brief History & Ethos of the Digital Garden") |
| Origin of term | Mark Bernstein, *Hypertext Gardens* (1998); revived by Mike Caulfield, *The Garden and the Stream* (2015) | same |
| Growth stages | `Seedlings`, `Budding`, `Evergreen` (Appleton's own labels) | same |
| Epistemic metadata | stage tags (draft / in progress / finished), certainty tags, importance 1–10 (Gwern); epistemic status/effort (Devon Zuegel) | same |
| Folder scheme | **None prescribed** — "no prescribed pathways", personal play space | same |
| Terms of service | Right to be wrong; constructive criticism; attribute; epistemic disclosure; respond to feedback | swyx.io/digital-garden-tos |
| Naming convention | `[NOT PRESCRIBED]` — gardens vary; Appleton's own site uses `essays/`, `notes/`, `patterns/`, `smidgeons/`, `talks/`, `podcasts/`, `library/`, `antilibrary/` | maggieappleton.com site nav |

Exact `[OBS]`: *"Gardens are organised around contextual relationships and associative
links … Many entry points but no prescribed pathways."* Appleton's growth labels:
*"🌱 Seedlings … 🌿 Budding … 🌳 Evergreen."*

---

## 10. AI-coding-agent / AI-agent workspace conventions

**Question:** Which agent-facing instruction files and directories are actually
conventional vs ad hoc?

| Convention | Status | Literal names & locations | Citation |
|---|---|---|---|
| **AGENTS.md** | **Conventional, standardised** | `AGENTS.md` at repo root; nested in subdirs; global at `~/.agents/AGENTS.md` | agents.md (agentsmd/agents.md, now under the Agentic AI Foundation / Linux Foundation); opencode docs |
| **CLAUDE.md** | **Conventional (Claude Code)** | `./CLAUDE.md`, `./.claude/CLAUDE.md`, `./CLAUDE.local.md`, `~/.claude/CLAUDE.md`, managed policy dirs | code.claude.com/docs memory docs |
| **.cursor/rules** | **Conventional (Cursor)** | `.cursor/rules/*.mdc` (must be `.mdc`; plain `.md` ignored); also plain `AGENTS.md` | cursor.com/docs/context/rules |
| **.clinerules / .cline/rules** | Conventional (Cline) | `.clinerules/*.md`, `.cline/rules/*.md`, global `~/Documents/Cline/Rules` | docs.cline.bot/features/cline-rules |
| **.devin/rules (was .windsurf/rules)** | Conventional (Windsurf/Devin) | `.devin/rules/*.md` preferred, `.windsurf/rules/*.md` legacy fallback; system dirs `/etc/devin/rules/`, `/etc/windsurf/rules/` | docs.windsurf.com/windsurf/cascade/memories (Devin Desktop docs) |
| **.github/copilot-instructions.md** | Conventional (GitHub Copilot) | `.github/copilot-instructions.md`; path-scoped `.github/instructions/NAME.instructions.md`; also `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` at root | docs.github.com, "Adding repository custom instructions" |
| **GEMINI.md** | Conventional (Gemini CLI) | Default context filename `GEMINI.md`, configurable via `context.fileName`; `.gemini/settings.json` project config; `~/.gemini/` | google-gemini.github.io/gemini-cli configuration docs |
| **.ai/ directory** | **NOT conventional** | — | No primary agent tool documents a `.ai/` directory. Not found in any official docs reviewed. |
| **.context/ directory** | **NOT conventional** | — | No official docs reviewed prescribe `.context/`. |
| **`agent/` or `ai/` notes folder** | **NOT a coding-agent convention** — personal/org choice only | — | No agent tool prescribes a note folder named `agent/` or `ai/`. This project's `notebook/agent/` is a local convention, not an industry one. |
| **`_agent/` directory** | **NOT conventional** | — | Not found in any official docs. |
| Auto-memory storage | Ad hoc, tool-specific | Claude Code: `~/.claude/projects/<project>/memory/` (`MEMORY.md` + topic files). Windsurf/Devin: `~/.codeium/windsurf/memories/` (+ `global_rules.md`) | code.claude.com memory docs; docs.windsurf.com memories docs |

**Key observations** `[OBS]`:
- `AGENTS.md` is the only **cross-vendor** name; agents.md states it is "used by over
  60k open-source projects" and lists Codex, Jules, Aider, goose, opencode, Zed, Warp,
  VS Code, Devin, Amp, Cursor, RooCode, Gemini CLI, Windsurf, Copilot, and others.
- Claude Code reads `AGENTS.md` natively (v2.1.277+), but **prefers `CLAUDE.md`** when
  both exist by default; `AGENTS.md` also loads *alongside* if set to
  `claude-md-and-agents-md`.
- opencode reads `AGENTS.md` first, then falls back to `CLAUDE.md`; project file wins
  over global; `~/.config/opencode/AGENTS.md` is the global path.
- Cursor requires `.mdc` (not `.md`) for `.cursor/rules`; plain `AGENTS.md` is the
  simpler alternative it now supports.
- Claude Code's `.claude/rules/*.md` uses optional YAML `paths:` frontmatter for
  path-scoping.
- No official tool documents `.ai/`, `.context/`, `agent/`, `ai/`, or `_agent/` as a
  convention. These are **ad hoc** if used at all.

### Local (this project) — observed, for grounding

| Path | What | Citation |
|---|---|---|
| `CLAUDE.md` | Repo-root agent guide (large) | `/mnt/projects/webapp/notebook-server/CLAUDE.md` |
| `agent.md` | Served verbatim at `/agent.md`; machine-readable API guide | `agent.md:1`, `app.py` route |
| `notebook/agent/` | Personal notes folder (`notebook.md`, `workspace.md`) | local `ls notebook/agent` |
| `notebook/llm/`, `notebook/llm/agents/` | Personal LLM notes | local `ls notebook/llm` |
| `.claude/settings.local.json` | Local Claude config | local `ls .claude` |

`[OBS]` This project mixes: a root `CLAUDE.md` (tool convention) + a served
`agent.md` (local choice) + lowercase topic folders (local choice). It does **not**
use `AGENTS.md` at root, though `CLAUDE.md` and `agent.md` are both present.

---

## Consensus / divergence

### Names that recur across multiple systems

| Recurring name | Systems | Note |
|---|---|---|
| **Projects** | PARA (`Projects`), GTD (`Projects` list) | The strongest cross-system overlap. |
| **Areas** | PARA (`Areas`), GTD vocabulary ("areas of focus") | Present in both, but GTD's official five lists don't include it. |
| **Archives** | PARA (`Archives`); LYT-era "Archive" ideas | Not in GTD's canonical lists. |
| **Reference / Sources** | GTD (`Reference`), LYT (`Sources`), PARA (`Resources`) | Same role, three different words. |
| **Inbox / In** | GTD (`In`), LYT (`Inbox`), most adaptations | Nearly universal capture bucket, spelled differently. |
| **Someday/Maybe** | GTD (`Some day/maybe`) | GTD-specific; rarely reused verbatim. |
| **Home** | LYT (`Home.md`), Obsidian docs (`Home.md` as a doc index) | A single entry-point note named `Home`. |
| **journals / pages / assets** | Logseq (auto-created) | Tool-specific but literal and enforced. |
| **MOC** | LYT only | "Map of Content" is Milo's term; broad community adoption. |
| **AGENTS.md** | Cross-vendor agent standard | The only near-universal agent filename. |
| **CLAUDE.md** | Anthropic Claude Code | Second-most common; read by opencode as fallback. |

### Idiosyncratic / single-system names

| Name | System |
|---|---|
| `Atlas`, `Calendar`, `Cards`, `Extras`, `Spaces` | LYT Kit folder structure |
| `LATCH`, `ACCESS` | Organizing axes, not folders |
| `vault.main`, `vault.secret`, `{name}.schema.yml` | Dendron |
| `15.22`, `14.10 ■ …🖥️` | Johnny.Decimal IDs/headers |
| `1a`, `202006110955` | Zettelkasten IDs |
| `@ home`, `@ computer` | GTD contexts |
| `Seedlings`, `Budding`, `Evergreen` | Digital gardens (Appleton) |
| `.cursor/rules`, `.clinerules`, `.devin/rules`, `.github/copilot-instructions.md`, `GEMINI.md` | Single-vendor agent configs |
| `.ai/`, `.context/`, `agent/`, `ai/`, `_agent/` | **Not conventional anywhere** — ad hoc |

### Systems that do NOT prescribe folders

`[OBS]` **Zettelkasten** (folderless by design), **LATCH** (axes only),
**Obsidian** (folders optional; ships no tree), **digital gardens** (explicitly "no
prescribed pathways"), **GTD** (lists, not folders).

### Systems that DO prescribe a literal structure

`[OBS]` **PARA** (4 folders), **Johnny.Decimal** (numbered area/category/ID tree),
**Logseq** (`journals/ pages/ assets/`), **Dendron** (dot-namespaced files + `vaults/`),
**LYT/Ideaverse** (Atlas/Calendar/Cards/Extras/Sources/Spaces, observed in a mirror).

---

## Observed vs inferred — summary

**Observed (read directly):** PARA four folders; Luhmann ID scheme and The Archive
filename/ID rules; Johnny.Decimal two-digit decimal ID + area/category/header
patterns; GTD's five list names and `@`-contexts (from a secondary but thorough
guide) plus the official five steps; LATCH expansion; LYT `Home.md` and Atlas folder;
Obsidian vault/`.obsidian`/optional folders and link rules; Logseq `journals/pages/
assets` and filename formats; Dendron kebab-case + dot hierarchy + `vault.main`;
digital-garden ethos and growth labels; AGENTS.md/CLAUDE.md/.cursor/rules/.clinerules/
.devin-rules/.github-copilot/GEMINI.md locations.

**Inferred:** ACCESS's seven folder names (unverified); `Atlas` mapping to ACCESS's
"A"; that "Areas of focus" is not on the official what-is-gtd page; that `.ai/`,
`.context/`, `agent/`, `ai/`, `_agent/` are non-conventional.

**Not established:** The literal seven ACCESS folder names from a primary Nick Milo
source. What would settle it: the Ideaverse/LYT Kit download, or the live lesson pages
under `linkingyourthinking.com/ideaverse-for-obsidian/`.

---

## Recommendation (for the decision at hand)

`[INF]` The evidence supports these safe, recurring choices for a personal Markdown
notebook:

1. **A small set of lowercase topic folders** (as this project already uses) is
   consistent with Obsidian's and Logseq's minimal-folder stance and with the
   digital-garden "no prescribed pathways" ethos.
2. **If you want a prescriptive skeleton**, the two systems that actually publish
   literal folder names are **PARA** (`Projects/ Areas/ Resources/ Archives/`) and
   **Johnny.Decimal** (numeric `area/category/ID`). Pick one; they are incompatible
   in spirit (PARA = 4 broad buckets, JD = numbered index).
3. **`Home.md`** is the one cross-system entry-point filename worth adopting (LYT,
   and Obsidian's own docs use it).
4. **For the agent-facing side, `AGENTS.md` is the only cross-vendor standard.** If
   you want other tools to read this project's instructions without duplication,
   add an `AGENTS.md` and let `CLAUDE.md` import it (or symlink), or keep the
   existing `CLAUDE.md` and add a thin `AGENTS.md`. Do **not** invent `.ai/` or
   `.context/` and expect tooling to find them.

The choice among PARA / Johnny.Decimal / topic folders is a product decision, not an
evidence question — the evidence only fixes the literal names each system uses.
