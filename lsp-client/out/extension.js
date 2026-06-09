"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const node_1 = require("vscode-languageclient/node");
const TELEMETRY_ENDPOINT = "https://script.google.com/macros/s/AKfycbyxqakHA76y-eHSm-Ea4EzdL__CfZ5lqfZFNByQgdiCgg6OADmC1kHH0lLhdSB-I8Oc/exec";
let client;
let files;
let connections = [];
let activePanel;
function resolveBinaryPath(context) {
    const isDevelopment = context.extensionMode === vscode.ExtensionMode.Development;
    const platform = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === "win32" ? "lsp-backend.exe" : "lsp-backend";
    const bundledPath = context.asAbsolutePath(path.join("bin", platform, binaryName));
    if (fs.existsSync(bundledPath)) {
        return bundledPath;
    }
    if (isDevelopment) {
        return context.asAbsolutePath(path.join("..", "lsp-backend", "target", "debug", "lsp-backend"));
    }
    throw new Error(`No se encontró el binario del servidor para la plataforma ${platform}. Reinstalá la extensión.`);
}
async function sendTelemetry(metrics) {
    if (!vscode.env.isTelemetryEnabled) {
        return;
    }
    if (TELEMETRY_ENDPOINT.includes("PLACEHOLDER")) {
        return;
    }
    try {
        await fetch(TELEMETRY_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metrics),
        });
    }
    catch {
        // Telemetry is best-effort; never surface errors to the user
    }
}
function showTelemetryNotice(context) {
    if (context.globalState.get("telemetryNoticeShown")) {
        return;
    }
    context.globalState.update("telemetryNoticeShown", true);
    if (!vscode.env.isTelemetryEnabled) {
        return;
    }
    vscode.window.showInformationMessage("Dependency Graph recolecta datos anónimos de uso (cantidad de archivos y funciones analizadas) para mejorar la extensión. Podés desactivarlo en Ajustes → Telemetry.", "Entendido");
}
function activate(context) {
    let serverPath;
    try {
        serverPath = resolveBinaryPath(context);
    }
    catch (e) {
        vscode.window.showErrorMessage(e.message);
        return;
    }
    const isDevelopment = context.extensionMode === vscode.ExtensionMode.Development;
    const serverOptions = {
        run: { command: serverPath, transport: node_1.TransportKind.stdio },
        debug: { command: serverPath, transport: node_1.TransportKind.stdio }
    };
    const outputChannel = vscode.window.createOutputChannel("Dependency Graph Logs");
    const clientOptions = {
        documentSelector: [
            { scheme: "file", language: "plaintext" },
            { scheme: "file", language: "python" },
            { scheme: "file", language: "javascript" },
            { scheme: "file", language: "typescript" },
            { scheme: "file", language: "typescriptreact" },
            { scheme: "file", language: "javascriptreact" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.*")
        },
        outputChannel,
        traceOutputChannel: vscode.window.createOutputChannel("Dependency Graph Trace")
    };
    client = new node_1.LanguageClient("dependencyGraph", "Dependency Graph", serverOptions, clientOptions);
    client.start().then(() => {
        client.onNotification("lsp-server/processedJson", (data) => {
            files = data.files;
            connections = data.connections ?? [];
            outputChannel.appendLine(`[processedJson] files=${files?.length ?? 0} connections=${connections.length}`);
            sendTelemetry({
                event: "analysis_complete",
                fileCount: files?.length ?? 0,
                totalFunctions: (files ?? []).reduce((acc, f) => acc + (f.functions?.length ?? 0), 0),
                totalClasses: (files ?? []).reduce((acc, f) => acc + (f.classes?.length ?? 0), 0),
                totalConnections: connections.length,
                extensionVersion: context.extension.packageJSON.version,
            });
            if (activePanel) {
                activePanel.webview.postMessage({
                    command: "lsp-server/processedJson",
                    files: files,
                    connections,
                });
            }
        });
    });
    client.onNotification("lsp-server/showFilesToChange", (data) => {
        if (isDevelopment) {
            console.log("Recibido del LSP:", data);
        }
        vscode.window.showInformationMessage("Una función fue modificada. Revisá los archivos que la usan.", "Abrir archivos").then(selection => {
            if (selection === "Abrir archivos") {
                data.files.forEach((file) => {
                    vscode.workspace.openTextDocument(file.path)
                        .then(doc => vscode.window.showTextDocument(doc, { preview: false }))
                        .then(editor => {
                        const position = new vscode.Position(file.line - 1, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                    });
                });
            }
        });
    });
    showTelemetryNotice(context);
    const disposable = vscode.commands.registerCommand("dependencyGraph.showGraph", async () => {
        const panel = vscode.window.createWebviewPanel("dependencyGraph", "Dependency Graph", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        });
        activePanel = panel;
        panel.onDidDispose(() => { activePanel = undefined; });
        const htmlPath = vscode.Uri.joinPath(context.extensionUri, "dist", "index.html");
        const htmlFile = await vscode.workspace.fs.readFile(htmlPath);
        let html = htmlFile.toString();
        const baseUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist"));
        const nonce = crypto.randomBytes(16).toString("base64url");
        html = html.replace(/(href|src)="\/assets\//g, `$1="${baseUri.toString()}/assets/`);
        html = html.replace(/ crossorigin/g, "");
        html = html.replace(/<script/g, `<script nonce="${nonce}"`);
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; style-src 'unsafe-inline' ${panel.webview.cspSource}; font-src ${panel.webview.cspSource}; img-src ${panel.webview.cspSource} data:; connect-src ${panel.webview.cspSource} https:;">`;
        html = html.replace("<head>", `<head>\n    ${csp}`);
        panel.webview.html = html;
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === "requestData") {
                if (files) {
                    panel.webview.postMessage({
                        command: "lsp-server/processedJson",
                        files: files,
                        connections,
                    });
                }
            }
            if (message.command === "rename-function") {
                try {
                    const result = await client.sendRequest("lsp-server/renameFunction", {
                        file_path: message.filePath,
                        old_name: message.oldName,
                        new_name: message.newName,
                        line: message.line ?? null,
                        class_name: message.className ?? null,
                    });
                    panel.webview.postMessage({
                        command: "rename-function-result",
                        ...result
                    });
                }
                catch (e) {
                    panel.webview.postMessage({
                        command: "rename-function-result",
                        success: false,
                        error: e?.message ?? "Error desconocido"
                    });
                }
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
