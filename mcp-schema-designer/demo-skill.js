const path = require("path");
const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

const db = new DocStore(new FileStorageAdapter(path.join(__dirname, "schema-designer-data")));
const schemas = db.collection("__schemas");

console.log("=== Schema as Skill Demo ===\n");

const schema = schemas.findOne({ name: "blog_cms" });
if (!schema) {
  console.log("Schema blog_cms no encontrado");
  process.exit(1);
}

function buildSchemaSkill(schema) {
  const collections = schema.collections || [];
  const lines = [];
  lines.push(`# Schema Skill: ${schema.name}`);
  lines.push(`${schema.description || ""}`);
  lines.push("");
  lines.push("## Architecture Overview");
  lines.push(`This schema defines ${collections.length} collection(s): ${collections.map(c => c.name).join(", ")}.`);
  lines.push("");
  const rels = [];
  for (const col of collections) {
    for (const f of (col.fields || [])) {
      if (f.type === "ref" && f.refCollection) {
        rels.push(`- ${col.name}.${f.name} -> ${f.refCollection}._id`);
      }
    }
  }
  if (rels.length > 0) {
    lines.push("### Relationships");
    lines.push(...rels);
    lines.push("");
  }
  lines.push("## Collections Detail");
  for (const col of collections) {
    lines.push(`### ${col.name}`);
    lines.push(`Fields:`);
    for (const f of (col.fields || [])) {
      const flags = [];
      if (f.required) flags.push("required");
      if (f.unique) flags.push("unique");
      if (f.index) flags.push("indexed");
      if (f.type === "ref") flags.push(`ref->${f.refCollection || "?"}`);
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      const defStr = f.default !== undefined ? ` (default: ${JSON.stringify(f.default)})` : "";
      lines.push(`  - ${f.name}: ${f.type}${flagStr}${defStr}`);
    }
    if (col.indexes && col.indexes.length > 0) {
      lines.push(`Indexes:`);
      for (const idx of col.indexes) {
        lines.push(`  - ${idx.field}${idx.unique ? " [unique]" : ""}`);
      }
    }
    lines.push("");
    const sample = {};
    for (const f of (col.fields || [])) {
      if (f.name === "_id") continue;
      if (f.type === "string") sample[f.name] = `sample-${f.name}`;
      else if (f.type === "number") sample[f.name] = 42;
      else if (f.type === "boolean") sample[f.name] = true;
      else if (f.type === "date") sample[f.name] = new Date().toISOString();
      else if (f.type === "array") sample[f.name] = [];
      else if (f.type === "object") sample[f.name] = {};
      else if (f.type === "ref") sample[f.name] = `ref-${f.refCollection || "unknown"}-id`;
    }
    lines.push("Sample document:");
    lines.push("```json");
    lines.push(JSON.stringify(sample, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Query Examples");
  for (const col of collections) {
    const q = {};
    for (const f of (col.fields || [])) {
      if (f.type === "string") q[f.name] = "value";
      else if (f.type === "boolean") q[f.name] = true;
      else if (f.type === "number") q[f.name] = { $gte: 0 };
      break;
    }
    lines.push(`### ${col.name}`);
    lines.push(`- Find all: {}`);
    if (Object.keys(q).length > 0) {
      lines.push(`- Filtered: ${JSON.stringify(q)}`);
    }
    const uniqueField = (col.fields || []).find(f => f.unique);
    if (uniqueField) {
      lines.push(`- By unique ${uniqueField.name}: { ${uniqueField.name}: "exact-value" }`);
    }
    lines.push("");
  }
  lines.push("## Usage Patterns");
  lines.push("1. Insert: use schema_insert with schemaName, collectionName, and doc.");
  lines.push("2. Query: use schema_query with filter, sort, limit, skip.");
  lines.push("3. Update: use schema_update with filter and update ($set, $unset).");
  lines.push("4. Delete: use schema_delete with filter.");
  lines.push("5. Seed: use schema_seed to generate sample data for testing.");
  lines.push("");
  return lines.join("\n");
}

const skill = buildSchemaSkill(schema);
console.log(skill);
console.log("\n=== Fin del skill context ===");
