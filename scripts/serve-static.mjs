import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8080);

const MIME_BY_EXT = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

function safe_pathname(raw_url = "/") {
  const pathname = raw_url.split("?")[0].split("#")[0] || "/";
  const decoded = decodeURIComponent(pathname);
  const normalized = decoded === "/" ? "/vibishowdown/index.html" : decoded;
  const resolved = path.resolve(root, `.${normalized}`);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    return null;
  }
  return resolved;
}

const server = createServer(async (req, res) => {
  try {
    const candidate = safe_pathname(req.url || "/");
    if (!candidate) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    let file_path = candidate;
    const candidate_stat = await stat(candidate).catch(() => null);
    if (candidate_stat?.isDirectory()) {
      file_path = path.join(candidate, "index.html");
    }

    const ext = path.extname(file_path).toLowerCase();
    if (ext === ".ts") {
      const source = await readFile(file_path, "utf8");
      const output = ts.transpileModule(source, {
        fileName: file_path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          sourceMap: false,
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
        }
      }).outputText;
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/javascript; charset=utf-8"
      });
      res.end(output);
      return;
    }

    const data = await readFile(file_path);
    const content_type = MIME_BY_EXT[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": content_type
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[dev] serving ${root} on http://127.0.0.1:${port}`);
});
