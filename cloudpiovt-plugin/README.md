# 云枢开发助手

Chrome / Edge Manifest V3 extension for:

- reading Vue editor component `$data`
- syncing `data.codes` to local files
- writing local files back into the page
- opening the configured target folder with either VS Code or IDEA

## Current simplified behavior

### Settings

The options page only keeps two editable settings:

- `VS Code` executable path
- `IDEA` executable path

Everything else is fixed in code and shown only as readonly notes.

### Fixed defaults

- page scope: built-in default scope only
- selection strategy: `visible-first`
- output mode: `codes-multi-file-export`
- open methods: `VS Code` and `IDEA` only

### Default file mapping

The extension now distinguishes page type by URL:

- `form-design`
  - `html -> form-index.html`
  - `css -> form-style.css`
  - `javascript -> form-script.js`
- `list-design`
  - `html -> list-index.html`
  - `css -> list-style.css`
  - `javascript -> list-script.js`

This avoids form files and list files overwriting each other in the same folder.

### Target folder path

The popup supports two ways to set the target folder path:

- direct manual input
- choose folder and write the absolute path back into the input

Both the target folder path and the browser directory handle are remembered per page type:

- `form-design`
- `list-design`
- fallback `default`

Browser directory handles are still used for actual local file read/write.

### README.MD generation

`README.MD` is only handled during `抓取并写入`:

- create it when the target folder does not already contain `README.MD`
- update it on later captures
- do not touch it during `从文件夹回写`

The generated content is plain text and includes:

- all links found on the page
- app code and form code parsed after `model`
- related Chinese text from links
- form name
- main-table controls
- subtable code groups and their controls

## Native host project

- Project: `native-host/CloudPiOvt.NativeHost`
- Host name: `com.cloudpiovt.editor_helper`
- Install script: `scripts/install-native-host.ps1`

The native host is used to:

- pick editor executables
- pick folder paths
- launch VS Code / IDEA with the configured target directory

## Project files

- `manifest.json`: extension manifest
- `popup.html` / `popup.js` / `popup.css`: popup UI and main workflow
- `options.html` / `options.js` / `options.css`: options page
- `lib/config.js`: simplified config model and readonly defaults
- `lib/file-handle-db.js`: IndexedDB directory handle storage
- `lib/native-host.js`: native messaging bridge
- `native-host/CloudPiOvt.NativeHost`: Windows native host
- `scripts/install-native-host.ps1`: publish and register native host
