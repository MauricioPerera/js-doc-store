# js-doc-store + js-vector-store: Un Ecosistema de Datos para la Era de la IA

## Indice

1. [Vision General](#vision-general)
2. [Ventajas del Sistema](#ventajas-del-sistema)
3. [Arquitectura Tecnica](#arquitectura-tecnica)
4. [Casos de Uso y Posibilidades](#casos-de-uso-y-posibilidades)
5. [Seguridad y Cumplimiento](#seguridad-y-cumplimiento)
6. [Deployment y Portabilidad](#deployment-y-portabilidad)
7. [Integracion con IA y LLMs](#integracion-con-ia-y-llms)
8. [Flujos de Trabajo Recomendados](#flujos-de-trabajo-recomendados)
9. [Comparativa con Alternativas](#comparativa-con-alternativas)
10. [Roadmap y Futuro](#roadmap-y-futuro)

---

## Vision General

El ecosistema **js-doc-store + js-vector-store** es una plataforma de datos completa escrita en JavaScript vanilla, diseñada para funcionar en cualquier entorno: Node.js, navegador, Cloudflare Workers, Deno y Bun. No depende de servicios externos ni de infraestructura compleja, lo que lo hace ideal para desarrolladores que buscan soberania sobre sus datos sin sacrificar capacidades modernas.

El sistema se compone de dos motores principales:

- **js-doc-store**: Base de datos documental estilo MongoDB con indices, joins, agregaciones, autenticacion, encriptacion y versionado via Git.
- **js-vector-store**: Motor de busqueda semantica con embeddings, cuantizacion (int8, binary, polar), BM25, busqueda hibrida (RRF) y clustering IVF.

Ambos motores se exponen via:
- **MCP Servers**: Integracion nativa con Codex, Claude y cualquier herramienta compatible con Model Context Protocol.
- **REST APIs**: Endpoints HTTP para frontends, servicios y aplicaciones de terceros.
- **CLI**: Herramientas de linea de comandos para desarrollo local, exportacion y despliegue.

---

## Ventajas del Sistema

### 1. Cero Dependencias

El nucleo de ambos motores es un unico archivo JavaScript sin dependencias npm. Esto significa:
- Sin vulnerabilidades de supply chain
- Sin conflictos de versiones
- Sin necesidad de mantener un lockfile enorme
- Copia un archivo y funciona

### 2. Universalidad de Plataforma

Funciona identicamente en:
- **Node.js** (servidores locales, APIs, scripts)
- **Navegador** (almacenamiento local, aplicaciones offline)
- **Cloudflare Workers** (edge computing, baja latencia global)
- **Deno / Bun** (runtimes modernos)

Esta universalidad permite que una misma base de datos viva en tu laptop de desarrollo, en un Worker en el edge, y en el navegador del usuario sin cambios de codigo.

### 3. Modelo de Datos Flexible

No requiere schemas rigidos. Puedes:
- Definir colecciones dinamicamente via MCP
- Agregar campos sobre la marcha
- Crear indices cuando lo necesites
- Validar con schemas cuando quieras estructura

### 4. Busqueda Semantica + Estructurada

El sistema RAG combina lo mejor de ambos mundos:
- **Busqueda semantica**: Encuentra documentos por significado, no solo por palabras exactas
- **Busqueda por keywords**: BM25 para terminos tecnicos, codigos, nombres propios
- **Busqueda hibrida**: RRF fusiona ambos resultados para maxima precision
- **Filtrado estructurado**: Aplica filtros MongoDB antes o despues de la busqueda semantica

### 5. Embeddings Locales

Via Ollama, generas embeddings localmente sin enviar datos a la nube:
- Compatible con embeddinggemma, nomic-embed-text, etc.
- Sin costos por API call
- Privacidad total: tus documentos nunca salen de tu maquina
- Funciona offline

### 6. Cuantizacion de Vectores

Para colecciones grandes, el sistema ofrece compresion agresiva:
- **float32**: Precision maxima, 4 bytes por dimension
- **int8**: ~4x compresion con perdida minima
- **binary**: ~32x compresion, ideal para busqueda aproximada rapida
- **polar (3-bit)**: ~21x compresion con recall cercano al 90%

### 7. Encriptacion de Datos

AES-256-GCM via PBKDF2:
- Encriptacion global de toda la base de datos
- Encriptacion a nivel de campo para datos sensibles (SSN, emails, etc.)
- Salt aleatorio por instancia (no reutilizable entre deployments)
- Compatible con almacenamiento en Git publico sin riesgo

### 8. Versionado con Git

Cada cambio en los datos puede commitearse y versionarse:
- Audit trail completo de quien cambio que y cuando
- Rollback a versiones anteriores
- Replicacion via git push/pull
- Ideal para datos de configuracion, CMS, o knowledge bases

### 9. Autenticacion y Autorizacion

- JWT tokens con expiracion configurable
- RBAC (Role-Based Access Control): admin, editor, viewer
- Audit logging: quien hizo que operacion y cuando
- Proteccion por token en endpoints de escritura

### 10. Portabilidad Total

Un esquema definido via MCP puede exportarse a un JSON portable y desplegarse en cualquier lugar:
- Desarrollo local con MCP
- Exportar esquema + datos
- Desplegar en Railway, Render, VPS, o Cloudflare Workers
- El servidor de produccion auto-importa el esquema al arrancar

---

## Arquitectura Tecnica

### Capas del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    Aplicaciones / Frontends                  │
├─────────────────────────────────────────────────────────────┤
│  REST API        │  MCP Server        │  CLI               │
│  (HTTP/JSON)     │  (stdio/SSE)       │  (npx)             │
├─────────────────────────────────────────────────────────────┤
│  js-doc-store         │         js-vector-store            │
│  - DocStore           │         - VectorStore              │
│  - Collection         │         - BM25Index                │
│  - Index              │         - HybridSearch             │
│  - Auth               │         - IVFIndex                 │
│  - Table/Schema       │         - Reranker                 │
├─────────────────────────────────────────────────────────────┤
│  Storage Adapters                                            │
│  - FileStorageAdapter    (disco local)                     │
│  - MemoryStorageAdapter  (RAM)                              │
│  - CloudflareKVAdapter   (Workers KV)                       │
│  - EncryptedAdapter      (cifrado AES-256)                │
│  - GitStorageAdapter     (versionado)                      │
└─────────────────────────────────────────────────────────────┘
```

### js-doc-store: Motor Documental

- **CRUD completo**: insert, find, update, remove con cursores lazy
- **Queries estilo MongoDB**: $eq, $gt, $gte, $lt, $lte, $in, $regex, $and, $or
- **Indices**: hash, unique, sorted, compound
- **Joins**: lookup entre colecciones
- **Agregaciones**: match, group, sort, limit, skip, project, unwind
- **Validacion**: schemas con required, unique, type checking
- **Relaciones**: campos ref entre colecciones

### js-vector-store: Motor Semantico

- **Embeddings**: Integracion con Ollama para generacion local
- **Busqueda**: cosine, euclidean, dotProduct, manhattan
- **BM25**: Indice invertido con TF-IDF para busqueda lexical
- **Hybrid Search**: Reciprocal Rank Fusion (RRF) de vector + BM25
- **IVF Clustering**: K-means para busqueda aproximada en colecciones grandes
- **Cross-search**: Busqueda simultanea en multiples colecciones
- **Reranker**: Re-ordenamiento de resultados por relevancia

### Model Context Protocol (MCP)

Los MCP servers exponen herramientas que los LLMs pueden invocar:

**Schema Designer MCP**:
- `schema_define`: Define arquitecturas de datos
- `schema_instantiate`: Crea colecciones fisicas
- `schema_insert`, `schema_query`, `schema_update`, `schema_delete`: CRUD
- `schema_seed`: Genera datos de prueba
- `schema_export`, `schema_portable`: Exporta para deployment

**RAG Engine MCP**:
- `rag_collection_setup`: Crea coleccion dual (doc + vector)
- `rag_index_document`: Indexa documentos con embeddings
- `rag_search`: Busqueda con filtrado estructurado
- `rag_hybrid_search`: Busqueda hibrida vector + BM25
- `rag_context_for_prompt`: Formatea resultados para LLM

**Vector Store MCP**:
- `vector_collection_create`: Crea coleccion de vectores
- `vector_index_text`: Indexa texto con embeddings automaticos
- `vector_search`: Busqueda semantica
- `vector_bm25_search`: Busqueda por keywords
- `vector_hybrid_search`: Busqueda hibrida RRF
- `vector_cross_search`: Busqueda cross-coleccion

---

## Casos de Uso y Posibilidades

### 1. CMS / Blog Headless

Define un schema `blog_cms` con colecciones `posts`, `authors`, `categories`. El LLM puede:
- Crear posts con `schema_insert`
- Consultar posts publicados con `schema_query`
- Exportar el esquema y desplegarlo como API REST
- El frontend consume la API sin saber que hay un LLM detras

### 2. CRM / Gestion de Clientes

Schema `simple_crm` con `contacts`, `companies`, `deals`, `activities`:
- Relaciones via `ref` entre contactos y companias
- Indices en emails y telefonos para busqueda rapida
- Agregaciones para dashboards (ventas por mes, pipeline)
- Encriptacion de campo en datos sensibles

### 3. Knowledge Base / RAG para Soporte

Coleccion `kb` con documentacion tecnica:
- Indexa cada articulo con `vector_index_text`
- Busqueda hibrida: encuentra articulos por concepto o termino exacto
- Filtrado por categoria o producto
- Contexto formateado para respuestas de chatbot

### 4. E-commerce

Schema `ecom_store` con `products`, `orders`, `customers`:
- Busqueda semantica de productos: "zapatos para correr en lluvia"
- Filtros estructurados: talla, color, precio
- Carritos persistentes con `MemoryStorageAdapter` en sesion
- Recomendaciones por similitud de embeddings

### 5. Task Manager / Project Management

Schema `task_manager` con `users`, `projects`, `tasks`:
- Referencias entre tareas y proyectos
- Filtros por estado, prioridad, asignado
- Agregaciones para burndown charts
- Seed de datos para demos

### 6. Almacenamiento Encriptado en Git Publico

Con `ENCRYPTION_KEY` + `GIT_STORAGE=1`:
- Los datos se encriptan antes de guardar
- Los blobs encriptados se commitean a GitHub
- El encryption key nunca va al repo
- Replicacion via git clone en cualquier entorno

### 7. Edge Database en Cloudflare Workers

- Almacena datos en Workers KV
- Busqueda semantica en el edge (baja latencia global)
- Sin servidor propio: puro serverless
- Escalado automatico

### 8. Base de Datos Offline-First

En el navegador con `MemoryStorageAdapter` o `IndexedDB`:
- Aplicaciones que funcionan sin internet
- Sincronizacion cuando hay conexion
- Datos locales encriptados

### 9. Multi-tenant SaaS

- Prefijo de coleccion por tenant
- Aislamiento completo de datos
- Un solo Worker sirve a multiples clientes
- Auth por tenant con JWT

### 10. Pipeline de Datos para IA

- Ingesta de documentos via `rag_index_document`
- Chunking manual para textos largos
- Embeddings locales sin costo
- Retrieval para fine-tuning o few-shot prompting

---

## Seguridad y Cumplimiento

### Encriptacion

- **AES-256-GCM**: Cifrado autenticado con integridad verificable
- **PBKDF2**: Derivacion de clave con 100k iteraciones (OWASP compliant)
- **Salt aleatorio**: Cada instancia genera un salt unico de 16 bytes
- **Backward compat**: Se puede abrir bases legacy con salt fijo

### Autenticacion

- **JWT**: Tokens firmados con HMAC-SHA256
- **RBAC**: Roles (admin, editor, viewer) con permisos diferenciados
- **Sesiones**: Expiracion configurable, refresh token en roadmap
- **Password policy**: Min length, uppercase, lowercase, digit, symbol

### Audit

- **Audit logging**: Registro automatico de cada operacion (tool, args, user, timestamp)
- **Immutable**: Los logs se almacenan en coleccion separada
- **Consultable**: `audit_query` para revisiones de cumplimiento

### Seguridad de Deployment

- **Fail-closed auth**: Si `API_TOKEN` no esta configurado, solo `GET /` funciona
- **Shell injection fix**: `execFileSync` con args array en vez de string interpolation
- **Input validation**: Zod schemas en todos los endpoints MCP

---

## Deployment y Portabilidad

### Flujo: Desarrollo -> Produccion

```
1. Desarrollo local con MCP
   npx js-doc-store-headless mcp
   # LLM disena el schema, inserta datos, prueba queries

2. Exportar esquema + datos
   npx js-doc-store-headless export --schema blog_cms --output ./exports

3. Crear paquete de despliegue
   npx js-doc-store-headless deploy --schema blog_cms --output ./deploy

4. Desplegar
   cd deploy && node server.js
   # API REST auto-importa el esquema al arrancar
```

### Opciones de Hosting

- **Railway / Render**: Node.js server tradicional
- **Cloudflare Workers**: Serverless edge con KV
- **VPS / Docker**: Control total del entorno
- **Local**: Ideal para intranets o desarrollo

### Portabilidad de Datos

- **Export/Import**: JSON portable con schema + colecciones + documentos
- **Git**: Versionado y replicable
- **Encriptado**: Seguro para almacenamiento publico

---

## Integracion con IA y LLMs

### Model Context Protocol (MCP)

El sistema esta disenado para que los LLMs operen directamente sobre los datos:

- **Schema Designer**: El LLM crea arquitecturas de datos a demanda
- **RAG Engine**: El LLM indexa, busca y formatea contexto sin intervencion humana
- **Vector Store**: El LLM maneja embeddings y busqueda semantica

### Workflows con IA

**Crear una aplicacion completa**:
1. Usuario: "Necesito un CRM para mi consultoria"
2. LLM llama `schema_exists` -> no existe
3. LLM llama `schema_define` con colecciones `contacts`, `deals`, `meetings`
4. LLM llama `schema_instantiate`
5. LLM llama `schema_seed` para datos de demo
6. LLM exporta el schema
7. Usuario despliega con `npx js-doc-store-headless deploy`

**Chatbot con conocimiento privado**:
1. Indexar documentos via `rag_index_document`
2. Usuario pregunta al chatbot
3. LLM llama `rag_context_for_prompt` para recuperar contexto relevante
4. LLM responde con informacion precisa de la base de conocimiento

**Analisis de datos**:
1. LLM consulta `schema_aggregate` para obtener metricas
2. LLM genera insights y recomendaciones
3. LLM actualiza registros con `schema_update`

---

## Flujos de Trabajo Recomendados

### Desarrollo Local

```bash
# Terminal 1: MCP server
npx js-doc-store-headless mcp

# Terminal 2: API REST
npx js-doc-store-headless api --port 3000

# Codex/Claude se conecta al MCP y opera sobre los datos
```

### Produccion

```bash
# Exportar desde desarrollo
npx js-doc-store-headless export --schema my_app --output ./exports

# Crear paquete de deployment
npx js-doc-store-headless deploy --schema my_app --output ./deploy

# Desplegar
cd deploy
API_TOKEN=secret_key ENCRYPTION_KEY=super_secret node server.js
```

### Backup y Versionado

```bash
# Activar git storage
export GIT_STORAGE=1
export GIT_AUTO_PUSH=1
export GIT_COMMIT_MESSAGE="backup automatico"

# Cada persistencia genera un commit
# Cada commit se empuja al remote
```

---

## Comparativa con Alternativas

| Caracteristica | js-doc-store | MongoDB | PostgreSQL | Pinecone | Supabase |
|---|---|---|---|---|---|
| Dependencias | 0 | Necesita servidor | Necesita servidor | Cloud-only | Cloud-only |
| Costo | Gratuito | Licencia/Hosting | Gratuito/Hosting | Por uso | Por uso |
| Embeddings | Ollama local | No | Extensiones | Si, cloud | Si, cloud |
| Offline | Si | No | No | No | No |
| Edge/Workers | Si | No | No | No | Parcial |
| Git versionado | Si | No | No | No | No |
| Encriptacion | AES-256-GCM | Enterprise | TDE | Enterprise | Si |
| Cuantizacion | int8/binary/polar | No | No | No | No |
| MCP nativo | Si | No | No | No | No |

---

## Roadmap y Futuro

### En Desarrollo

- **Bulk insert**: Ingesta masiva con skip de indexing intermedio
- **Refresh tokens**: Rotacion de sesiones sin re-login
- **Compresion de blobs**: Gzip antes de KV write
- **Soft delete**: Marcado logico en vez de eliminacion fisica
- **Schema migrations**: Actualizacion automatica de estructuras

### Ideas Futuras

- **Sync real-time**: WebSocket sync entre cliente y servidor
- **Replicacion multi-master**: Conflict resolution CRDT
- **Query planner**: Seleccion automatica de indices
- **Plugin system**: Extensiones de terceros para adapters
- **GUI admin**: Panel visual para gestion de schemas y datos

---

## Conclusion

El ecosistema js-doc-store + js-vector-store representa una nueva categoria de plataforma de datos: **soberana, universal e IA-native**. No es solo una base de datos; es un sistema completo que permite a desarrolladores y modelos de lenguaje crear, gestionar y desplegar aplicaciones con datos estructurados y semanticos sin depender de infraestructura externa.

La combinacion de documentos estructurados con busqueda semantica, la portabilidad total entre plataformas, la encriptacion end-to-end y la integracion nativa con LLMs via MCP lo convierte en una herramienta poderosa para construir el siguiente generation de aplicaciones inteligentes.

---

*Documento generado el 2026-05-15. Ultima version de los repositorios: js-doc-store master, js-vector-store master.*
