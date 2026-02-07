# Change Log

## 1.4.3
- Fix UUIDs when there is multiple global UUID references.
- UUIDs with a value of zero will not use document links, references, etc.
- 

## 1.4.2
- Fix README screenshot.
- Finding asset paths will now omit the initial "Game" or "Project", if any.

## 1.4.1
- Remove debug statements.

## 1.4.0
- Add insertNextUUID (ctrl+alt+u ctrl+alt+n) which will insert the next UUID, starting at 0000000000000001. Great for prefabs.
- Add insertShortUUID (ctrl+alt+u ctrl+alt+o) which will insert a half UUID (16 characters).
- Remove syntax highlighting for macros, as they are no longer supported.
- Fixed comment syntax highlighting.
- Changed multi-line comments to use ### for the beginning and end of a comment.
- Fix asset path document links not working if the Game directory is not the Working Directory.
- Add hovering over UUID and document links for more information.
- Add decorations for UUID and document links to see what they are pointing to.
- Add distinct colors for UUIDs that are generic, point to a local element (point to an Entity, etc.), or point to a global element (another Asset file, etc.).
- Update README to reflect new features.

## 1.3.7

- Update README to reflect recent 1.3.x changes.

## 1.3.6

- Fix document link provider. It now searches for 16 character or 32 character UUIDs.

## 1.3.5

- Update UUID generator to generate 32 character long UUIDs.
- Update syntax highlighting to recognize 16 character long UUIDs and 32 character long UUIDs.

## 1.3.4

- Fix shortcuts for finding an asset UUID and path.

## 1.3.3

- Removed the shortcut for generating a UUID (ctrl+alt+u ctrl+alt+u).
- Changed the shortcut to find an asset UUID to ctrl+alt+u ctrl+alt+u.
- Changed the shortcut to find an asset path to ctrl+alt+u ctrl+alt+y.

## 1.3.2

- Fix compile shader command. Stops it from creating a terminal each time it is ran.

## 1.3.1

- Add compile shader file command.
- Adjust create meta file command.

## 1.3

- Add create meta file command.
- Removed the Minty right click menu folder- commands are now on the main level.

## 1.2.2

- Fix "- " syntax highlighting.

## 1.2.1

- Fix UUID syntax highlighting.

## 1.2.0

- Improve template generation. Now uses names instead of extensions to increase ease of use.
- Add findAssetUUID command, which allows you to search for an asset via its name or UUID, and copy its UUID without having to open the file.
- Add findAssetPath command, which allows you to search for an asset via its name or UUID, and copy its path without having to open the file.

## 1.1.1

- Fix key-value name coloring, if the name was a number.

## 1.1.0

- Fix blue colors for non-.minty files.
- Add openMintyDirectory command, which opens the local Minty directory, if any. Found at $(MINTY_PATH).
- Update document link provider to check files within $(MINTY_PATH)/Data.
- Add syntax highlighting for macros when used.

## 1.0.4

- Fix README to have correct keyboard shortcuts.
- Rename color theme to "Minty."

## 1.0.3

- Adjust blue colors to be lighter.

## 1.0.2

- Fix single character name coloring in .minty files.

## 1.0.1

- Adjust theme to be more green.
- Add better coloring for .minty files.

## 1.0.0

- Initial release