"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { Worker } = require("node:worker_threads");

const HOST = "127.0.0.1";
const PORT = 9666;
const MAX_BODY_SIZE = 10 * 1024 * 1024;
const MAX_JK_SIZE = 256 * 1024;
const MAX_LINKS = 5000;

let latest = null;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("CNL payload exceeds 10 MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function getParameters(request, body = "") {
  const parameters = new URL(request.url, `http://${HOST}`).searchParams;
  for (const [key, value] of new URLSearchParams(body)) {
    parameters.append(key, value);
  }
  return parameters;
}

function extractLinks(text) {
  const links = [];
  const seen = new Set();
  const normalized = String(text || "")
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  for (const line of normalized.split("\n")) {
    const link = line.trim();
    if (!link || !/^[a-z][a-z0-9+.-]*:/i.test(link) || seen.has(link)) {
      continue;
    }
    seen.add(link);
    links.push(link);
    if (links.length === MAX_LINKS) break;
  }

  return links;
}

function evaluateKey(jk) {
  const source = String(jk || "").trim().replace(/;+\s*$/, "");
  if (!source || source.length > MAX_JK_SIZE) {
    return Promise.reject(new Error("Invalid CNL2 key function"));
  }

  const directKey = source.match(/return\s+['"]([0-9a-f]{32})['"]/i);
  if (directKey) return Promise.resolve(directKey[1]);

  const workerCode = `
    const { parentPort, workerData } = require("node:worker_threads");
    const vm = require("node:vm");
    try {
      const context = vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false }
      });
      const script = new vm.Script(
        "const __cnl = (" + workerData.source + "); __cnl();"
      );
      const key = script.runInContext(context, { timeout: 500 });
      parentPort.postMessage({ key: String(key) });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  `;

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { source },
      resourceLimits: {
        maxOldGenerationSizeMb: 16,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 2
      }
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("CNL2 key function timed out"));
    }, 1200);

    worker.once("message", (message) => {
      clearTimeout(timeout);
      worker.terminate();
      message.error ? reject(new Error(message.error)) : resolve(message.key);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function normalizeBase64(value) {
  let result = String(value || "")
    .trim()
    .replace(/\s/g, "+")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (result.length % 4) result += "=";
  return result;
}

async function decryptCnl2(crypted, jk) {
  const keyHex = String(await evaluateKey(jk)).trim();
  if (!/^[0-9a-f]{32}$/i.test(keyHex)) {
    throw new Error("Invalid CNL2 AES key");
  }

  const key = Buffer.from(keyHex, "hex");
  const payload = Buffer.from(normalizeBase64(crypted), "base64");
  if (!payload.length || payload.length % 16 !== 0) {
    throw new Error("Invalid CNL2 encrypted payload");
  }

  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, key);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, key);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(payload), decipher.final()])
      .toString("utf8")
      .replace(/\0+$/, "");
  }
}

function setCommonHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function setCnlHeaders(response) {
  setCommonHeaders(response);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
}

function send(
  response,
  status,
  body,
  type = "text/plain; charset=utf-8",
  clickNLoad = false
) {
  clickNLoad ? setCnlHeaders(response) : setCommonHeaders(response);
  response.writeHead(status, { "Content-Type": type });
  response.end(body);
}

function sameOriginManagementRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

function renderUi() {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Click'n'Load Catcher</title>
  <style>
    body{max-width:850px;margin:40px auto;padding:0 18px;font:16px/1.5 system-ui,sans-serif;background:#10141f;color:#eef2ff}
    h1{margin-bottom:4px}p{color:#aeb9d1}
    textarea{box-sizing:border-box;width:100%;min-height:320px;padding:14px;background:#080b12;color:#d5e0ff;border:1px solid #35415e;border-radius:9px;font:13px/1.5 ui-monospace,monospace}
    button{margin-top:12px;padding:10px 15px;border:0;border-radius:8px;background:#78a6ff;color:#081226;font-weight:700;cursor:pointer}
    .ok{color:#61d49b}
  </style>
</head>
<body>
  <h1>Click'n'Load Catcher</h1>
  <p id="status">Warte auf Click'n'Load &hellip;</p>
  <textarea id="links" readonly></textarea>
  <button id="copy">Links kopieren</button>
  <script>
    const status=document.getElementById("status");
    const links=document.getElementById("links");
    async function refresh(){
      const data=await fetch("/api/latest").then(response=>response.json());
      if(!data){
        status.textContent="Warte auf Click'n'Load …";
        links.value="";
        return;
      }
      status.innerHTML='<span class="ok">'+data.links.length+' Link(s) empfangen</span> &middot; '+data.receivedAt;
      links.value=data.links.join("\\n");
    }
    document.getElementById("copy").onclick=async()=>{
      await navigator.clipboard.writeText(links.value);
      document.getElementById("copy").textContent="Kopiert ✓";
    };
    refresh();
    setInterval(refresh,1000);
  </script>
</body>
</html>`;
}

async function handleAdd(request, response, pathname) {
  const body = request.method === "POST" ? await readBody(request) : "";
  const parameters = getParameters(request, body);
  const encrypted = pathname !== "/flash/add";
  const cleartext = encrypted
    ? await decryptCnl2(parameters.get("crypted"), parameters.get("jk"))
    : parameters.get("urls") || parameters.get("links");
  const links = extractLinks(cleartext);

  if (!links.length) {
    throw new Error("No links found in CNL payload");
  }

  latest = {
    receivedAt: new Date().toISOString(),
    protocol: encrypted ? "CNL2" : "CNL1",
    packageName: parameters.get("package") || parameters.get("packageName") || "",
    passwords: parameters.get("passwords") || parameters.get("password") || "",
    source: parameters.get("source") || "",
    links
  };

  console.log(`\n[CNL] Captured ${links.length} link(s):\n`);
  console.log(links.join("\n"));
  console.log("");
  send(response, 200, `success\r\n${links.length} link(s)\r\n`, undefined, true);
}

function createServer() {
  return http.createServer(async (request, response) => {
    const pathname =
      new URL(request.url, `http://${HOST}`).pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "OPTIONS") {
        setCnlHeaders(response);
        response.writeHead(204);
        response.end();
      } else if (pathname === "/jdcheck.js") {
        send(
          response,
          200,
          "jdownloader=true; var version='99999';\r\n",
          "application/javascript; charset=utf-8",
          true
        );
      } else if (pathname === "/jdcheckjson") {
        send(
          response,
          200,
          '{"status":true,"version":"99999"}',
          "application/json; charset=utf-8",
          true
        );
      } else if (pathname === "/crossdomain.xml") {
        send(
          response,
          200,
          '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" /></cross-domain-policy>',
          "application/xml; charset=utf-8",
          true
        );
      } else if (pathname === "/flash" && request.method === "GET") {
        send(response, 200, "JDownloader\r\n", undefined, true);
      } else if (
        ["/flash/add", "/flash/addcrypted", "/flash/addcrypted2"].includes(pathname) &&
        ["GET", "POST"].includes(request.method)
      ) {
        await handleAdd(request, response, pathname);
      } else if (pathname === "/" && request.method === "GET") {
        send(response, 200, renderUi(), "text/html; charset=utf-8");
      } else if (pathname === "/links" && request.method === "GET") {
        send(response, 200, latest ? `${latest.links.join("\n")}\n` : "No links captured yet.\n");
      } else if (pathname === "/api/latest" && request.method === "GET") {
        if (!sameOriginManagementRequest(request)) {
          send(response, 403, '{"error":"Cross-site access denied"}', "application/json");
          return;
        }
        send(response, 200, JSON.stringify(latest), "application/json; charset=utf-8");
      } else if (pathname === "/favicon.ico") {
        setCommonHeaders(response);
        response.writeHead(204);
        response.end();
      } else {
        send(response, 404, "Not found\r\n");
      }
    } catch (error) {
      console.error(`[CNL] ${error.message}`);
      send(response, 400, `error\r\n${error.message}\r\n`, undefined, true);
    }
  });
}

const server = createServer();

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`CNL Catcher listening on http://${HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
