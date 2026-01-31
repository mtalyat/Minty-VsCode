// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

const PATH_REGEX = /(([\w\.\-]+\/)+[\w\.\-]*)/g;
const UUID_REGEX = /\b[a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?\b/g;
const META_UUID_REGEX = /: ([a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?)/;

function generateUUID() {
	return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
}

function generateShortUUID() {
	return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
}

function openURL(path) {
	const url = vscode.Uri.file(path);
	vscode.env.openExternal(url);
}

/**
 * @param {string|vscode.Uri} uri
 */
function openDirectory(uri) {
	// If uri is a string, convert to vscode.Uri
	const folderUri = typeof uri === 'string' ? vscode.Uri.file(uri) : uri;
	vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: true });
}

async function getTemplateFiles() {
	const envPath = process.env.MINTY_PATH;

	if (!envPath) {
		vscode.window.showErrorMessage('MINTY_PATH environment variable is not set.');
		return null;
	}

	const metaFileUri = vscode.Uri.joinPath(vscode.Uri.file(envPath), 'Data', 'Templates', '.meta');

	try {
		const fileData = await vscode.workspace.fs.readFile(metaFileUri);
		const content = fileData.toString();

		const files = content
			.split('\n')
			.filter(line => line.trim() !== '')
			.map(line => {
				const [extension, name] = line.split(',').map(col => col.trim());
				return [extension, name];
			});

		return files;
	} catch (err) {
		vscode.window.showWarningMessage(`Failed to read Minty templates .meta file at ${metaFileUri.toString()}: ${err.message}`);
	}

	const folderUri = vscode.Uri.joinPath(vscode.Uri.file(envPath), 'Data', 'Templates');

	// If the .meta file doesn't exist, get the raw file names
	try {
		const entries = await vscode.workspace.fs.readDirectory(folderUri);

		const files = entries
			.filter(([name, type]) => type === vscode.FileType.File && !name.endsWith('.meta'))
			.map(([name]) => [name, name]);

		return files;
	} catch (err) {
		vscode.window.showErrorMessage(`Failed to find Minty templates directory at ${folderUri.toString()}: ${err.message}`);
		return null;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('minty-support now active.');

	// Create decoration types
	const uuidHintDecorationType = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
			margin: '0 0 0 1em'
		}
	});

	// Default UUID decoration (purple color for unknown references)
	const defaultUuidDecorationType = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('constant.other.uuid.default.minty')
	});

	// Local UUID decoration (cyan/blue color for local references)
	const localUuidDecorationType = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('constant.other.uuid.local.minty')
	});

	// Global UUID decoration (green/string color for global references)
	const globalUuidDecorationType = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('constant.other.uuid.global.minty')
	});

	async function updateUuidDecorations(editor) {
		if (!editor || editor.document.languageId !== 'minty') {
			return;
		}

		const document = editor.document;
		const decorations = [];

		// Find all UUID occurrences in the document
		const uuidOccurrences = {};
		for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
			const line = document.lineAt(lineNum);
			const lineText = line.text;

			// Calculate indentation level (count leading whitespace)
			const indentMatch = lineText.match(/^(\s*)/);
			const indentation = indentMatch ? indentMatch[1].length : 0;

			const uuidRegex = /\b[a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?\b/g;
			let match;
			while ((match = uuidRegex.exec(lineText)) !== null) {
				const uuid = match[0];
				if (!uuidOccurrences[uuid]) {
					uuidOccurrences[uuid] = [];
				}
				uuidOccurrences[uuid].push({
					lineNum,
					start: match.index,
					end: match.index + uuid.length,
					lineText: lineText,
					indentation: indentation
				});
			}
		}

		// Get all meta files for external lookups
		const workspaceMetaFiles = await vscode.workspace.findFiles('**/*.meta');
		let mintyMetaFiles = [];
		const mintyPath = process.env.MINTY_PATH;
		if (mintyPath) {
			const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
			try {
				const mintyDataMetaFiles = await vscode.workspace.findFiles(
					new vscode.RelativePattern(mintyDataUri, '**/*.meta')
				);
				mintyMetaFiles = mintyDataMetaFiles;
			} catch (e) {
				console.error('Error searching for meta files:', e);
			}
		}

		const metaFiles = [...workspaceMetaFiles, ...mintyMetaFiles];
		const uuidToFileMap = {};
		for (const metaFileUri of metaFiles) {
			try {
				const content = await fs.readFile(metaFileUri.fsPath, 'utf8');
				const match = content.match(META_UUID_REGEX);
				if (match) {
					const foundUuid = match[1];
					const filePath = metaFileUri.fsPath.replace(/\.meta$/, '');
					uuidToFileMap[foundUuid] = filePath;
				}
			} catch (e) {
				console.error(`Error reading meta file:`, e);
			}
		}

		// Find Game or Project directory
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		let workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
		let baseDir = workspaceRoot;
		
		if (workspaceRoot) {
			const gameDir = path.join(workspaceRoot, 'Game');
			const projectDir = path.join(workspaceRoot, 'Project');
			
			try {
				const gameStat = await vscode.workspace.fs.stat(vscode.Uri.file(gameDir));
				if (gameStat.type === vscode.FileType.Directory) {
					baseDir = gameDir;
				}
			} catch (e) {
				try {
					const projectStat = await vscode.workspace.fs.stat(vscode.Uri.file(projectDir));
					if (projectStat.type === vscode.FileType.Directory) {
						baseDir = projectDir;
					}
				} catch (e) {
					// Use workspace root
				}
			}
		}

		// Process each UUID occurrence
		const defaultUuidDecorations = [];
		const localUuidDecorations = [];
		const globalUuidDecorations = [];
		
		for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
			const line = document.lineAt(lineNum);
			const lineText = line.text;

			const uuidRegex = /\b[a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?\b/g;
			let match;
			while ((match = uuidRegex.exec(lineText)) !== null) {
				const uuid = match[0];
				const start = match.index;
				const end = start + uuid.length;

				let hintText = '';
				let isLocal = false;
				let isGlobal = false;

				// Check for local references first
				const occurrences = uuidOccurrences[uuid];
				if (occurrences && occurrences.length > 1) {
					// Find the occurrence with the lowest indentation
					const minIndentation = Math.min(...occurrences.map(o => o.indentation));
					const targetOccurrence = occurrences.find(o => o.indentation === minIndentation);
					
					const isTargetOccurrence = targetOccurrence.lineNum === lineNum && targetOccurrence.start === start;

					if (!isTargetOccurrence) {
						// Extract label from target occurrence
						const beforeUuid = targetOccurrence.lineText.substring(0, targetOccurrence.start).trim();
						let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();
						if (label) {
							hintText = `→ ${label}`;
						}
					}
					
					isLocal = true;
				}

				// Check external files if no local reference
				if (!hintText && uuidToFileMap[uuid]) {
					const filePath = uuidToFileMap[uuid];
					let displayPath = path.basename(filePath);
					
					// Get relative path if in workspace
					if (baseDir && filePath.startsWith(baseDir)) {
						displayPath = path.relative(baseDir, filePath).replace(/\\/g, '/');
					} else if (mintyPath && filePath.startsWith(path.join(mintyPath, 'Data'))) {
						const dataDir = path.join(mintyPath, 'Data');
						displayPath = path.relative(dataDir, filePath).replace(/\\/g, '/');
					}
					
					hintText = `→ ${displayPath}`;
					isGlobal = true;
				}

				// Add color decoration for the UUID itself
				const uuidRange = new vscode.Range(lineNum, start, lineNum, end);
				if (isLocal) {
					localUuidDecorations.push(uuidRange);
				} else if (isGlobal) {
					globalUuidDecorations.push(uuidRange);
				} else
				{
					defaultUuidDecorations.push(uuidRange);
				}

				if (hintText) {
					const range = new vscode.Range(lineNum, end, lineNum, end);
					decorations.push({
						range,
						renderOptions: {
							after: {
								contentText: hintText
							}
						}
					});
				}
			}
		}

		editor.setDecorations(uuidHintDecorationType, decorations);
		editor.setDecorations(defaultUuidDecorationType, defaultUuidDecorations);
		editor.setDecorations(localUuidDecorationType, localUuidDecorations);
		editor.setDecorations(globalUuidDecorationType, globalUuidDecorations);

		// Process path matches
		for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
			const line = document.lineAt(lineNum);
			const lineText = line.text;

			const pathRegex = /(([\w\.\-]+\/)+[\w\.\-]*)/g;
			let match;
			while ((match = pathRegex.exec(lineText)) !== null) {
				const pathMatch = match[0];
				const start = match.index;
				const end = start + pathMatch.length;

				// Normalize path
				const normalizedPath = pathMatch.replace(/\\/g, '/');

				// Try to find the file in workspace
				let fullPath = null;
				if (baseDir) {
					const candidatePath = path.join(baseDir, normalizedPath);
					try {
						await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
						fullPath = candidatePath;
					} catch (e) {
						// File not found in base dir
					}
				}

				// Try minty path
				if (!fullPath && mintyPath) {
					const dataDir = path.join(mintyPath, 'Data');
					const candidatePath = path.join(dataDir, normalizedPath);
					try {
						await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
						fullPath = candidatePath;
					} catch (e) {
						// File not found in minty data
					}
				}

				// If we found the file, check for .meta file
				if (fullPath) {
					const metaPath = `${fullPath}.meta`;
					try {
						const metaContent = await fs.readFile(metaPath, 'utf8');
						const metaMatch = metaContent.match(META_UUID_REGEX);
						if (metaMatch) {
							const uuid = metaMatch[1];
							const range = new vscode.Range(lineNum, end, lineNum, end);
							decorations.push({
								range,
								renderOptions: {
									after: {
										contentText: `→ ${uuid}`
									}
								}
							});
						}
					} catch (e) {
						// No .meta file or error reading it
					}
				}
			}
		}

		// Set decorations after processing paths
		editor.setDecorations(uuidHintDecorationType, decorations);
	}

	// Update decorations on active editor change
	if (vscode.window.activeTextEditor) {
		updateUuidDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateUuidDecorations(editor);
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (editor && event.document === editor.document) {
				updateUuidDecorations(editor);
			}
		})
	);

	const insertUUID = vscode.commands.registerCommand('minty-support.insertUUID', async function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return vscode.window.showErrorMessage('No active editor');
		}

		const uuid = generateUUID();

		editor.edit(editBuilder => {
			for (const selection of editor.selections) {
				editBuilder.insert(selection.active, uuid);
			}
		});

		// Copy to clipboard
		await vscode.env.clipboard.writeText(uuid);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`UUID copied to clipboard: ${uuid}`);
	});
	context.subscriptions.push(insertUUID);

	const insertNextUUID = vscode.commands.registerCommand('minty-support.insertNextUUID', async function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return vscode.window.showErrorMessage('No active editor');
		}

		const document = editor.document;
		const text = document.getText();

		// Regex to match 16 hex digits
		const hexRegex = /\b[0-9a-fA-F]{16}\b/g;
		const matches = [];
		let match;
		while ((match = hexRegex.exec(text)) !== null) {
			matches.push(match[0]);
		}

		// Parse as hex numbers
		const numbers = matches.map(m => parseInt(m, 16)).filter(n => !isNaN(n));

		// Find the next unused number starting from 1
		let nextNum = 1;
		while (numbers.includes(nextNum)) {
			nextNum++;
		}

		// Format as 16 hex digits uppercase
		const nextUUID = nextNum.toString(16).toUpperCase().padStart(16, '0');

		editor.edit(editBuilder => {
			for (const selection of editor.selections) {
				editBuilder.insert(selection.active, nextUUID);
			}
		});

		// Copy to clipboard
		await vscode.env.clipboard.writeText(nextUUID);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`Next UUID inserted and copied to clipboard: ${nextUUID}`);
	});
	context.subscriptions.push(insertNextUUID);

	const insertShortUUID = vscode.commands.registerCommand('minty-support.insertShortUUID', async function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return vscode.window.showErrorMessage('No active editor');
		}

		const shortUUID = generateShortUUID();

		editor.edit(editBuilder => {
			for (const selection of editor.selections) {
				editBuilder.insert(selection.active, shortUUID);
			}
		});

		// Copy to clipboard
		await vscode.env.clipboard.writeText(shortUUID);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`Short UUID inserted and copied to clipboard: ${shortUUID}`);
	});
	context.subscriptions.push(insertShortUUID);

	const generateUUIDDisposable = vscode.commands.registerCommand('minty-support.generateUUID', async function () {
		const uuid = generateUUID();

		// Copy to clipboard
		await vscode.env.clipboard.writeText(uuid);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`UUID copied to clipboard: ${uuid}`);
	});
	context.subscriptions.push(generateUUIDDisposable);

	const generateShortUUIDDisposable = vscode.commands.registerCommand('minty-support.generateShortUUID', async function () {
		const shortUUID = generateShortUUID();

		// Copy to clipboard
		await vscode.env.clipboard.writeText(shortUUID);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`Short UUID copied to clipboard: ${shortUUID}`);
	});
	context.subscriptions.push(generateShortUUIDDisposable);

	const openWebsite = vscode.commands.registerCommand('minty-support.openMintyDocs', () => {
		openURL('https://github.com/mtalyat/Minty/wiki');
	});
	context.subscriptions.push(openWebsite);

	const openRepo = vscode.commands.registerCommand('minty-support.openMintyRepo', () => {
		openURL('https://github.com/mtalyat/Minty');
	});
	context.subscriptions.push(openRepo);

	const openDir = vscode.commands.registerCommand('minty-support.openMintyDirectory', () => {
		const mintyPath = process.env.MINTY_PATH;
		if (!mintyPath) {
			return vscode.window.showErrorMessage('MINTY_PATH environment variable is not set.');
		}
		openDirectory(mintyPath);
	});
	context.subscriptions.push(openDir);

	const createFile = vscode.commands.registerCommand('minty-support.createMintyFile', async (uri) => {
		// 'uri' is the file/folder you right-clicked on in Explorer

		let folderUri;

		// If right-clicked a folder, use it directly
		if ((await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory) {
			folderUri = uri;
		} else {
			// If right-clicked a file, use its parent folder
			folderUri = uri.with({ path: path.dirname(uri.path) });
		}

		// get list of template files
		const templateFiles = await getTemplateFiles();
		if (!templateFiles || templateFiles.length === 0) {
			vscode.window.showErrorMessage('No Minty template files found.');
			return;
		}

		// create a list of just the names from the template files tuples
		const templateFileNames = templateFiles.map(([extension, name]) => name);

		// Show quick pick to select template
		const selectedTemplate = await vscode.window.showQuickPick(templateFileNames, {
			placeHolder: 'Select a Minty template file to use',
			canPickMany: false
		});
		if (!selectedTemplate) return;

		// find the extension of the selected template
		const templateFileTuple = templateFiles.find(([extension, name]) => name === selectedTemplate);
		if (!templateFileTuple) {
			vscode.window.showErrorMessage(`Template file for "${selectedTemplate}" not found.`);
			return;
		}
		const selectedTemplateExtension = templateFileTuple[0];

		// get template file path
		const templateFilePath = vscode.Uri.joinPath(
			vscode.Uri.file(process.env.MINTY_PATH),
			'Data',
			'Templates',
			selectedTemplateExtension
		);

		// Read the template file
		let fileData;
		try {
			fileData = await vscode.workspace.fs.readFile(templateFilePath);
			fileData = fileData.toString();
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to read template file: ${err.message}`);
			return;
		}

		// Show name
		const fileName = await vscode.window.showInputBox({
			prompt: 'Enter new .minty file name (without extension)',
			placeHolder: 'example'
		});
		if (!fileName) return;

		// get file path
		const filePath = vscode.Uri.joinPath(folderUri, `${fileName}${selectedTemplateExtension}`);

		// get .meta file path
		const metaPath = `${filePath.path.toString()}.meta`;

		// create the .meta file content
		const uuid = generateUUID();
		const metaContent = `: ${uuid}
`;

		// write the .meta file
		try {
			await vscode.workspace.fs.writeFile(vscode.Uri.file(metaPath), Buffer.from(metaContent, 'utf8'));
		}
		catch (err) {
			vscode.window.showErrorMessage(`Failed to create .meta file: ${err.message}`);
		}

		// create the new file with template content
		try {
			await vscode.workspace.fs.writeFile(filePath, Buffer.from(fileData, 'utf8'));
			const doc = await vscode.workspace.openTextDocument(filePath);
			await vscode.window.showTextDocument(doc);
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to create file: ${err.message}`);
		}
	});
	context.subscriptions.push(createFile);

	const createMetaFile = vscode.commands.registerCommand('minty-support.createMetaFile', async (uri, selectedUris) => {
		// 'uri' is the primary file right-clicked, 'selectedUris' contains all selected files
		
		// Get all selected files - if multiple selection, use selectedUris, otherwise use single uri
		const filesToProcess = selectedUris && selectedUris.length > 0 ? selectedUris : [uri];

		if (!filesToProcess || filesToProcess.length === 0) {
			vscode.window.showErrorMessage('No files selected.');
			return;
		}

		const createdUuids = [];
		let errorCount = 0;

		for (const fileUri of filesToProcess) {
			try {
				// Ensure it's a file, not a folder
				const stat = await vscode.workspace.fs.stat(fileUri);
				if (stat.type === vscode.FileType.Directory) {
					continue; // Skip folders
				}

				// Skip if this is already a .meta file
				if (fileUri.path.endsWith('.meta')) {
					continue;
				}

				// Create meta file path by adding .meta extension
				const metaPath = fileUri.with({ path: `${fileUri.path}.meta` });

				// Check if meta file already exists
				try {
					await vscode.workspace.fs.stat(metaPath);
					// If we get here, the file exists, so skip it
					continue;
				} catch (err) {
					// File doesn't exist, proceed with creation
				}

				// Generate UUID for this file
				const uuid = generateUUID();

				// Create meta file content
				const metaContent = `: ${uuid}\n`;

				// Write the .meta file
				await vscode.workspace.fs.writeFile(metaPath, Buffer.from(metaContent, 'utf8'));
				
				createdUuids.push(uuid);
			} catch (err) {
				console.error(`Failed to create meta file for ${fileUri.path}: ${err.message}`);
				errorCount++;
			}
		}

		if (createdUuids.length > 0) {
			// Copy the last UUID to clipboard (or all UUIDs if multiple)
			const clipboardContent = createdUuids.length === 1 ? createdUuids[0] : createdUuids.join('\n');
			await vscode.env.clipboard.writeText(clipboardContent);

			// Show confirmation message
			const message = createdUuids.length === 1 
				? `Meta file created with UUID copied to clipboard: ${createdUuids[0]}`
				: `${createdUuids.length} meta files created. UUIDs copied to clipboard.`;
			
			vscode.window.showInformationMessage(message);
		}

		if (errorCount > 0) {
			vscode.window.showWarningMessage(`${errorCount} files could not be processed (may be folders or errors occurred).`);
		}
	});
	context.subscriptions.push(createMetaFile);

	const compileShader = vscode.commands.registerCommand('minty-support.compileShader', async (uri, selectedUris) => {
		// 'uri' is the primary file right-clicked, 'selectedUris' contains all selected files
		
		// Get all selected files - if multiple selection, use selectedUris, otherwise use single uri
		const filesToProcess = selectedUris && selectedUris.length > 0 ? selectedUris : [uri];

		if (!filesToProcess || filesToProcess.length === 0) {
			vscode.window.showErrorMessage('No files selected.');
			return;
		}
		
		// Find existing terminal with matching name or create a new one
		const terminalName = 'Minty GLSL Compiler';
		let terminal = vscode.window.terminals.find(t => t.name === terminalName);
		
		if (!terminal) {
			terminal = vscode.window.createTerminal(terminalName);
		}
		
		for (const fileUri of filesToProcess) {
			const outputPath = `${fileUri.fsPath}.spv`;
			
			// Compile the shader
			terminal.sendText(`glslc "${fileUri.fsPath}" -o "${outputPath}"`);
		}
		terminal.show();
	});
	context.subscriptions.push(compileShader);

	const findAssetUUID = vscode.commands.registerCommand('minty-support.findAssetUUID', async function () {
		// Get all meta files in workspace and in $(MINTY_PATH)/Data/
		const workspaceMetaFiles = await vscode.workspace.findFiles('**/*.meta');

		let mintyMetaFiles = [];
		const mintyPath = process.env.MINTY_PATH;
		if (mintyPath) {
			const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
			try {
				const mintyDataMetaFiles = await vscode.workspace.findFiles(
					new vscode.RelativePattern(mintyDataUri, '**/*.meta')
				);
				mintyMetaFiles = mintyDataMetaFiles;
			} catch (e) {
				console.error('Error searching for meta files in MINTY_PATH/Data:', e);
			}
		}

		const metaFiles = [...workspaceMetaFiles, ...mintyMetaFiles];

		if (metaFiles.length === 0) {
			vscode.window.showInformationMessage('No assets with .meta files found.');
			return;
		}

		// Build a list of assets with their UUIDs for the quick pick
		const assetItems = [];
		for (const metaFileUri of metaFiles) {
			try {
				const content = await fs.readFile(metaFileUri.fsPath, 'utf8');
				const match = content.match(META_UUID_REGEX);
				if (match) {
					const uuid = match[1];
					const assetPath = metaFileUri.fsPath.replace(/\.meta$/, '');
					
					// Get relative path for display
					const workspaceFolders = vscode.workspace.workspaceFolders || [];
					let displayPath = assetPath;
					
					if (workspaceFolders.length > 0) {
						const workspaceRoot = workspaceFolders[0].uri.fsPath;
						if (assetPath.startsWith(workspaceRoot)) {
							displayPath = path.relative(workspaceRoot, assetPath).replace(/\\/g, '/');
						}
					}
					
					// If it's from MINTY_PATH, show it relative to Data folder
					if (mintyPath && assetPath.startsWith(path.join(mintyPath, 'Data'))) {
						const dataDir = path.join(mintyPath, 'Data');
						displayPath = `[Minty] ${path.relative(dataDir, assetPath).replace(/\\/g, '/')}`;
					}

					assetItems.push({
						label: displayPath,
						description: uuid,
						uuid: uuid,
						assetPath: assetPath
					});
				}
			} catch (e) {
				console.error(`Error reading meta file ${metaFileUri.fsPath}:`, e);
			}
		}

		if (assetItems.length === 0) {
			vscode.window.showInformationMessage('No valid assets with UUIDs found.');
			return;
		}

		// Sort by label for better UX
		assetItems.sort((a, b) => a.label.localeCompare(b.label));

		// Show quick pick
		const selectedAsset = await vscode.window.showQuickPick(assetItems, {
			placeHolder: 'Select an asset to copy its UUID',
			matchOnDescription: true
		});

		if (selectedAsset) {
			// Copy UUID to clipboard
			await vscode.env.clipboard.writeText(selectedAsset.uuid);
			vscode.window.showInformationMessage(`UUID copied to clipboard: ${selectedAsset.uuid}`);
		}
	});
	context.subscriptions.push(findAssetUUID);

	const findAssetPath = vscode.commands.registerCommand('minty-support.findAssetPath', async function () {
		// Get all meta files in workspace and in $(MINTY_PATH)/Data/
		const workspaceMetaFiles = await vscode.workspace.findFiles('**/*.meta');

		let mintyMetaFiles = [];
		const mintyPath = process.env.MINTY_PATH;
		if (mintyPath) {
			const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
			try {
				const mintyDataMetaFiles = await vscode.workspace.findFiles(
					new vscode.RelativePattern(mintyDataUri, '**/*.meta')
				);
				mintyMetaFiles = mintyDataMetaFiles;
			} catch (e) {
				console.error('Error searching for meta files in MINTY_PATH/Data:', e);
			}
		}

		const metaFiles = [...workspaceMetaFiles, ...mintyMetaFiles];

		if (metaFiles.length === 0) {
			vscode.window.showInformationMessage('No assets with .meta files found.');
			return;
		}

		// Build a list of assets with their paths for the quick pick
		const assetItems = [];
		for (const metaFileUri of metaFiles) {
			try {
				const content = await fs.readFile(metaFileUri.fsPath, 'utf8');
				const match = content.match(META_UUID_REGEX);
				if (match) {
					const uuid = match[1];
					const assetPath = metaFileUri.fsPath.replace(/\.meta$/, '');
					
					// Get relative path for display and copying
					const workspaceFolders = vscode.workspace.workspaceFolders || [];
					let displayPath = assetPath;
					let copyPath = assetPath;
					
					if (workspaceFolders.length > 0) {
						const workspaceRoot = workspaceFolders[0].uri.fsPath;
						if (assetPath.startsWith(workspaceRoot)) {
							const relativePath = path.relative(workspaceRoot, assetPath).replace(/\\/g, '/');
							displayPath = relativePath;
							copyPath = relativePath;
						}
					}
					
					// If it's from MINTY_PATH, show it relative to Data folder
					if (mintyPath && assetPath.startsWith(path.join(mintyPath, 'Data'))) {
						const dataDir = path.join(mintyPath, 'Data');
						const relativePath = path.relative(dataDir, assetPath).replace(/\\/g, '/');
						displayPath = `[Minty] ${relativePath}`;
						copyPath = relativePath;
					}

					// Remove leading "Game/" or "Project/" from copyPath if present
					if (copyPath.startsWith('Game/')) {
						copyPath = copyPath.substring(5); // Remove "Game/"
					} else if (copyPath.startsWith('Project/')) {
						copyPath = copyPath.substring(8); // Remove "Project/"
					}

					assetItems.push({
						label: displayPath,
						description: uuid,
						uuid: uuid,
						assetPath: copyPath
					});
				}
			} catch (e) {
				console.error(`Error reading meta file ${metaFileUri.fsPath}:`, e);
			}
		}

		if (assetItems.length === 0) {
			vscode.window.showInformationMessage('No valid assets with UUIDs found.');
			return;
		}

		// Sort by label for better UX
		assetItems.sort((a, b) => a.label.localeCompare(b.label));

		// Show quick pick
		const selectedAsset = await vscode.window.showQuickPick(assetItems, {
			placeHolder: 'Select an asset to copy its path',
			matchOnDescription: true
		});

		if (selectedAsset) {
			// Copy path to clipboard
			await vscode.env.clipboard.writeText(selectedAsset.assetPath);
			vscode.window.showInformationMessage(`Path copied to clipboard: ${selectedAsset.assetPath}`);
		}
	});
	context.subscriptions.push(findAssetPath);

	const provider = vscode.languages.registerDocumentLinkProvider('minty', {
		async provideDocumentLinks(document, token) {
			const links = [];

			// Get all meta files in workspace and in $(MINTY_PATH)/Data/
			const workspaceMetaFiles = await vscode.workspace.findFiles('**/*.meta');

			let mintyMetaFiles = [];
			const mintyPath = process.env.MINTY_PATH;
			if (mintyPath) {
				const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
				try {
					const mintyDataMetaFiles = await vscode.workspace.findFiles(
						new vscode.RelativePattern(mintyDataUri, '**/*.meta')
					);
					mintyMetaFiles = mintyDataMetaFiles;
				} catch (e) {
					console.error('Error searching for meta files in MINTY_PATH/Data:', e);
				}
			}

			const metaFiles = [...workspaceMetaFiles, ...mintyMetaFiles];

			// Build a map: UUID -> file path
			const uuidToFileMap = {};
			for (const metaFileUri of metaFiles) {
				try {
					const content = await fs.readFile(metaFileUri.fsPath, 'utf8');
					const match = content.match(META_UUID_REGEX);
					if (match) {
						const uuid = match[1];
						const filePath = metaFileUri.fsPath.replace(/\.meta$/, '');
						uuidToFileMap[uuid] = filePath;
					}
				} catch (e) {
					console.error(`Error reading meta file ${metaFileUri.fsPath}:`, e);
				}
			}

			const workspaceFiles = await vscode.workspace.findFiles('**/*', '{**/*.meta,**/.*,**/.*/**}');
			let mintyFiles = [];
			if (mintyPath) {
				const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
				try {
					const mintyDataFiles = await vscode.workspace.findFiles(
						new vscode.RelativePattern(mintyDataUri, '**/*'),
						'**/*.meta'
					);
					mintyFiles = mintyDataFiles;
				} catch (e) {
					console.error('Error searching for files in MINTY_PATH/Data:', e);
				}
			}

			// console.log(`UUID map: ${JSON.stringify(uuidToFileMap, null, 2)}`);

			const fileMap = {};

			// Find Game or Project directory to use as base
			const workspaceFolders = vscode.workspace.workspaceFolders || [];
			let workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
			let baseDir = workspaceRoot;
			
			// Look for Game or Project directory in the workspace
			if (workspaceRoot) {
				const gameDir = path.join(workspaceRoot, 'Game');
				const projectDir = path.join(workspaceRoot, 'Project');
				
				try {
					const gameStat = await vscode.workspace.fs.stat(vscode.Uri.file(gameDir));
					if (gameStat.type === vscode.FileType.Directory) {
						baseDir = gameDir;
					}
				} catch (e) {
					// Game directory doesn't exist, try Project
					try {
						const projectStat = await vscode.workspace.fs.stat(vscode.Uri.file(projectDir));
						if (projectStat.type === vscode.FileType.Directory) {
							baseDir = projectDir;
						}
					} catch (e) {
						// Neither exists, use workspace root
					}
				}
			}

			// Map workspace files: key = relative to base directory (with forward slashes), value = full path
			for (const file of workspaceFiles) {
				let relPath = baseDir && file.fsPath.startsWith(baseDir)
					? path.relative(baseDir, file.fsPath)
					: file.fsPath;
				relPath = relPath.replace(/\\/g, '/'); // normalize to forward slashes
				fileMap[relPath] = file.fsPath;
			}

			// Map minty files: key = relative to Data dir (with forward slashes), value = full path
			if (mintyPath) {
				const dataDir = path.join(mintyPath, 'Data');
				for (const file of mintyFiles) {
					// Always calculate the relative path from the Data directory
					let relPath = path.relative(dataDir, file.fsPath);
					relPath = relPath.replace(/\\/g, '/'); // normalize to forward slashes
					fileMap[relPath] = file.fsPath;
				}
			}

			// console.log(`File map: ${JSON.stringify(fileMap, null, 2)}`);

			// First pass: collect all UUID occurrences in the document
			const uuidOccurrences = {}; // uuid -> array of {lineNum, start, end, indentation}
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				// Calculate indentation level (count leading whitespace)
				const indentMatch = lineText.match(/^(\s*)/);
				const indentation = indentMatch ? indentMatch[1].length : 0;

				let match;
				const uuidRegex = /\b[a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?\b/g;
				while ((match = uuidRegex.exec(lineText)) !== null) {
					const uuid = match[0];
					const start = match.index;
					const end = start + uuid.length;

					if (!uuidOccurrences[uuid]) {
						uuidOccurrences[uuid] = [];
					}
					uuidOccurrences[uuid].push({ lineNum, start, end, indentation });
				}
			}

			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				// --- UUID links ---
				let match;
				while ((match = UUID_REGEX.exec(lineText)) !== null) {
					const uuid = match[0];
					const start = match.index;
					const end = start + uuid.length;

					const range = new vscode.Range(
						new vscode.Position(lineNum, start),
						new vscode.Position(lineNum, end)
					);

					// Check if this UUID appears multiple times in the document
					const occurrences = uuidOccurrences[uuid];
					if (occurrences && occurrences.length > 1) {
						// Find the occurrence with the lowest indentation
						const minIndentation = Math.min(...occurrences.map(o => o.indentation));
						const targetOccurrence = occurrences.find(o => o.indentation === minIndentation);
						
						const isTargetOccurrence = targetOccurrence.lineNum === lineNum && targetOccurrence.start === start;

						if (!isTargetOccurrence) {
							// This is not the target occurrence, link to the lowest indented occurrence
							const targetPosition = new vscode.Position(targetOccurrence.lineNum, targetOccurrence.start);
							const targetUri = document.uri.with({ fragment: `L${targetOccurrence.lineNum + 1}` });
							links.push(new vscode.DocumentLink(range, targetUri));
							continue; // Skip checking meta files
						}
					}

					// Search meta files for this UUID (only for first occurrence or unique UUIDs)
					if (uuidToFileMap[uuid]) {
						const foundUri = vscode.Uri.file(uuidToFileMap[uuid]);

						// remove '.meta' from the file path
						const baseFileUri = foundUri.with({ path: foundUri.path.replace(/\.meta$/, '') });
						links.push(new vscode.DocumentLink(range, baseFileUri));
					}
				}

				// --- Path links ---
				while ((match = PATH_REGEX.exec(lineText)) !== null) {
					const pathMatch = match[0];
					const start = match.index;
					const end = start + pathMatch.length;

					const range = new vscode.Range(
						new vscode.Position(lineNum, start),
						new vscode.Position(lineNum, end)
					);

					// console.log(`Found path match: ${pathMatch}`);

					// Always use forward slashes for lookup
					const normalizedPath = pathMatch.replace(/\\/g, '/');

					// check if normalizedPath is within files set
					if (fileMap[normalizedPath]) {
						// console.log(`Found file: ${normalizedPath}`);
						// If normalizedPath is in the files set, create a link
						const fileUri = vscode.Uri.file(fileMap[normalizedPath]);
						links.push(new vscode.DocumentLink(range, fileUri));
					} else {
						// console.log(`File not found in fileMap: ${normalizedPath}`);
					}
				}
			}

			// console.log(`Document link provider found ${links.length} links.`);
			return links;
		}
	});

	context.subscriptions.push(provider);

	const hoverProvider = vscode.languages.registerHoverProvider('minty', {
		async provideHover(document, position, token) {
			const range = document.getWordRangeAtPosition(position, UUID_REGEX);
			if (!range) {
				return null;
			}

			const uuid = document.getText(range);

			// First, check for local references in the document
			const uuidOccurrences = [];
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				const uuidRegex = /\b[a-fA-F0-9]{16}(?:[a-fA-F0-9]{16})?\b/g;
				let match;
				while ((match = uuidRegex.exec(lineText)) !== null) {
					if (match[0] === uuid) {
						uuidOccurrences.push({
							lineNum,
							start: match.index,
							end: match.index + match[0].length,
							lineText: lineText
						});
					}
				}
			}

			// If this UUID appears multiple times in the document, show local reference info
			if (uuidOccurrences.length > 1) {
				const firstOccurrence = uuidOccurrences[0];
				const lineText = firstOccurrence.lineText;
				
				// Extract the label/key before the UUID (everything before the UUID on that line)
				const beforeUuid = lineText.substring(0, firstOccurrence.start).trim();
				
				// Remove common suffixes like ':' or '-' from the label
				let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();
				
				const hoverMessage = new vscode.MarkdownString();
				hoverMessage.appendCodeblock(uuid, 'text');
				
				if (label) {
					hoverMessage.appendMarkdown(`**Local reference to:** ${label}`);
				} else {
					hoverMessage.appendMarkdown(`**Local reference** (line ${firstOccurrence.lineNum + 1})`);
				}
				
				return new vscode.Hover(hoverMessage, range);
			}

			// Get all meta files in workspace and in $(MINTY_PATH)/Data/
			const workspaceMetaFiles = await vscode.workspace.findFiles('**/*.meta');

			let mintyMetaFiles = [];
			const mintyPath = process.env.MINTY_PATH;
			if (mintyPath) {
				const mintyDataUri = vscode.Uri.file(path.join(mintyPath, 'Data'));
				try {
					const mintyDataMetaFiles = await vscode.workspace.findFiles(
						new vscode.RelativePattern(mintyDataUri, '**/*.meta')
					);
					mintyMetaFiles = mintyDataMetaFiles;
				} catch (e) {
					console.error('Error searching for meta files in MINTY_PATH/Data:', e);
				}
			}

			const metaFiles = [...workspaceMetaFiles, ...mintyMetaFiles];

			// Build a map: UUID -> file path
			const uuidToFileMap = {};
			for (const metaFileUri of metaFiles) {
				try {
					const content = await fs.readFile(metaFileUri.fsPath, 'utf8');
					const match = content.match(META_UUID_REGEX);
					if (match) {
						const foundUuid = match[1];
						const filePath = metaFileUri.fsPath.replace(/\.meta$/, '');
						uuidToFileMap[foundUuid] = filePath;
					}
				} catch (e) {
					console.error(`Error reading meta file ${metaFileUri.fsPath}:`, e);
				}
			}

			// Look up the UUID in meta files
			if (uuidToFileMap[uuid]) {
				const filePath = uuidToFileMap[uuid];
				
				// Get relative path for display
				const workspaceFolders = vscode.workspace.workspaceFolders || [];
				let displayPath = filePath;
				
				if (workspaceFolders.length > 0) {
					const workspaceRoot = workspaceFolders[0].uri.fsPath;
					if (filePath.startsWith(workspaceRoot)) {
						displayPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
					}
				}
				
				// If it's from MINTY_PATH, show it relative to Data folder
				if (mintyPath && filePath.startsWith(path.join(mintyPath, 'Data'))) {
					const dataDir = path.join(mintyPath, 'Data');
					displayPath = `[Minty] ${path.relative(dataDir, filePath).replace(/\\/g, '/')}`;
				}

				const hoverMessage = new vscode.MarkdownString();
				hoverMessage.appendCodeblock(uuid, 'text');
				hoverMessage.appendMarkdown(`**Global reference to:** ${displayPath}`);
				
				return new vscode.Hover(hoverMessage, range);
			}

			return null;
		}
	});

	context.subscriptions.push(hoverProvider);
}

// This method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
