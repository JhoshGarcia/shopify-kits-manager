require("dotenv").config();

const express = require("express");
const basicAuth = require("express-basic-auth");
const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const BUNDLES_FILE = path.join(DATA_DIR, "bundles.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

// Autenticación obligatoria para no exponer el inventario ni las herramientas administrativas.
const username = process.env.APP_USERNAME;
const password = process.env.APP_PASSWORD;
if (!username || !password || password === "cambia-esta-clave-larga") {
  console.warn("AVISO: configura APP_USERNAME y una APP_PASSWORD segura en .env antes de usarlo en un servidor público.");
}
app.use(basicAuth({
  users: { [username || "admin"]: password || "configure-password" },
  challenge: true,
  realm: "Shopify Kits Manager",
  unauthorizedResponse: "Acceso no autorizado"
}));

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
  }
}));

function config() {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const version = (process.env.SHOPIFY_API_VERSION || "2026-01").trim();
  return { domain, token, version };
}

function requireShopifyConfig() {
  const c = config();
  if (!c.domain || !c.token) {
    const err = new Error("Falta configurar SHOPIFY_STORE_DOMAIN y SHOPIFY_ADMIN_ACCESS_TOKEN en el archivo .env.");
    err.status = 400;
    throw err;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.myshopify\.com$/.test(c.domain)) {
    const err = new Error("SHOPIFY_STORE_DOMAIN debe ser el dominio myshopify.com de tu tienda, sin https://.");
    err.status = 400;
    throw err;
  }
  return c;
}

async function shopifyGraphQL(query, variables = {}) {
  const c = requireShopifyConfig();
  const endpoint = `https://${c.domain}/admin/api/${c.version}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": c.token
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.errors?.map(e => e.message).join("; ") || response.statusText;
    const err = new Error(`Shopify respondió ${response.status}: ${detail}`);
    err.status = response.status === 401 || response.status === 403 ? 502 : 502;
    throw err;
  }
  if (body.errors?.length) {
    const err = new Error(body.errors.map(e => e.message).join("; "));
    err.status = 502;
    throw err;
  }
  return body.data;
}

function storefrontUrl(product) {
  const c = config();
  if (product.onlineStoreUrl) return product.onlineStoreUrl;
  if (!c.domain || !product.handle) return "";
  const publicBase = (process.env.SHOPIFY_PUBLIC_STORE_URL || `https://${c.domain}`).replace(/\/$/, "");
  return `${publicBase}/products/${encodeURIComponent(product.handle)}`;
}

async function fetchProducts() {
  const query = `
    query Products($cursor: String) {
      products(first: 100, after: $cursor, sortKey: TITLE) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title handle status createdAt updatedAt onlineStoreUrl
          featuredImage { url altText }
          variants(first: 100) {
            nodes { id title sku price }
          }
        }
      }
    }`;
  const all = [];
  let cursor = null;
  let pageCount = 0;
  do {
    const data = await shopifyGraphQL(query, { cursor });
    const connection = data.products;
    all.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    pageCount += 1;
    if (pageCount > 100) throw new Error("Se alcanzó el límite de seguridad de paginación. Reduce el catálogo o vuelve a intentar.");
  } while (cursor);

  return all
    .filter(p => p.status === "ACTIVE" || p.status === "DRAFT")
    .map(p => ({
      id: p.id,
      numericId: p.id.split("/").pop(),
      title: p.title,
      handle: p.handle,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      adminUrl: `https://${config().domain}/admin/products/${p.id.split("/").pop()}`,
      storefrontUrl: storefrontUrl(p),
      image: p.featuredImage?.url || "",
      variants: p.variants?.nodes || []
    }));
}

function loadBundleRows() {
  if (!fs.existsSync(BUNDLES_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("data/bundles.json no contiene JSON válido. Corrige el archivo o importa nuevamente el CSV.");
  }
}

function productIndex(products) {
  const index = new Map();
  for (const p of products) {
    index.set(p.id, p);
    index.set(p.numericId, p);
    index.set(p.handle, p);
  }
  return index;
}

function buildBundles(rows, products) {
  const index = productIndex(products);
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.bundle_handle || row.bundle_title || "bundle-sin-nombre");
    if (!grouped.has(key)) grouped.set(key, {
      title: row.bundle_title || key,
      handle: row.bundle_handle || "",
      components: []
    });
    const component = index.get(String(row.component_product_id || "")) ||
      index.get(String(row.component_handle || ""));
    grouped.get(key).components.push({
      requestedId: row.component_product_id || "",
      title: component?.title || row.component_title || row.component_handle || row.component_product_id || "Producto sin identificar",
      status: component?.status || "NOT_FOUND",
      quantity: Number(row.quantity || 1),
      adminUrl: component?.adminUrl || (row.component_product_id && /^\d+$/.test(String(row.component_product_id))
        ? `https://${config().domain}/admin/products/${row.component_product_id}` : ""),
      storefrontUrl: component?.storefrontUrl || (row.component_handle ? `${(process.env.SHOPIFY_PUBLIC_STORE_URL || `https://${config().domain}`).replace(/\/$/, "")}/products/${row.component_handle}` : ""),
      productId: component?.id || row.component_product_id || ""
    });
  }
  return Array.from(grouped.values()).map(bundle => {
    const statuses = bundle.components.map(c => c.status);
    return {
      ...bundle,
      componentCount: bundle.components.length,
      bundleStatus: statuses.includes("NOT_FOUND") ? "REVISAR COMPONENTES" :
        statuses.includes("DRAFT") ? "CONTIENE BORRADORES" : "COMPONENTES ACTIVOS"
    };
  });
}

app.get("/api/health", (_req, res) => {
  const c = config();
  res.json({ ok: true, shopifyConfigured: Boolean(c.domain && c.token), storeDomain: c.domain || null });
});

app.post("/api/test-connection", async (_req, res, next) => {
  try {
    const data = await shopifyGraphQL(`query { shop { name myshopifyDomain } }`);
    res.json({ ok: true, shop: data.shop.name, domain: data.shop.myshopifyDomain });
  } catch (e) { next(e); }
});

app.get("/api/products", async (req, res, next) => {
  try {
    const products = await fetchProducts();
    const status = String(req.query.status || "ALL").toUpperCase();
    const search = String(req.query.search || "").toLowerCase().trim();
    const filtered = products.filter(p =>
      (status === "ALL" || p.status === status) &&
      (!search || p.title.toLowerCase().includes(search) || p.handle.toLowerCase().includes(search) ||
        p.variants.some(v => (v.sku || "").toLowerCase().includes(search)))
    );
    res.json({ products: filtered, total: filtered.length, fetchedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});

app.get("/api/bundles", async (_req, res, next) => {
  try {
    const products = await fetchProducts();
    const bundles = buildBundles(loadBundleRows(), products);
    res.json({ bundles, total: bundles.length, source: "manual-csv-mapping" });
  } catch (e) { next(e); }
});

app.post("/api/bundles/import", express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }), (req, res, next) => {
  try {
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) return res.status(400).json({ error: "El archivo CSV está vacío." });
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    const required = ["bundle_title", "component_product_id"];
    const headers = Object.keys(records[0] || {});
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) return res.status(400).json({ error: `Faltan columnas obligatorias: ${missing.join(", ")}. Revisa el formato de ejemplo.` });
    const clean = records.map(r => ({
      bundle_title: String(r.bundle_title || "").trim(),
      bundle_handle: String(r.bundle_handle || "").trim(),
      component_product_id: String(r.component_product_id || "").trim(),
      component_title: String(r.component_title || "").trim(),
      component_handle: String(r.component_handle || "").trim(),
      quantity: Math.max(1, Number(r.quantity || 1))
    })).filter(r => r.bundle_title && (r.component_product_id || r.component_handle));
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BUNDLES_FILE, JSON.stringify(clean, null, 2), "utf8");
    res.json({ ok: true, importedRows: clean.length, bundleCount: new Set(clean.map(r => r.bundle_handle || r.bundle_title)).size });
  } catch (e) { next(e); }
});

app.get("/api/export.xlsx", async (req, res, next) => {
  try {
    const products = await fetchProducts();
    const rows = loadBundleRows();
    const bundles = buildBundles(rows, products);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Shopify Kits Manager";
    wb.created = new Date();

    const productSheet = wb.addWorksheet("Productos");
    productSheet.columns = [
      { header: "Título", key: "title", width: 36 },
      { header: "Estatus", key: "status", width: 14 },
      { header: "Handle", key: "handle", width: 28 },
      { header: "ID Shopify", key: "id", width: 34 },
      { header: "SKU(s)", key: "skus", width: 28 },
      { header: "Variantes", key: "variants", width: 12 },
      { header: "URL Admin", key: "adminUrl", width: 55 },
      { header: "URL producto", key: "storefrontUrl", width: 55 },
      { header: "Actualizado", key: "updatedAt", width: 24 }
    ];
    for (const p of products) productSheet.addRow({
      title: p.title, status: p.status, handle: p.handle, id: p.id,
      skus: p.variants.map(v => v.sku).filter(Boolean).join(", "),
      variants: p.variants.length, adminUrl: p.adminUrl, storefrontUrl: p.storefrontUrl, updatedAt: p.updatedAt
    });

    const bundleSheet = wb.addWorksheet("Bundles");
    bundleSheet.columns = [
      { header: "Bundle / Kit", key: "title", width: 36 },
      { header: "Handle bundle", key: "handle", width: 28 },
      { header: "Componentes", key: "componentCount", width: 14 },
      { header: "Estatus componentes", key: "bundleStatus", width: 26 }
    ];
    bundles.forEach(b => bundleSheet.addRow({
      title: b.title, handle: b.handle, componentCount: b.componentCount, bundleStatus: b.bundleStatus
    }));

    const componentSheet = wb.addWorksheet("Componentes");
    componentSheet.columns = [
      { header: "Bundle / Kit", key: "bundle", width: 36 },
      { header: "Handle bundle", key: "bundleHandle", width: 28 },
      { header: "Producto componente", key: "title", width: 36 },
      { header: "Estatus producto", key: "status", width: 18 },
      { header: "Cantidad", key: "quantity", width: 12 },
      { header: "ID Shopify", key: "productId", width: 34 },
      { header: "URL Admin", key: "adminUrl", width: 55 },
      { header: "URL producto", key: "storefrontUrl", width: 55 }
    ];
    bundles.forEach(b => b.components.forEach(c => componentSheet.addRow({
      bundle: b.title, bundleHandle: b.handle, title: c.title, status: c.status,
      quantity: c.quantity, productId: c.productId, adminUrl: c.adminUrl, storefrontUrl: c.storefrontUrl
    })));

    for (const sheet of [productSheet, bundleSheet, componentSheet]) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + sheet.columns.length)}1` };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF25344A" } };
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) row.eachCell(cell => {
          if (typeof cell.value === "string" && /^https?:\/\//.test(cell.value)) {
            cell.value = { text: cell.value, hyperlink: cell.value };
            cell.font = { color: { argb: "FF0563C1" }, underline: true };
          }
        });
      });
    }

    const filename = `shopify-kits-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

app.get("/api/bundles-template.csv", (_req, res) => {
  res.type("text/csv; charset=utf-8").attachment("plantilla-bundles.csv").send(
    "bundle_title,bundle_handle,component_product_id,component_title,component_handle,quantity\r\n" +
    "Kit ejemplo,kit-ejemplo,gid://shopify/Product/123456789,Producto componente,producto-componente,1\r\n"
  );
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Error interno del servidor." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Shopify Kits Manager escuchando en puerto ${PORT}`);
});
