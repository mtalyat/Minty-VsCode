// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

const pathRegex = /(([\w\.\-]+\/)+[\w\.\-]*)/g;
const uuidRegex = /\b[a-fA-F0-9]{16}\b/g;

function generateUUID() {
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

	const insertUUID = vscode.commands.registerCommand('minty-support.insertUUID', async function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return vscode.window.showErrorMessage('No active editor');
		}

		// Generate a 16-digit random hexadecimal string
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
		// Generate a 16-digit random hexadecimal string (uppercase)
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
				const match = content.match(/: ([a-fA-F0-9]{16})/);
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
				const match = content.match(/: ([a-fA-F0-9]{16})/);
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
					const match = content.match(/: ([a-fA-F0-9]{16})/);
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

			// Map workspace files: key = relative to workspace root (with forward slashes), value = full path
			const workspaceFolders = vscode.workspace.workspaceFolders || [];
			let workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
			for (const file of workspaceFiles) {
				let relPath = workspaceRoot && file.fsPath.startsWith(workspaceRoot)
					? path.relative(workspaceRoot, file.fsPath)
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

			console.log(`File map: ${JSON.stringify(fileMap, null, 2)}`);

			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const line = document.lineAt(lineNum);
				const lineText = line.text;

				// --- UUID links ---
				let match;
				while ((match = uuidRegex.exec(lineText)) !== null) {
					console.log('uuid')
					const uuid = match[0];
					const start = match.index;
					const end = start + uuid.length;

					const range = new vscode.Range(
						new vscode.Position(lineNum, start),
						new vscode.Position(lineNum, end)
					);

					// Search meta files for this UUID
					if (uuidToFileMap[uuid]) {
						const foundUri = vscode.Uri.file(uuidToFileMap[uuid]);

						// remove '.meta' from the file path
						const baseFileUri = foundUri.with({ path: foundUri.path.replace(/\.meta$/, '') });
						links.push(new vscode.DocumentLink(range, baseFileUri));
					}
				}

				// --- Path links ---
				while ((match = pathRegex.exec(lineText)) !== null) {
					console.log('path')
					const pathMatch = match[0];
					const start = match.index;
					const end = start + pathMatch.length;

					const range = new vscode.Range(
						new vscode.Position(lineNum, start),
						new vscode.Position(lineNum, end)
					);

					console.log(`Found path match: ${pathMatch}`);

					// Always use forward slashes for lookup
					const normalizedPath = pathMatch.replace(/\\/g, '/');

					// check if normalizedPath is within files set
					if (fileMap[normalizedPath]) {
						console.log(`Found file: ${normalizedPath}`);
						// If normalizedPath is in the files set, create a link
						const fileUri = vscode.Uri.file(fileMap[normalizedPath]);
						links.push(new vscode.DocumentLink(range, fileUri));
					} else {
						console.log(`File not found in fileMap: ${normalizedPath}`);
					}
				}
			}

			console.log(`Document link provider found ${links.length} links.`);
			return links;
		}
	});

	context.subscriptions.push(provider);
}

// This method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
