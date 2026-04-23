import { type ChildProcess, exec, spawn } from "child_process";
import * as os from "os";
import { promisify } from "util";
import * as vscode from "vscode";

const execAsync = promisify(exec);

interface CalcResponse {
	data: string;
	error: string;
}

interface CalcRequest {
	data: string;
}

const PORT = 7395;
const HOST = "127.0.0.1";

class PythonServer {
	private process: ChildProcess | null = null;
	private outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
	}

	async start(context: vscode.ExtensionContext): Promise<void> {
		const pythonPath = this.getPythonPath();
		const serverPath = context.asAbsolutePath("server.py");

		this.outputChannel.appendLine(`Starting Python server at ${serverPath}`);
		this.outputChannel.appendLine(`Using Python: ${pythonPath}`);

		// Don't auto-update during testing/activation - it's too slow
		// Users can manually update or it will happen on next restart
		const shouldAutoUpdate =
			process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET !== "true";

		if (shouldAutoUpdate) {
			try {
				this.outputChannel.appendLine(
					"Checking for latex2sympy2_extended updates...",
				);
				const { stdout, stderr } = await execAsync(
					`${pythonPath} -m pip install --upgrade latex2sympy2_extended[antlr4_13_2]`,
				);
				if (stdout) this.outputChannel.appendLine(stdout);
				if (stderr) this.outputChannel.appendLine(stderr);
			} catch (err) {
				this.outputChannel.appendLine(`Update check failed: ${err}`);
			}
		}

		// Spawn Python server process
		this.process = spawn(pythonPath, [serverPath]);

		this.process.on("error", (err) => {
			const message =
				`Failed to start Python server: ${err.message}\n` +
				`Make sure Python and latex2sympy2_extended are installed.\n` +
				`Run: pip install latex2sympy2_extended[antlr4_13_2]`;
			this.outputChannel.appendLine(`ERROR: ${message}`);
			vscode.window.showErrorMessage(message);
		});

		this.process.on("exit", (code) => {
			const message =
				`Python server exited with code ${code}.\n` +
				`Make sure you have latex2sympy2_extended >= 1.0.0 installed.\n` +
				`Install: pip install latex2sympy2_extended[antlr4_13_2]`;
			this.outputChannel.appendLine(`ERROR: ${message}`);
			vscode.window.showErrorMessage(message);
		});

		this.process.stdout?.on("data", (data) => {
			this.outputChannel.appendLine(`[Python] ${data}`);
		});

		this.process.stderr?.on("data", (data) => {
			this.outputChannel.appendLine(`[Python Error] ${data}`);
		});

		// Wait for server to be ready (but don't block activation)
		this.waitForServer()
			.then(() => {
				this.outputChannel.appendLine("Python server started successfully");
			})
			.catch((err) => {
				this.outputChannel.appendLine(
					`Warning: Server may not be ready: ${err.message}`,
				);
			});
	}

	private async waitForServer(maxAttempts: number = 20): Promise<void> {
		for (let i = 0; i < maxAttempts; i++) {
			try {
				const response = await fetch(`http://${HOST}:${PORT}/`);
				if (response.ok) {
					return;
				}
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		throw new Error("Python server failed to start within 10 seconds");
	}

	private getPythonPath(): string {
		const platform = os.platform();
		const config = vscode.workspace.getConfiguration("latex-sympy-calculator");

		switch (platform) {
			case "darwin":
				return config.get<string>("mac") || "python3";
			case "linux":
				return config.get<string>("linux") || "python3";
			case "win32":
				return config.get<string>("windows") || "python";
			default:
				throw new Error(`Unknown operating system: ${platform}`);
		}
	}

	stop(): void {
		if (this.process) {
			this.process.kill();
			this.outputChannel.appendLine("Python server stopped");
		}
	}
}

async function post(data: string, path: string): Promise<string> {
	const payload: CalcRequest = { data };

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

	try {
		const response = await fetch(`http://${HOST}:${PORT}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result = (await response.json()) as CalcResponse;

		if (result.error) {
			throw new Error(result.error);
		}

		return result.data;
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new Error(
					"Request timed out. The calculation may be too complex.",
				);
			}
			throw error;
		}
		throw new Error("Unknown error occurred");
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get(path: string): Promise<any> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000);

	try {
		const response = await fetch(`http://${HOST}:${PORT}${path}`, {
			method: "GET",
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		return await response.json();
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Request timed out");
		}
		throw error;
	}
}

function createOutputChannel(): vscode.OutputChannel {
	return vscode.window.createOutputChannel("Latex Sympy Calculator");
}

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = createOutputChannel();
	const server = new PythonServer(outputChannel);

	// Start server
	server.start(context).catch((err) => {
		vscode.window.showErrorMessage(`Failed to start server: ${err.message}`);
	});

	// Helper function to get selected text
	function getSelectedText(): {
		editor: vscode.TextEditor;
		selection: vscode.Selection;
		text: string;
	} | null {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage("No active editor");
			return null;
		}

		const selection = editor.selection;
		const text = editor.document.getText(selection).trim();

		if (!text) {
			vscode.window.showWarningMessage(
				"Please select a LaTeX expression first",
			);
			return null;
		}

		return { editor, selection, text };
	}

	// Helper function to handle errors
	function handleError(operation: string, error: Error): void {
		const message = `${operation} failed: ${error.message}`;
		outputChannel.appendLine(`[ERROR] ${message}`);
		vscode.window.showErrorMessage(message);
	}

	// Equal command: append result
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.equal",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/latex");
					await selected.editor.edit((edit) => {
						edit.insert(selected.selection.end, ` = ${result}`);
					});
				} catch (error) {
					handleError("Calculate", error as Error);
				}
			},
		),
	);

	// Matrix raw echelon form command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.matrix-raw-echelon-form",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/matrix-raw-echelon-form");
					await selected.editor.edit((edit) => {
						edit.insert(selected.selection.end, ` \\to ${result}`);
					});
				} catch (error) {
					handleError("Matrix transformation", error as Error);
				}
			},
		),
	);

	// Numerical command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.numerical",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/numerical");
					await selected.editor.edit((edit) => {
						edit.replace(selected.selection, result);
					});
				} catch (error) {
					handleError("Numerical calculation", error as Error);
				}
			},
		),
	);

	// Factor command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.factor",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/factor");
					await selected.editor.edit((edit) => {
						edit.replace(selected.selection, result);
					});
				} catch (error) {
					handleError("Factorization", error as Error);
				}
			},
		),
	);

	// Expand command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.expand",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/expand");
					await selected.editor.edit((edit) => {
						edit.replace(selected.selection, result);
					});
				} catch (error) {
					handleError("Expansion", error as Error);
				}
			},
		),
	);

	// Replace command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.replace",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/latex");
					await selected.editor.edit((edit) => {
						edit.replace(selected.selection, result);
					});
				} catch (error) {
					handleError("Replace", error as Error);
				}
			},
		),
	);

	// Define command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.define",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					await post(selected.text, "/latex");
					vscode.window.showInformationMessage(`Defined: ${selected.text}`);
				} catch (error) {
					handleError("Define variable", error as Error);
				}
			},
		),
	);

	// Show variances command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.variances",
			async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) return;

				try {
					const data = await get("/variances");
					const result =
						"\n" +
						Object.keys(data)
							.map((key) => `${key} = ${data[key]}`)
							.join("\n");

					await editor.edit((edit) => {
						edit.insert(editor.selection.end, result);
					});
				} catch (error) {
					handleError("Get variables", error as Error);
				}
			},
		),
	);

	// Reset command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.reset",
			async () => {
				try {
					await get("/reset");
					vscode.window.showInformationMessage(
						"Successfully reset all variables",
					);
				} catch (error) {
					handleError("Reset variables", error as Error);
				}
			},
		),
	);

	// Toggle complex number support
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.toggle-complex-number",
			async () => {
				try {
					const data = await get("/complex");
					const status = data.value ? "On" : "Off";
					vscode.window.showInformationMessage(
						`Complex number support: ${status}`,
					);
				} catch (error) {
					handleError("Toggle complex numbers", error as Error);
				}
			},
		),
	);

	// Python command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"latex-sympy-calculator.python",
			async () => {
				const selected = getSelectedText();
				if (!selected) return;

				try {
					const result = await post(selected.text, "/python");
					await selected.editor.edit((edit) => {
						edit.insert(selected.selection.end, ` = ${result}`);
					});
				} catch (error) {
					handleError("Python execution", error as Error);
				}
			},
		),
	);

	// Cleanup on deactivation
	context.subscriptions.push({
		dispose: () => {
			server.stop();
			outputChannel.dispose();
		},
	});
}

export function deactivate(): void {
	// Cleanup handled by subscriptions
}
