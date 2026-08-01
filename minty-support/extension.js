// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

const PATH_REGEX = /(([\w\.\-]+\/)+[\w\.\-]*)/g;
const UUID_REGEX = /\b[a-fA-F0-9]{32}\b/g;
const META_UUID_REGEX = /^[^\r\n]*\b([a-fA-F0-9]{32})\b/;

function generateUUID() {
	return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
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

function normalizePath(value) {
	return value.replace(/\\/g, '/');
}

function getMintyPath() {
	return process.env.MINTY_PATH || '';
}

function getMintyDataPath() {
	const mintyPath = getMintyPath();
	return mintyPath ? path.join(mintyPath, 'Data') : '';
}

function getMintyDataUri() {
	const mintyDataPath = getMintyDataPath();
	return mintyDataPath ? vscode.Uri.file(mintyDataPath) : null;
}

async function getWorkspaceRootPath() {
	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	return workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
}

async function getWorkspaceBaseDir(workspaceRoot) {
	if (!workspaceRoot) {
		return '';
	}

	const candidateNames = ['Game', 'Project'];
	for (const name of candidateNames) {
		const candidatePath = path.join(workspaceRoot, name);
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
			if (stat.type === vscode.FileType.Directory) {
				return candidatePath;
			}
		} catch {
			// Continue checking other candidates.
		}
	}

	return workspaceRoot;
}

async function getTemplateFolderUri(envPath) {
	const templateFolders = ['Template', 'Templates'];

	for (const folderName of templateFolders) {
		const folderUri = vscode.Uri.joinPath(vscode.Uri.file(envPath), 'Data', folderName);
		try {
			const stat = await vscode.workspace.fs.stat(folderUri);
			if (stat.type === vscode.FileType.Directory) {
				return folderUri;
			}
		} catch {
			// Continue checking other candidate directories.
		}
	}

	return null;
}

function getDisplayPath(filePath, workspaceRoot, mintyDataPath) {
	if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
		return normalizePath(path.relative(workspaceRoot, filePath));
	}

	if (mintyDataPath && filePath.startsWith(mintyDataPath)) {
		return `[Minty] ${normalizePath(path.relative(mintyDataPath, filePath))}`;
	}

	return filePath;
}

function getCopyPath(filePath, workspaceRoot, mintyDataPath) {
	let copyPath = filePath;

	if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
		copyPath = normalizePath(path.relative(workspaceRoot, filePath));
	} else if (mintyDataPath && filePath.startsWith(mintyDataPath)) {
		copyPath = normalizePath(path.relative(mintyDataPath, filePath));
	}

	if (copyPath.startsWith('Game/')) {
		return copyPath.substring(5);
	}

	if (copyPath.startsWith('Project/')) {
		return copyPath.substring(8);
	}

	return copyPath;
}

async function getMintyFiles() {
	const workspaceMintyFiles = await vscode.workspace.findFiles('**/*.minty');
	const mintyFiles = [...workspaceMintyFiles];

	const mintyDataUri = getMintyDataUri();
	if (mintyDataUri) {
		try {
			const externalMintyFiles = await vscode.workspace.findFiles(
				new vscode.RelativePattern(mintyDataUri, '**/*.minty')
			);
			mintyFiles.push(...externalMintyFiles);
		} catch (e) {
			console.error('Error searching for Minty files in MINTY_PATH/Data:', e);
		}
	}

	const uniqueFiles = [];
	const seen = new Set();
	for (const fileUri of mintyFiles) {
		if (!seen.has(fileUri.fsPath)) {
			seen.add(fileUri.fsPath);
			uniqueFiles.push(fileUri);
		}
	}

	return uniqueFiles;
}

async function buildUuidToFileMap(mintyFiles) {
	const uuidToFileMap = {};

	for (const fileUri of mintyFiles) {
		try {
			const content = await fs.readFile(fileUri.fsPath, 'utf8');
			const match = content.match(META_UUID_REGEX);
			if (match) {
				uuidToFileMap[match[1]] = fileUri.fsPath;
			}
		} catch (e) {
			console.error(`Error reading Minty file ${fileUri.fsPath}:`, e);
		}
	}

	return uuidToFileMap;
}

async function getLookupContext() {
	const workspaceRoot = await getWorkspaceRootPath();
	const baseDir = await getWorkspaceBaseDir(workspaceRoot);
	const mintyPath = getMintyPath();
	const mintyDataPath = getMintyDataPath();
	const mintyFiles = await getMintyFiles();
	const uuidToFileMap = await buildUuidToFileMap(mintyFiles);

	return {
		workspaceRoot,
		baseDir,
		mintyPath,
		mintyDataPath,
		mintyFiles,
		uuidToFileMap
	};
}

async function getTemplateFiles() {
	const envPath = getMintyPath();

	if (!envPath) {
		vscode.window.showErrorMessage('MINTY_PATH environment variable is not set.');
		return null;
	}

	const templateFolderUri = await getTemplateFolderUri(envPath);
	if (!templateFolderUri) {
		vscode.window.showErrorMessage('Failed to find Minty template directory in MINTY_PATH/Data.');
		return null;
	}

	const metaFileUri = vscode.Uri.joinPath(templateFolderUri, '.meta');

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

	// If the .meta file doesn't exist, get the raw file names
	try {
		const entries = await vscode.workspace.fs.readDirectory(templateFolderUri);

		const files = entries
			.filter(([name, type]) => type === vscode.FileType.File && !name.endsWith('.meta'))
			.map(([name]) => [name, name]);

		return files;
	} catch (err) {
		vscode.window.showErrorMessage(`Failed to read Minty templates directory at ${templateFolderUri.toString()}: ${err.message}`);
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

			const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
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

		const {
			uuidToFileMap,
			baseDir,
			mintyDataPath
		} = await getLookupContext();

		// Process each UUID occurrence
		const defaultUuidDecorations = [];
		const localUuidDecorations = [];
		const globalUuidDecorations = [];
		
		for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
			const line = document.lineAt(lineNum);
			const lineText = line.text;

			const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
			let match;
			while ((match = uuidRegex.exec(lineText)) !== null) {
				const uuid = match[0];
				const start = match.index;
				const end = start + uuid.length;

				// Check if UUID is all zeros (treat as default, no references)
				const isZeroUuid = /^0+$/.test(uuid);

				let hintText = '';
				let isLocal = false;
				let isGlobal = false;
				let isPrefabEntity = false; // Track if this is a prefab entity reference

				// Check if UUID is wrapped in brackets (might be referencing entity in a prefab)
				const isWrappedInBrackets = start > 0 && lineText[start - 1] === '[' && lineText[end] === ']';
				
				if (!isZeroUuid && isWrappedInBrackets) {
				// Calculate current line's indentation
				const currentIndentMatch = lineText.match(/^(\s*)/);
				const currentIndentation = currentIndentMatch ? currentIndentMatch[1].length : 0;
				
				// Look backwards for an ancestor line with less indentation that has a prefab UUID
				let prefabUuid = null;
				for (let searchLineNum = lineNum - 1; searchLineNum >= 0; searchLineNum--) {
					const searchLine = document.lineAt(searchLineNum);
					const searchText = searchLine.text;
					
					// Calculate indentation
					const searchIndentMatch = searchText.match(/^(\s*)/);
					const searchIndentation = searchIndentMatch ? searchIndentMatch[1].length : 0;
					
					// Only check lines with less indentation (ancestor lines)
					if (searchIndentation < currentIndentation) {
						// Pattern 1: something: UUID [PrefabUUID] (exact UUID match)
						const prefabPattern1 = new RegExp(`:\\s*${uuid}\\s+\\[([a-fA-F0-9]{32})\\]`);
						const prefabMatch1 = searchText.match(prefabPattern1);
						
						if (prefabMatch1) {
							prefabUuid = prefabMatch1[1];
							break;
						}
						
						// Pattern 2: [PrefabUUID] at end of line (handles "UUID [PrefabUUID]" format)
						const prefabPattern2 = /\[([a-fA-F0-9]{32})\]\s*$/;
						const prefabMatch2 = searchText.match(prefabPattern2);
						
						if (prefabMatch2) {
							const potentialPrefabUuid = prefabMatch2[1];
							// Check if this UUID is in our map (it's a prefab)
							if (uuidToFileMap[potentialPrefabUuid]) {
								prefabUuid = potentialPrefabUuid;
								break;
							}
						}
						
						// Pattern 3: something: [PrefabUUID] (ancestor has prefab reference directly after colon)
						const prefabPattern3 = /:\s*\[?([a-fA-F0-9]{32})\]?$/;
						const prefabMatch3 = searchText.match(prefabPattern3);
						
						if (prefabMatch3) {
							const potentialPrefabUuid = prefabMatch3[1];
							// Check if this UUID is in our map (it's a prefab)
							if (uuidToFileMap[potentialPrefabUuid]) {
								prefabUuid = potentialPrefabUuid;
								break;
							}
						}
					}
				}
				
				if (prefabUuid) {
					isPrefabEntity = true; // Mark this as a prefab entity reference
					
					// Get the prefab file path
					if (uuidToFileMap[prefabUuid]) {
						const prefabFilePath = uuidToFileMap[prefabUuid];
						
						try {
							// Read the prefab file
							const prefabContent = await fs.readFile(prefabFilePath, 'utf8');
							const prefabLines = prefabContent.split('\n');
							
							// Search for the UUID in the prefab file
							for (const prefabLine of prefabLines) {
								if (prefabLine.includes(uuid)) {
									// Extract label before the UUID
									const uuidIndex = prefabLine.indexOf(uuid);
									const beforeUuid = prefabLine.substring(0, uuidIndex).trim();
									let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();
									
									if (label) {
										hintText = `-> ${label}`;
										isGlobal = true; // Prefab entities use global color
										break;
									}
								}
							}
						} catch (e) {
							// Failed to read prefab file
							console.error(`Error reading prefab file ${prefabFilePath}:`, e);
						}
					}
				}
			}

			// Check external files first (prefer global references)
				if (!isPrefabEntity && !hintText && !isZeroUuid && uuidToFileMap[uuid]) {
					const filePath = uuidToFileMap[uuid];
					let displayPath = path.basename(filePath);
					
					// Get relative path if in workspace
					if (baseDir && filePath.startsWith(baseDir)) {
						displayPath = normalizePath(path.relative(baseDir, filePath));
					} else if (mintyDataPath && filePath.startsWith(mintyDataPath)) {
						displayPath = normalizePath(path.relative(mintyDataPath, filePath));
					}
					
					hintText = `-> ${displayPath}`;
					isGlobal = true;
				} else if (!isPrefabEntity && !isZeroUuid) {
					// Check for local references only if no global reference found
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
								hintText = `-> ${label}`;
							}
							
							// Only mark as local if this is a reference (not the first definition)
							isLocal = true;
						}
					}
				}

				// Add color decoration for the UUID itself
				const uuidRange = new vscode.Range(lineNum, start, lineNum, end);
				if (isPrefabEntity) {
					// Prefab entities always use global color
					globalUuidDecorations.push(uuidRange);
				} else if (isLocal) {
					localUuidDecorations.push(uuidRange);
				} else if (isGlobal) {
					globalUuidDecorations.push(uuidRange);
				} else
				{
					defaultUuidDecorations.push(uuidRange);
				}

				if (hintText) {
					// Check if UUID is wrapped in brackets [UUID]
					let decorationPos = end;
					if (start > 0 && lineText[start - 1] === '[' && lineText[end] === ']') {
						decorationPos = end + 1; // Position after the closing bracket
					}
					
					const range = new vscode.Range(lineNum, decorationPos, lineNum, decorationPos);
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
					} catch {
						// File not found in base dir
					}
				}

				// Try minty path
				if (!fullPath && mintyDataPath) {
					const candidatePath = path.join(mintyDataPath, normalizedPath);
					try {
						await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
						fullPath = candidatePath;
					} catch {
						// File not found in minty data
					}
				}

				// If we found the file, check for a first-line UUID.
				if (fullPath) {
					try {
						const fileContent = await fs.readFile(fullPath, 'utf8');
						const uuidMatch = fileContent.match(META_UUID_REGEX);
						if (uuidMatch) {
							const uuid = uuidMatch[1].toUpperCase();
							
							// Check if path is wrapped in brackets
							let decorationPos = end;
							if (start > 0 && lineText[start - 1] === '[' && lineText[end] === ']') {
								decorationPos = end + 1; // Position after the closing bracket
							}
							
							const range = new vscode.Range(lineNum, decorationPos, lineNum, decorationPos);
							decorations.push({
								range,
								renderOptions: {
									after: {
										contentText: `-> ${uuid}`
									}
								}
							});
						}
					} catch {
						// No readable UUID in the target file.
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

	const generateUUIDDisposable = vscode.commands.registerCommand('minty-support.generateUUID', async function () {
		const uuid = generateUUID();

		// Copy to clipboard
		await vscode.env.clipboard.writeText(uuid);

		// Optional: Show confirmation
		vscode.window.showInformationMessage(`UUID copied to clipboard: ${uuid}`);
	});
	context.subscriptions.push(generateUUIDDisposable);

	const openWebsite = vscode.commands.registerCommand('minty-support.openMintyDocs', () => {
		openURL('https://github.com/mtalyat/Minty/wiki');
	});
	context.subscriptions.push(openWebsite);

	const openRepo = vscode.commands.registerCommand('minty-support.openMintyRepo', () => {
		openURL('https://github.com/mtalyat/Minty');
	});
	context.subscriptions.push(openRepo);

	const openDir = vscode.commands.registerCommand('minty-support.openMintyDirectory', () => {
		const mintyPath = getMintyPath();
		if (!mintyPath) {
			return vscode.window.showErrorMessage('MINTY_PATH environment variable is not set.');
		}
		openDirectory(mintyPath);
	});
	context.subscriptions.push(openDir);

	const createFile = vscode.commands.registerCommand('minty-support.createMintyFile', async (uri) => {
		// 'uri' is the file/folder you right-clicked on in Explorer

		let folderUri;
		let targetFileUri = null;

		const selectedStat = await vscode.workspace.fs.stat(uri);

		// If right-clicked a folder, use it directly
		if (selectedStat.type === vscode.FileType.Directory) {
			folderUri = uri;
		} else {
			// If right-clicked a file, use its parent folder
			folderUri = uri.with({ path: path.dirname(uri.path) });
			targetFileUri = uri;
		}

		// get list of template files
		const templateFiles = await getTemplateFiles();
		if (!templateFiles || templateFiles.length === 0) {
			vscode.window.showErrorMessage('No Minty template files found.');
			return;
		}

		// create a list of just the names from the template files tuples
		const templateFileNames = templateFiles.map(([, name]) => name);

		// Show quick pick to select template
		const selectedTemplate = await vscode.window.showQuickPick(templateFileNames, {
			placeHolder: 'Select a Minty template file to use',
			canPickMany: false
		});
		if (!selectedTemplate) return;

		// find the extension of the selected template
		const templateFileTuple = templateFiles.find(([, name]) => name === selectedTemplate);
		if (!templateFileTuple) {
			vscode.window.showErrorMessage(`Template file for "${selectedTemplate}" not found.`);
			return;
		}
		const selectedTemplateExtension = templateFileTuple[0];

		const mintyPath = getMintyPath();
		const templateFolderUri = await getTemplateFolderUri(mintyPath);
		if (!templateFolderUri) {
			vscode.window.showErrorMessage('Failed to find Minty template directory in MINTY_PATH/Data.');
			return;
		}

		// get template file path
		const templateFilePath = vscode.Uri.joinPath(templateFolderUri, selectedTemplateExtension);

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
		const uuid = generateUUID();

		let targetPath = '';
		let targetUuid = '';

		if (targetFileUri) {
			const relativeTargetPath = path.relative(folderUri.fsPath, targetFileUri.fsPath).replace(/\\/g, '/');
			targetPath = relativeTargetPath || path.basename(targetFileUri.fsPath);

			try {
				const targetContent = (await vscode.workspace.fs.readFile(targetFileUri)).toString();
				const targetMatch = targetContent.match(META_UUID_REGEX);
				if (targetMatch) {
					targetUuid = targetMatch[1].toUpperCase();
				}
			} catch {
				// Leave TARGET_UUID empty when target can't be read.
			}
		}

		fileData = fileData
			.replace(/\{UUID\}/g, uuid)
			.replace(/\{TARGET_PATH\}/g, targetPath)
			.replace(/\{TARGET_UUID\}/g, targetUuid);

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
		const {
			uuidToFileMap,
			mintyFiles,
			workspaceRoot,
			mintyDataPath
		} = await getLookupContext();

		if (mintyFiles.length === 0) {
			vscode.window.showInformationMessage('No assets with UUIDs found.');
			return;
		}

		// Build a list of assets with their UUIDs for the quick pick
		const assetItems = [];
		for (const [uuid, assetPath] of Object.entries(uuidToFileMap)) {
			assetItems.push({
				label: getDisplayPath(assetPath, workspaceRoot, mintyDataPath),
				description: uuid,
				uuid: uuid,
				assetPath: assetPath
			});
		}

		// Check if current file is a minty file and extract local UUIDs and prefab references
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'minty') {
			const document = editor.document;
			const localUUIDs = new Map(); // uuid -> {label, indentation}
			const prefabUUIDs = new Set();

			// First pass: collect all UUID occurrences
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				const indentMatch = lineText.match(/^(\s*)/);
				const indentation = indentMatch ? indentMatch[1].length : 0;

				const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
				let match;
				while ((match = uuidRegex.exec(lineText)) !== null) {
					const uuid = match[0];
					const isZeroUuid = /^0+$/.test(uuid);
					if (isZeroUuid) continue;

					// Check if UUID is wrapped in brackets [UUID] - these are prefab entity references
					const isWrappedInBrackets = match.index > 0 && 
						lineText[match.index - 1] === '[' && 
						lineText[match.index + uuid.length] === ']';
					
					// Check if it's a prefab reference pattern: UUID [PrefabUUID]
					const prefabPattern = new RegExp(`${uuid}\\s+\\[([a-fA-F0-9]{32})\\]`);
					const prefabMatch = lineText.match(prefabPattern);
					if (prefabMatch) {
						prefabUUIDs.add(prefabMatch[1]);
					}

					// Skip if this UUID is wrapped in brackets (prefab entity reference)
					if (isWrappedInBrackets) continue;

					// Skip if this UUID is in the global assets
					if (uuidToFileMap[uuid]) continue;

					// Extract label before the UUID
					const beforeUuid = lineText.substring(0, match.index).trim();
					let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();

					// Only add if we don't have this UUID yet, or this has lower indentation
					if (!localUUIDs.has(uuid) || indentation < localUUIDs.get(uuid).indentation) {
						localUUIDs.set(uuid, { label, indentation });
					}
				}
			}

			// Add local UUIDs to the asset items
			for (const [uuid, info] of localUUIDs) {
				let displayLabel = info.label || 'Unnamed';
				assetItems.unshift({
					label: `[Local] ${displayLabel}`,
					description: uuid,
					uuid: uuid,
					assetPath: null
				});
			}

			// Add prefab UUIDs
			for (const prefabUuid of prefabUUIDs) {
				if (uuidToFileMap[prefabUuid]) {
					const prefabFilePath = uuidToFileMap[prefabUuid];
					
					try {
						const prefabContent = await fs.readFile(prefabFilePath, 'utf8');
						const prefabLines = prefabContent.split('\n');
						const prefabLocalUUIDs = new Map();

						// Extract UUIDs from the prefab file
						for (const prefabLine of prefabLines) {
							const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
							let match;
							while ((match = uuidRegex.exec(prefabLine)) !== null) {
								const uuid = match[0];
								const isZeroUuid = /^0+$/.test(uuid);
								if (isZeroUuid || uuid === prefabUuid) continue;

								// Check if UUID is wrapped in brackets [UUID] - these are entity references
								const isWrappedInBrackets = match.index > 0 && 
									prefabLine[match.index - 1] === '[' && 
									prefabLine[match.index + uuid.length] === ']';
								
								// Skip if wrapped in brackets (entity reference)
								if (isWrappedInBrackets) continue;

								// Skip if already in global assets
								if (uuidToFileMap[uuid]) continue;

								// Extract label
								const beforeUuid = prefabLine.substring(0, match.index).trim();
								let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();

								if (!prefabLocalUUIDs.has(uuid)) {
									prefabLocalUUIDs.set(uuid, label);
								}
							}
						}

						// Add prefab UUIDs to asset items
						for (const [uuid, label] of prefabLocalUUIDs) {
							let displayLabel = label || 'Unnamed';
							assetItems.unshift({
								label: `[Prefab ${prefabUuid}] ${displayLabel}`,
								description: uuid,
								uuid: uuid,
								assetPath: null
							});
						}
					} catch (e) {
						console.error(`Error reading prefab file ${prefabFilePath}:`, e);
					}
				}
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
		const {
			uuidToFileMap,
			mintyFiles,
			workspaceRoot,
			mintyDataPath
		} = await getLookupContext();

		if (mintyFiles.length === 0) {
			vscode.window.showInformationMessage('No assets with UUIDs found.');
			return;
		}

		// Build a list of assets with their paths for the quick pick
		const assetItems = [];
		for (const [uuid, assetPath] of Object.entries(uuidToFileMap)) {
			assetItems.push({
				label: getDisplayPath(assetPath, workspaceRoot, mintyDataPath),
				description: uuid,
				uuid: uuid,
				assetPath: getCopyPath(assetPath, workspaceRoot, mintyDataPath)
			});
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
		async provideDocumentLinks(document) {
			const links = [];
			const {
				uuidToFileMap,
				mintyFiles,
				mintyDataPath,
				baseDir
			} = await getLookupContext();

			const workspaceFiles = await vscode.workspace.findFiles('**/*', '{**/.*,**/.*/**}');

			const fileMap = {};

			// Map workspace files: key = relative to base directory (with forward slashes), value = full path
			for (const file of workspaceFiles) {
				let relPath = baseDir && file.fsPath.startsWith(baseDir)
					? path.relative(baseDir, file.fsPath)
					: file.fsPath;
				relPath = normalizePath(relPath);
				fileMap[relPath] = file.fsPath;
			}

			// Map minty files: key = relative to Data dir (with forward slashes), value = full path
			if (mintyDataPath) {
				for (const file of mintyFiles) {
					// Always calculate the relative path from the Data directory
					let relPath = path.relative(mintyDataPath, file.fsPath);
					relPath = normalizePath(relPath);
					fileMap[relPath] = file.fsPath;
				}
			}

			// First pass: collect all UUID occurrences in the document
			const uuidOccurrences = {}; // uuid -> array of {lineNum, start, end, indentation}
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				// Calculate indentation level (count leading whitespace)
				const indentMatch = lineText.match(/^(\s*)/);
				const indentation = indentMatch ? indentMatch[1].length : 0;

				let match;
				const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
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

					// Skip zero UUIDs (no links for all-zero UUIDs)
					const isZeroUuid = /^0+$/.test(uuid);
					if (isZeroUuid) {
						continue;
					}

					const range = new vscode.Range(
						new vscode.Position(lineNum, start),
						new vscode.Position(lineNum, end)
					);

					// Check if UUID is wrapped in brackets (might be referencing entity in a prefab)
					const isWrappedInBrackets = start > 0 && lineText[start - 1] === '[' && lineText[end] === ']';
					
					if (isWrappedInBrackets) {
						// Calculate current line's indentation
						const currentIndentMatch = lineText.match(/^(\s*)/);
						const currentIndentation = currentIndentMatch ? currentIndentMatch[1].length : 0;
						
						// Look backwards for an ancestor line with less indentation that has a prefab UUID
						let prefabUuid = null;
						for (let searchLineNum = lineNum - 1; searchLineNum >= 0; searchLineNum--) {
							const searchLine = document.lineAt(searchLineNum);
							const searchText = searchLine.text;
							
							// Calculate indentation
							const searchIndentMatch = searchText.match(/^(\s*)/);
							const searchIndentation = searchIndentMatch ? searchIndentMatch[1].length : 0;
							
							// Only check lines with less indentation (ancestor lines)
							if (searchIndentation < currentIndentation) {
								// Pattern 1: something: UUID [PrefabUUID] (exact UUID match)
								const prefabPattern1 = new RegExp(`:\\s*${uuid}\\s+\\[([a-fA-F0-9]{32})\\]`);
								const prefabMatch1 = searchText.match(prefabPattern1);
								
								if (prefabMatch1) {
									prefabUuid = prefabMatch1[1];
									break;
								}
								
								// Pattern 2: [PrefabUUID] at end of line (handles "UUID [PrefabUUID]" format)
								const prefabPattern2 = /\[([a-fA-F0-9]{32})\]\s*$/;
								const prefabMatch2 = searchText.match(prefabPattern2);
								
								if (prefabMatch2) {
									const potentialPrefabUuid = prefabMatch2[1];
									// Check if this UUID is in our map (it's a prefab)
									if (uuidToFileMap[potentialPrefabUuid]) {
										prefabUuid = potentialPrefabUuid;
										break;
									}
								}
								
								// Pattern 3: something: [PrefabUUID] (ancestor has prefab reference directly after colon)
								const prefabPattern3 = /:\s*\[?([a-fA-F0-9]{32})\]?$/;
								const prefabMatch3 = searchText.match(prefabPattern3);
								
								if (prefabMatch3) {
									const potentialPrefabUuid = prefabMatch3[1];
									// Check if this UUID is in our map (it's a prefab)
									if (uuidToFileMap[potentialPrefabUuid]) {
										prefabUuid = potentialPrefabUuid;
										break;
									}
								}
							}
						}
						
						if (prefabUuid && uuidToFileMap[prefabUuid]) {
							const prefabFilePath = uuidToFileMap[prefabUuid];
							const prefabFileUri = vscode.Uri.file(prefabFilePath);
							
							// Try to find the line number in the prefab file where this UUID appears
							let foundPrefabLink = false;
							try {
								const prefabContent = await fs.readFile(prefabFilePath, 'utf8');
								const prefabLines = prefabContent.split('\n');
								
								for (let prefabLineNum = 0; prefabLineNum < prefabLines.length; prefabLineNum++) {
									if (prefabLines[prefabLineNum].includes(uuid)) {
										// Create a link with line number fragment
										const linkUri = prefabFileUri.with({ fragment: `L${prefabLineNum + 1}` });
										links.push(new vscode.DocumentLink(range, linkUri));
										foundPrefabLink = true;
										break;
									}
								}
								
								if (!foundPrefabLink) {
									// Just link to the file without line number
									links.push(new vscode.DocumentLink(range, prefabFileUri));
									foundPrefabLink = true;
								}
							} catch {
								// Failed to read prefab file, just link to it
								links.push(new vscode.DocumentLink(range, prefabFileUri));
								foundPrefabLink = true;
							}
							
							if (foundPrefabLink) {
								continue; // Skip other checks for this UUID
							}
						}
					}

					// Check meta files first (prefer global references)
					if (uuidToFileMap[uuid]) {
						const foundUri = vscode.Uri.file(uuidToFileMap[uuid]);
						links.push(new vscode.DocumentLink(range, foundUri));
					} else {
						// Check if this UUID appears multiple times in the document (only if no global reference)
						const occurrences = uuidOccurrences[uuid];
						if (occurrences && occurrences.length > 1) {
							// Find the occurrence with the lowest indentation
							const minIndentation = Math.min(...occurrences.map(o => o.indentation));
							const targetOccurrence = occurrences.find(o => o.indentation === minIndentation);
							
							const isTargetOccurrence = targetOccurrence.lineNum === lineNum && targetOccurrence.start === start;

							if (!isTargetOccurrence) {
								// This is not the target occurrence, link to the lowest indented occurrence
								const targetUri = document.uri.with({ fragment: `L${targetOccurrence.lineNum + 1}` });
								links.push(new vscode.DocumentLink(range, targetUri));
							}
						}
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
		async provideHover(document, position) {
			const range = document.getWordRangeAtPosition(position, UUID_REGEX);
			if (!range) {
				return null;
			}

			const uuid = document.getText(range);

			// Skip zero UUIDs (no hover for all-zero UUIDs)
			const isZeroUuid = /^0+$/.test(uuid);
			if (isZeroUuid) {
				return null;
			}

			const {
				uuidToFileMap,
				workspaceRoot,
				mintyDataPath
			} = await getLookupContext();

			// Check if UUID is wrapped in brackets (might be referencing entity in a prefab)
			const line = document.lineAt(position.line);
			const lineText = line.text;
			const isWrappedInBrackets = range.start.character > 0 && 
				lineText[range.start.character - 1] === '[' && 
				lineText[range.end.character] === ']';
			
			if (isWrappedInBrackets) {
				// Calculate current line's indentation
				const currentIndentMatch = lineText.match(/^(\s*)/);
				const currentIndentation = currentIndentMatch ? currentIndentMatch[1].length : 0;
				
				// Look backwards for an ancestor line with less indentation that has a prefab UUID
				let prefabUuid = null;
				for (let searchLineNum = position.line - 1; searchLineNum >= 0; searchLineNum--) {
					const searchLine = document.lineAt(searchLineNum);
					const searchText = searchLine.text;
					
					// Calculate indentation
					const searchIndentMatch = searchText.match(/^(\s*)/);
					const searchIndentation = searchIndentMatch ? searchIndentMatch[1].length : 0;
					
					// Only check lines with less indentation (ancestor lines)
					if (searchIndentation < currentIndentation) {
						// Pattern 1: something: UUID [PrefabUUID] (exact UUID match)
						const prefabPattern1 = new RegExp(`:\\s*${uuid}\\s+\\[([a-fA-F0-9]{32})\\]`);
						const prefabMatch1 = searchText.match(prefabPattern1);
						
						if (prefabMatch1) {
							prefabUuid = prefabMatch1[1];
							break;
						}
						
						// Pattern 2: [PrefabUUID] at end of line (handles "UUID [PrefabUUID]" format)
						const prefabPattern2 = /\[([a-fA-F0-9]{32})\]\s*$/;
						const prefabMatch2 = searchText.match(prefabPattern2);
						
						if (prefabMatch2) {
							const potentialPrefabUuid = prefabMatch2[1];
							
							// Check if this UUID is in our map (it's a prefab)
							if (uuidToFileMap[potentialPrefabUuid]) {
								prefabUuid = potentialPrefabUuid;
								
								// Get the prefab file path
								const prefabFilePath = uuidToFileMap[prefabUuid];
								
								try {
									// Read the prefab file
									const prefabContent = await fs.readFile(prefabFilePath, 'utf8');
									const prefabLines = prefabContent.split('\n');
									
									// Search for the UUID in the prefab file
									for (const prefabLine of prefabLines) {
										if (prefabLine.includes(uuid)) {
											// Extract label before the UUID
											const uuidIndex = prefabLine.indexOf(uuid);
											const beforeUuid = prefabLine.substring(0, uuidIndex).trim();
											let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();
											
											if (label) {
												const hoverMessage = new vscode.MarkdownString();
												hoverMessage.appendCodeblock(uuid, 'text');
												hoverMessage.appendMarkdown(`**Prefab entity:** ${label}`);
												return new vscode.Hover(hoverMessage, range);
											}
										}
									}
								} catch (e) {
									// Failed to read prefab file
									console.error(`Error reading prefab file ${prefabFilePath}:`, e);
								}
								
								break;
							}
						}
						
						// Pattern 3: something: [PrefabUUID] (ancestor has prefab reference directly after colon)
						const prefabPattern3 = /:\s*\[?([a-fA-F0-9]{32})\]?$/;
						const prefabMatch3 = searchText.match(prefabPattern3);
						
						if (prefabMatch3) {
							const potentialPrefabUuid = prefabMatch3[1];
							
							// Check if this UUID is in our map (it's a prefab)
							if (uuidToFileMap[potentialPrefabUuid]) {
								prefabUuid = potentialPrefabUuid;
								
								// Get the prefab file path
								const prefabFilePath = uuidToFileMap[prefabUuid];
								
								try {
									// Read the prefab file
									const prefabContent = await fs.readFile(prefabFilePath, 'utf8');
									const prefabLines = prefabContent.split('\n');
									
									// Search for the UUID in the prefab file
									for (const prefabLine of prefabLines) {
										if (prefabLine.includes(uuid)) {
											// Extract label before the UUID
											const uuidIndex = prefabLine.indexOf(uuid);
											const beforeUuid = prefabLine.substring(0, uuidIndex).trim();
											let label = beforeUuid.replace(/[:\-]\s*$/, '').trim();
											
											if (label) {
												const hoverMessage = new vscode.MarkdownString();
												hoverMessage.appendCodeblock(uuid, 'text');
												hoverMessage.appendMarkdown(`**Prefab entity:** ${label}`);
												return new vscode.Hover(hoverMessage, range);
											}
										}
									}
								} catch (e) {
									// Failed to read prefab file
									console.error(`Error reading prefab file ${prefabFilePath}:`, e);
								}
								
								break;
							}
						}
					}
				}
			}

			// Look up the UUID in meta files (prefer global references)
			if (uuidToFileMap[uuid]) {
				const filePath = uuidToFileMap[uuid];

				const displayPath = getDisplayPath(filePath, workspaceRoot, mintyDataPath);

				const hoverMessage = new vscode.MarkdownString();
				hoverMessage.appendCodeblock(uuid, 'text');
				hoverMessage.appendMarkdown(`**Global reference to:** ${displayPath}`);
				
				return new vscode.Hover(hoverMessage, range);
			}

			// Check for local references only if no global reference found
			const uuidOccurrences = [];
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				const uuidRegex = /\b[a-fA-F0-9]{32}\b/g;
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




