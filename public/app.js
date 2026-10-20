const $ = (id) => document.getElementById(id);
let productsCache = [];
let bundlesCache = [];

function showAlert(message, kind = "error") {
  const el = $("alert");
  el.textContent = message;
  el.className = `alert ${kind}`;
}
function clearAlert() { $("alert").className = "alert hidden"; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function badge(status) {
  const cls = ["ACTIVE", "DRAFT", "NOT_FOUND"].includes(status) ? status : "other";
  const label = ({ ACTIVE: "Activo", DRAFT: "Borrador", NOT_FOUND: "No encontrado" })[status] || status || "Desconocido";
  return `<span class="status ${cls}">${escapeHtml(label)}</span>`;
}
function links(admin, storefront) {
  return `<div class="links">${admin ? `<a href="${escapeHtml(admin)}" target="_blank" rel="noopener">Admin Shopify ↗</a>` : ""}${storefront ? `<a href="${escapeHtml(storefront)}" target="_blank" rel="noopener">Ver producto ↗</a>` : ""}</div>`;
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body || `Error HTTP ${response.status}`);
  return body;
}
async function loadProducts() {
  $("productsBody").innerHTML = '<tr><td colspan="5" class="empty">Consultando Shopify…</td></tr>';
  const params = new URLSearchParams({
    status: $("statusFilter").value,
    search: $("search").value.trim()
  });
  const data = await api(`/api/products?${params}`);
  productsCache = data.products;
  $("productCount").textContent = `${data.total} producto(s) mostrados.`;
  $("updatedAt").textContent = `Actualizado: ${new Date(data.fetchedAt).toLocaleString("es-MX")}`;
  $("productsBody").innerHTML = data.products.length ? data.products.map(p => {
    const skus = [...new Set(p.variants.map(v => v.sku).filter(Boolean))].join(", ");
    return `<tr>
      <td><div class="product-cell">${p.image ? `<img class="thumb" src="${escapeHtml(p.image)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}<div><div class="product-title">${escapeHtml(p.title)}</div><div class="subtle">${escapeHtml(p.handle)}</div></div></div></td>
      <td>${badge(p.status)}</td><td>${escapeHtml(skus || "—")}</td><td>${p.variants.length}</td><td>${links(p.adminUrl, p.storefrontUrl)}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="5" class="empty">No se encontraron productos con esos filtros.</td></tr>';
  const all = await api("/api/products?status=ALL");
  $("totalProducts").textContent = all.total;
  $("activeProducts").textContent = all.products.filter(p => p.status === "ACTIVE").length;
  $("draftProducts").textContent = all.products.filter(p => p.status === "DRAFT").length;
}
async function loadBundles() {
  const data = await api("/api/bundles");
  bundlesCache = data.bundles;
  $("totalBundles").textContent = data.total;
  if (!data.bundles.length) {
    $("bundlesContainer").innerHTML = '<div class="empty">No hay bundles importados. Descarga la plantilla CSV, completa las asociaciones y vuelve a importarla.</div>';
    return;
  }
  $("bundlesContainer").innerHTML = data.bundles.map((b, i) => `
    <article class="bundle">
      <div class="bundle-head"><div><strong>${escapeHtml(b.title)}</strong><small>${escapeHtml(b.handle || "Sin handle")} · ${b.componentCount} componente(s)</small></div>${badge(b.bundleStatus === "REVISAR COMPONENTES" ? "NOT_FOUND" : b.bundleStatus === "CONTIENE BORRADORES" ? "DRAFT" : "ACTIVE")}</div>
      <div class="table-wrap"><table class="component-table"><thead><tr><th>Producto componente</th><th>Estatus</th><th>Cantidad</th><th>Enlaces</th></tr></thead><tbody>
      ${b.components.map(c => `<tr><td><div class="product-title">${escapeHtml(c.title)}</div><div class="subtle">${escapeHtml(c.productId || c.requestedId || "")}</div></td><td>${badge(c.status)}</td><td>${escapeHtml(c.quantity)}</td><td>${links(c.adminUrl, c.storefrontUrl)}</td></tr>`).join("")}
      </tbody></table></div>
    </article>`).join("");
}
async function refresh() {
  clearAlert();
  $("refreshBtn").disabled = true;
  try {
    await api("/api/health");
    await loadProducts();
    await loadBundles();
    showAlert("Datos actualizados correctamente.", "success");
  } catch (e) {
    showAlert(`${e.message} Revisa las variables del archivo .env y los permisos de Shopify Admin API.`);
    $("productsBody").innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(e.message)}</td></tr>`;
  } finally {
    $("refreshBtn").disabled = false;
  }
}
$("refreshBtn").addEventListener("click", refresh);
$("searchBtn").addEventListener("click", async () => {
  clearAlert();
  try { await loadProducts(); } catch (e) { showAlert(e.message); }
});
$("search").addEventListener("keydown", e => { if (e.key === "Enter") $("searchBtn").click(); });
$("statusFilter").addEventListener("change", () => $("searchBtn").click());
$("importForm").addEventListener("submit", async e => {
  e.preventDefault();
  clearAlert();
  const file = $("csvFile").files[0];
  if (!file) return showAlert("Selecciona un archivo CSV.");
  try {
    const text = await file.text();
    const result = await api("/api/bundles/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv; charset=utf-8" },
      body: text
    });
    showAlert(`Importación completada: ${result.importedRows} asociaciones en ${result.bundleCount} bundle(s).`, "success");
    $("csvFile").value = "";
    await loadBundles();
  } catch (err) { showAlert(err.message); }
});
refresh();
