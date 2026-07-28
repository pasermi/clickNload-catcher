# Click'n'Load Catcher for Windows

This minimal distribution is designed exclusively for **Windows x64** and
**Node.js 26.5.0**.

## What does `clickNload.exe` do?

The executable starts a small local HTTP server at:

```text
http://127.0.0.1:9666
```

When a website provides a Click'n'Load button, it first checks whether a
compatible receiver is listening on port 9666. The website then sends its link
package to the executable.

Click'n'Load Catcher:

- supports Click'n'Load 1 and Click'n'Load 2;
- decrypts CNL2 packages locally using AES-128-CBC;
- displays captured links in the console window;
- provides a local web interface at <http://127.0.0.1:9666>;
- provides a plain-text view at <http://127.0.0.1:9666/links>;
- does not store captured links or passwords on disk.

Only the most recently received package is kept in memory. All captured data is
discarded when the executable is stopped.

Keep the console window open while using Click'n'Load. Press `Ctrl+C` to stop
the application.

The server binds exclusively to `127.0.0.1`. It is not designed to be exposed
through a LAN address, port forwarding, a reverse proxy, or the public
internet.

## How was the JavaScript application turned into an EXE?

The executable was created using the **Single Executable Application (SEA)**
feature built into Node.js 26.5.0.

The JavaScript source is not compiled completely into native machine code as it
would be with languages such as C or Rust. Instead, Node.js:

1. reads `sea-config.json`;
2. loads `cnl-catcher.js` as the CommonJS entry point;
3. prepares the application as an SEA payload;
4. embeds that payload into a copy of the Windows Node.js runtime;
5. writes the result as `clickNload.exe`.

This is why the executable is much larger than the JavaScript source file: it
contains the Node.js runtime. A separate Node.js installation is therefore not
required on the Windows computer that runs the finished executable.

`useSnapshot` and `useCodeCache` are deliberately disabled. In addition,
`execArgvExtension: "none"` prevents environment variables such as
`NODE_OPTIONS` from changing the embedded runtime configuration.

## Rebuilding the executable

The build requires exactly:

```text
Node.js 26.5.0
npm 11.17.0
```

Verify the installed versions:

```powershell
node --version
npm --version
```

Expected output:

```text
v26.5.0
11.17.0
```

Check the JavaScript syntax and rebuild the executable:

```powershell
npm run check
npm run build
```

The build overwrites `clickNload.exe` in the current directory.

No npm packages are installed. The application uses only built-in Node.js
modules. Therefore, this minimal distribution intentionally contains:

- no `node_modules` directory;
- no `package-lock.json`;
- no external packaging tools such as `pkg` or `postject`.

## Included files

```text
README.md          Project documentation
cnl-catcher.js     Complete application source code
clickNload.exe     Ready-to-run Windows x64 executable
package.json       Project metadata and npm commands
sea-config.json    Node.js SEA build configuration
```

No additional files are required for this minimal Windows distribution.

This tool was coded with AI.
# clickNload-catcher
