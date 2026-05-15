# js-doc-store-schema-designer

Skill para interactuar con el MCP server de js-doc-store-schema-designer.

## Proposito

Este skill te permite diseñar, gestionar y desplegar bases de datos documentales usando js-doc-store a traves de un MCP server. Puedes crear esquemas (CMS, CRM, e-commerce), insertar datos, consultar, actualizar, exportar y desplegar a produccion.

## Flujo de trabajo recomendado

### Paso 1: Verificar si el esquema ya existe

SIEMPRE llama `schema_exists` primero cuando el usuario menciona un dominio como blog, CRM, tienda, tareas, etc.

Ejemplo: El usuario dice "quiero un blog".
- Tu accion: `schema_exists({ name: "blog_cms" })`
- Si devuelve `exists: true`, usa el `skillContext` para entender la arquitectura y operar sobre ella.
- Si devuelve `exists: false`, procede a `schema_define`.

### Paso 2: Definir el esquema (solo si no existe)

Usa `schema_define` con colecciones bien disenadas. Incluye campos como:
- `createdAt` (date) y `updatedAt` (date) para tracking
- `status` (string) con default para workflow
- `slug` (string, unique) para URLs amigables
- `ref` fields para relaciones entre colecciones

### Paso 3: Instanciar

INMEDIATAMENTE despues de `schema_define`, llama `schema_instantiate`. Sin esto, las colecciones no existen fisicamente y los inserts fallaran.

### Paso 4: Operar datos

- Insertar: `schema_insert`
- Consultar: `schema_query` con filtros MongoDB
- Actualizar: `schema_update` con `{ $set: ... }`
- Eliminar: `schema_delete` (confirmar con usuario si afecta >1 doc)
- Sembrar datos de prueba: `schema_seed`

### Paso 5: Exportar y desplegar

Cuando el contenido esta listo:
- `schema_export` genera un archivo JSON portable
- Ese archivo se puede desplegar con `schema-api-prod.js` que auto-importa al arrancar

## Consejos de diseno de esquemas

- Nombres de esquema: lowercase con underscores, e.g. `blog_cms`, `simple_crm`
- Nombres de coleccion: singular, e.g. `post`, `author`, `category`
- Usa `ref` para relaciones: `authorId` apunta a `authors._id`
- Agrega `index: true` en campos que consultaras frecuentemente
- Usa `unique: true` en emails, slugs, SKUs
- Agrega defaults sensibles: `status: "draft"`, `published: false`

## Consejos de consulta

- `{}` devuelve todos los documentos
- `{ status: "published" }` filtro exacto
- `{ priority: { $gte: 5 } }` comparacion numerica
- `{ title: { $regex: "hello" } }` busqueda de texto
- `{ $and: [ { status: "active" }, { priority: { $gte: 5 } } ] }` condiciones multiples
- Sort: `{ createdAt: -1 }` para mas recientes primero
- Paginacion: `limit: 10, skip: 0` (pagina 1); `limit: 10, skip: 10` (pagina 2)

## Consejos de actualizacion

- `{ $set: { status: "done" } }` cambia un campo
- `{ $inc: { views: 1 } }` incrementa
- `{ $unset: { tempField: 1 } }` elimina un campo
- `{ $push: { tags: "new-tag" } }` agrega a array

## Seguridad

- No uses `schema_delete` con filtros amplios sin confirmar con el usuario
- Siempre verifica `schema_exists` antes de asumir que un esquema existe
- Si un insert falla por validacion, lee el `skillContext` del esquema para ver campos requeridos

## Herramientas disponibles

| Herramienta | Cuando usar |
|-------------|-------------|
| schema_exists | SIEMPRE primero. Verifica existencia y obtiene contexto |
| schema_define | Crear nuevo esquema |
| schema_instantiate | Materializar colecciones tras definir |
| schema_insert | Agregar documentos |
| schema_query | Buscar, listar, filtrar |
| schema_update | Modificar documentos |
| schema_delete | Eliminar documentos |
| schema_seed | Generar datos de prueba |
| schema_list | Listar todos los esquemas |
| schema_export | Exportar a JSON portable |
| schema_usage_guide | Obtener guia completa de uso |
