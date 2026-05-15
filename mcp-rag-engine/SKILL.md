# js-doc-store-rag

Skill para interactuar con el MCP server de js-doc-store-rag.

## Proposito

Sistema RAG (Retrieval-Augmented Generation) que combina js-doc-store (base de datos documental estructurada) con js-vector-store (busqueda semantica por embeddings). Permite indexar documentos con metadata estructurada Y embeddings, luego buscar semanticamente con filtrado estructural, y obtener contexto formateado para prompting.

## Workflow recomendado

### Paso 1: Crear coleccion dual

Usa `rag_collection_setup` para crear una coleccion que tenga:
- Doc-store para metadata estructurada
- Vector-store para embeddings semanticos
- BM25 para keyword search

Ejemplo:
- `rag_collection_setup({ name: "knowledge_base", description: "Base de conocimiento de IA", fields: [{name:"title",type:"string",required:true},{name:"content",type:"string",required:true},{name:"source",type:"string"},{name:"tags",type:"array"},{name:"category",type:"string"},{name:"createdAt",type:"date"}], dimension: 768 })`

### Paso 2: Indexar documentos

Usa `rag_index_document` para cada documento:
- Guarda el contenido completo en doc-store
- Genera embedding via Ollama
- Indexa en vector-store y BM25

Ejemplo:
- `rag_index_document({ collection: "knowledge_base", id: "doc-1", content: "La IA revoluciona la medicina...", metadata: { title: "IA en Salud", category: "salud", tags: ["ai","medicina"] } })`

### Paso 3: Buscar con RAG

- **Busqueda estructurada + semantica**: `rag_search({ collection: "knowledge_base", query: "aplicaciones de IA en hospitales", filter: { category: "salud" }, mode: "hybrid", limit: 5 })`
- **Contexto para prompt**: `rag_context_for_prompt({ collection: "knowledge_base", query: "como la IA ayuda en diagnostico medico?", limit: 5 })`
- **Pipeline completo**: `rag_pipeline({ collection: "knowledge_base", query: "...", limit: 5 })`

## Cuando usar cada herramienta

| Herramienta | Cuando usar |
|-------------|-------------|
| rag_collection_setup | SIEMPRE primero para una coleccion nueva |
| rag_index_document | Agregar contenido al knowledge base |
| rag_search | Buscar documentos relevantes con metadata completa |
| rag_context_for_prompt | Obtener contexto formateado para un LLM prompt |
| rag_pipeline | Todo-en-uno: busca + formatea contexto |
| rag_collection_info | Ver stats de la coleccion |

## Filtrado estructurado

Puedes filtrar por cualquier campo de metadata ANTES de la busqueda semantica:

- `{ category: "salud" }`
- `{ tags: { DOLLAR_in: ["ai", "ml"] } }`
- `{ source: "articulo-1", category: "tecnologia" }`
- `{ createdAt: { DOLLAR_gte: "2024-01-01" } }`

## Modelo de embeddings

- Default: embeddinggemma:latest via Ollama localhost:11434
- Dimension: 768
- Override via OLLAMA_MODEL y OLLAMA_HOST


## Encriptacion

- Activa encriptacion global con la variable de entorno ENCRYPTION_KEY. El doc-store (documentos y metadata estructurada) se encripta con AES-256-GCM via PBKDF2. La metadata JSON del vector-store tambien se encripta; los vectores binarios permanecen sin encriptar por rendimiento.
- 
ag_collection_setup acepta encrypted: true para marcar la coleccion como sensible.

## Encriptacion

- Activa encriptacion global con la variable de entorno `ENCRYPTION_KEY`. El doc-store (documentos y metadata estructurada) se encripta con AES-256-GCM via PBKDF2. La metadata JSON del vector-store tambien se encripta; los vectores binarios permanecen sin encriptar por rendimiento.
- `rag_collection_setup` acepta `encrypted: true` para marcar la coleccion como sensible.

## Git Storage (versionado)

- Activa commits automaticos con `GIT_STORAGE=1`. Tanto el doc-store como la metadata del vector-store se commitean automaticamente en cada persistencia.
- Personaliza el mensaje con `GIT_COMMIT_MESSAGE`.
- **Auto-push**: `GIT_AUTO_PUSH=1` empuja automaticamente al remote despues de cada commit. Configura `GIT_PUSH_REMOTE` (default: origin) y `GIT_PUSH_BRANCH` (default: master).
- **Batch commits**: `GIT_BATCH_INTERVAL=300` acumula cambios y commitea cada 300 segundos. Default: 0 (inmediato).
- **Ignore binarios**: `GIT_IGNORE_BIN=1` ignora `*.bin` y `*.vec` en git. Recomendado para evitar trackear vectores binarios grandes.
- Ideal para versionar knowledge bases y desplegarlas via git clone.

## Seguridad y Auditoria (Produccion)

Configura AUTH_SECRET para activar autenticacion:
- auth_register / auth_login: Gestion de usuarios.
- audit_query: Consulta logs de auditoria.

Herramientas protegidas:
- rag_collection_setup requiere admin.
- rag_index_document requiere editor.

Todas las operaciones de escritura se registran. Consulta con audit_query.

## Limitaciones

- Requiere Ollama corriendo para generar embeddings
- Sin autenticacion en la API REST (usar reverse proxy)
