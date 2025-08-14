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

Check CHANGELOG.md for all changes.

### 1.2.2

- Fix "- " syntax highlighting.

### 1.2.1

- Fix UUID syntax highlighting.

### 1.2.0

- Improve template generation. Now uses names instead of extensions to increase ease of use.
- Add findAssetUUID command, which allows you to search for an asset via its name or UUID, and copy its UUID without having to open the file.
- Add findAssetPath command, which allows you to search for an asset via its name or UUID, and copy its path without having to open the file.