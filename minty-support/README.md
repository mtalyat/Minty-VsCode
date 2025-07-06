# Minty Support

The official support extension for VsCode for the Minty game engine.

## Features

- File navigation (ctrl+click a path to open the file).
- UUID navigation (ctrl+click a UUID to open its corresponding file).
- UUID generation (ctrl+alt+U, ctrl+alt+U) and UUID insertion (UUID+alt+u, UUID+alt+i).
- Easily create new Asset files using the templates from your Minty directory.

## Requirements

You must have [Minty](https://github.com/mtalyat/Minty) installed. Instructions are in the project's README.

## Extension Settings

None.

## Known Issues

None.

## Release Notes

Check the README for all changes.

### 1.1.0

- Fix blue colors for non-.minty files.
- Add openMintyDirectory command, which opens the local Minty directory, if any. Found at $(MINTY_PATH).
- Update document link provider to check files within $(MINTY_PATH)/Data.
- Add syntax highlighting for macros when used.

### 1.0.4

- Fix README to have correct keyboard shortcuts.
- Rename color theme to "Minty."

### 1.0.3

- Adjust blue colors to be lighter.