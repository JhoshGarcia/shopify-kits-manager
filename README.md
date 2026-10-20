# Shopify Kits Manager

Dashboard privado para consultar productos `ACTIVE` y `DRAFT` de Shopify Admin API, revisar kits/bundles y exportar un Excel `.xlsx` con tres hojas: `Productos`, `Bundles` y `Componentes`.

## Importante sobre los bundles

Shopify no expone una única relación universal que permita descubrir automáticamente las asociaciones creadas por todas las apps de bundles de terceros. Esta aplicación importa la relación desde un CSV. Si tu app de bundles dispone de exportación CSV, adapta sus columnas al formato de la plantilla. Los estatus de componentes se contrastan con los productos actuales de Shopify; si un componente no se encuentra, se marca `NOT_FOUND`.

## Requisitos

- Node.js 20 o posterior
- Una tienda Shopify
- Una app personalizada de Shopify con acceso de lectura a productos (`read_products`)
- Un servidor que permita ejecutar Node.js (por ejemplo, VPS, Render, Railway u otro hosting Node). No sirve un hosting estático únicamente.

## Instalación

1. Sube la carpeta completa `shopify-kits-manager` al servidor.
2. En esa carpeta, copia `.env.example` como `.env`.
3. Edita `.env` con tu dominio `mitienda.myshopify.com`, el token Admin API y una contraseña fuerte.
4. Instala dependencias con `npm install`.
5. Inicia con `npm start`.
6. Abre el dominio/puerto configurado. El navegador pedirá usuario y contraseña de `APP_USERNAME` y `APP_PASSWORD`.
7. Pulsa **Actualizar datos** para validar la conexión y consultar los productos.
8. Pulsa **Exportar Excel** para descargar el archivo.

## Variables de entorno

- `SHOPIFY_STORE_DOMAIN`: dominio `.myshopify.com`, sin protocolo.
- `SHOPIFY_ADMIN_ACCESS_TOKEN`: token secreto de Admin API. Nunca lo pongas en el frontend ni lo subas a Git.
- `SHOPIFY_API_VERSION`: versión GraphQL Admin API habilitada por Shopify.
- `APP_USERNAME`, `APP_PASSWORD`: credenciales para proteger el dashboard.
- `PORT`: puerto del proceso.
- `SHOPIFY_PUBLIC_STORE_URL`: dominio público de la tienda; si se omite se usa el dominio `myshopify.com`.

## Permisos Shopify

En Shopify Admin, crea una app personalizada o usa una app con permisos de Admin API que incluya `read_products`. Instálala y copia el token Admin API en `.env`. No compartas ese token por correo ni lo introduzcas en el navegador.

Si Shopify responde con error de permisos, revisa los scopes de la app y vuelve a instalar/actualizar la app según el flujo de Shopify.

## CSV de bundles

Descarga `Plantilla CSV` desde el dashboard o visita `/api/bundles-template.csv`. Encabezados admitidos:

- `bundle_title` (obligatorio)
- `bundle_handle` (opcional; agrupa las filas del mismo kit)
- `component_product_id` (ID Shopify, numérico o `gid://shopify/Product/...`)
- `component_title` (opcional)
- `component_handle` (opcional; alternativa al ID)
- `quantity` (opcional; por defecto 1)

Cada fila representa un producto componente dentro de un bundle. Se pueden repetir `bundle_handle` para agregar varios componentes al mismo kit.

## Exportación Excel

`/api/export.xlsx` genera un `.xlsx` con:
- **Productos**: productos activos y en borrador, IDs, SKU, variantes, estado y enlaces.
- **Bundles**: listado y estado agregado de los componentes.
- **Componentes**: detalle por bundle, estado individual, cantidad y enlaces.

## Seguridad y producción

- Usa HTTPS en producción.
- Configura una contraseña larga y única.
- Mantén `.env` fuera del repositorio y de copias públicas.
- Añade un proxy inverso (Nginx/Caddy) o la protección equivalente de tu proveedor.
- El dashboard usa autenticación HTTP Basic; utiliza HTTPS para que las credenciales viajen cifradas.
- No expongas el puerto de Node directamente a internet sin HTTPS/protección apropiada.
- Verifica la versión API soportada por tu tienda y actualiza `SHOPIFY_API_VERSION` si hace falta.

## Solución de problemas

- **No conecta**: comprueba dominio, token, versión API y permiso `read_products`.
- **No aparecen borradores**: verifica que la app tiene acceso a productos y que el producto realmente está en estado Draft.
- **Bundles vacíos**: importa el CSV de asociaciones. No se descubren automáticamente todas las relaciones de apps de terceros.
- **No se encuentra un componente**: usa el ID de producto correcto o su handle exacto.
