import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		const extension = vscode.extensions.getExtension(
			"OrangeX4.latex-sympy-calculator",
		);
		assert.ok(extension, "Extension should be installed");
	});

	test("Extension should activate", async function () {
		// Increase timeout for extension activation (Python server startup)
		this.timeout(15000);

		const extension = vscode.extensions.getExtension(
			"OrangeX4.latex-sympy-calculator",
		);
		assert.ok(extension);
		await extension.activate();

		// Wait a bit for server to fully start
		await new Promise((resolve) => setTimeout(resolve, 3000));

		assert.strictEqual(extension.isActive, true, "Extension should be active");
	});

	test("All commands should be registered", async function () {
		// Increase timeout for command registration check
		this.timeout(10000);

		const commands = await vscode.commands.getCommands(true);

		const expectedCommands = [
			"latex-sympy-calculator.equal",
			"latex-sympy-calculator.replace",
			"latex-sympy-calculator.factor",
			"latex-sympy-calculator.expand",
			"latex-sympy-calculator.define",
			"latex-sympy-calculator.numerical",
			"latex-sympy-calculator.python",
			"latex-sympy-calculator.variances",
			"latex-sympy-calculator.reset",
			"latex-sympy-calculator.toggle-complex-number",
			"latex-sympy-calculator.matrix-raw-echelon-form",
		];

		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
		}
	});
});
