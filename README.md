# Projecto

Herramienta de análisis estático que permite visualizar las dependencias entre funciones y módulos dentro de un proyecto.
Actualmente, se centra en código Python, pero está diseñada para ser extensible a otros lenguajes.

# Componentes

## LSP Backend

Implementa un Language Server Protocol (LSP) personalizado hecho en `Rust` utilizando la libreria de `tower-lsp` que se comunica con editores compatibles (como VSCode). Sus responsabilidades principales son coordinar el análisis del proyecto, responder a requests del frontend o del cliente LSP, integrarse con el parser basado en `Tree-sitter` para obtener información del código, mantener un estado compartido sobre los archivos analizados y sus dependencias.

Tecnologías: `Rust`, `tower-lsp`, `serde`, `tokio`

## Tree-sitter parser

Un analizador sintáctico hecho en `Rust`, basado en `Tree-sitter`, actualmente con soporte para Python. Este módulo extrae información estructural de los archivos fuente, incluyendo definiciones de funciones y clases, llamadas a funciones dentro de cada bloque, imports y relaciones entre módulos.

La información se transforma luego en un modelo de datos que puede ser usado por el backend y el frontend para construir un grafo de dependencias.

Tecnologías: `Rust`, `tree-sitter`, `tree-sitter-python`

## Frontend

### Cliente LSP
Se comunica con el LSP backend utilizando el protocolo LSP, enviando y recibiendo mensajes (requests, notifications y responses). Es el encargado de enviar al servidor información sobre los archivos modificados, solicitar análisis de dependencias, recibir resultados procesados (por ejemplo, las relaciones entre funciones o módulos).

### Interfaz Visual
Muestra los resultados del análisis como un grafo interactivo. Permite navegar visualmente las dependencias, resaltar nodos, explorar relaciones y obtener información contextual sobre cada elemento del código.

Tecnologías: `Svelte`, `TypeScript`, `Vite`, `LanguageClient`, `Cytoscape.js`.

# Como funciona

1. El LSP backend detecta cambios en el proyecto.
2. Llama al parser Tree-sitter, que analiza los archivos y genera un modelo con:
   - Definiciones de funciones.
   - Llamadas a otras funciones.
   - Imports (sin resolver por ahora).
3. El backend agrupa esta información y la expone mediante un mensaje.
4. El frontend consume estos datos y los muestra como un grafo interactivo.


# Instrucciones de ejecucion local para programadores

## Prerequisitos

Antes de empezar, asegurate de tener instalado:

- **Rust** (con `cargo`) — [rustup.rs](https://rustup.rs)
- **Node.js** `22.x` y **npm** `10.x` — [nodejs.org](https://nodejs.org)
- **VSCode**

## Estructura inicial

Para desarrollar esta extension, sera necesario clonar dos repositorios: este y [tree-sitter-test](https://github.com/tpp-grupo-172/tree-sitter-test), y ubicarlos **dentro de la misma carpeta raiz**.

## Compilacion

Los tres componentes deben compilarse en este orden:

### 1. lsp-backend

```bash
cd lsp-backend
cargo build
```

Esto genera el binario en `lsp-backend/target/debug/lsp-backend`, que la extensión de VSCode busca al iniciarse.

### 2. dependency-graph (frontend Svelte)

```bash
cd lsp-client/dependency-graph
npm install        # solo la primera vez
npm run build
```

Esto compila el frontend Svelte con Vite y deposita los archivos estáticos en `lsp-client/dist/`. El webview de VSCode sirve esos archivos, por lo que **este paso es obligatorio antes de correr la extensión**. Si modificás el frontend, tenés que volver a correr `npm run build` para ver los cambios.

### 3. lsp-client (extension TypeScript)

```bash
cd lsp-client
npm install
npm run compile
```

## Ejecucion de la extension en VSCode

1. Abrí la carpeta `lsp-client/` en VSCode (es importante abrir **esa** carpeta, no la raíz del repo, para que el `launch.json` y `tasks.json` funcionen correctamente).
2. Presioná **F5** (o "Run and Debug" → "Run Extension"). Esto compila automáticamente el TypeScript y abre una nueva ventana de VSCode con la extensión cargada.
3. En esa nueva ventana, abrí cualquier archivo Python para activar el LSP.
4. Para visualizar el grafo de dependencias, abrí la paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`) y ejecutá **"Show Dependency Graph"**.

> **Nota:** El paso de F5 solo recompila el TypeScript de la extensión. Si modificaste el frontend Svelte (`dependency-graph/`), tenés que volver a correr `npm run build` dentro de `lsp-client/dependency-graph/` y luego reiniciar la extensión con F5.

## Desarrollo del frontend en modo standalone

El frontend Svelte puede correr de forma independiente sin una conexión LSP activa, usando datos de prueba predefinidos en `mockData.js`. Esto es útil para trabajar en la UI sin necesidad de tener el backend corriendo:

```bash
cd lsp-client/dependency-graph
npm run dev
```

Luego abrí `http://localhost:5173` en el navegador.
