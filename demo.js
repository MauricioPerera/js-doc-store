const path = require("path");
const { DocStore, MemoryStorageAdapter, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

console.log("=== js-doc-store Demo ===\n");

const db = new DocStore(new MemoryStorageAdapter());
const users = db.collection("users");

users.createIndex("email", { unique: true });

console.log("Insertando usuarios...");
const alice = users.insert({ name: "Alice", email: "alice@test.com", age: 30, city: "Madrid" });
const bob   = users.insert({ name: "Bob",   email: "bob@test.com",   age: 25, city: "Barcelona" });
const carol = users.insert({ name: "Carol", email: "carol@test.com", age: 35, city: "Madrid" });
console.log("Alice _id:", alice._id);
console.log("Bob _id:  ", bob._id);
console.log("Carol _id:", carol._id);

console.log("\nTodos los usuarios:");
console.log(users.find({}).toArray());

console.log("\nUsuarios de Madrid mayores de 25:");
console.log(users.find({ city: "Madrid", age: { $gte: 25 } }).toArray());

console.log("\nBuscar por email alice@test.com:");
console.log(users.findOne({ email: "alice@test.com" }));

console.log("\nActualizar edad de Alice a 31...");
users.update({ email: "alice@test.com" }, { $set: { age: 31 } });
console.log(users.findOne({ email: "alice@test.com" }));

console.log("\nTotal usuarios:", users.count());
console.log("Usuarios de Madrid:", users.count({ city: "Madrid" }));

console.log("\nUsuarios ordenados por edad descendente:");
console.log(users.find({}).sort({ age: -1 }).toArray());

console.log("\nEliminar Bob...");
users.remove({ email: "bob@test.com" });
console.log("Total tras eliminar:", users.count());

console.log("\n--- Persistencia a disco ---");
const fileDb = new DocStore(new FileStorageAdapter("./demo-data.json"));
const products = fileDb.collection("products");
products.insert({ name: "Laptop", price: 999, stock: 5 });
products.insert({ name: "Mouse",  price: 25,  stock: 50 });
fileDb.flush();
console.log("Persistido a demo-data.json");
console.log("Productos guardados:", products.find({}).toArray());

console.log("\n=== Demo completada ===");
