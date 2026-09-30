# Modèle de données de Trame

Un schéma est un objet JSON (toujours sérialisable, sans fonctions) :

```js
{
  id: "s_ab12",
  name: "Boutique",
  dialect: "postgres",              // "postgres" | "mysql" | "sqlite"
  tables: [{
    id: "t_users",
    name: "users",                  // snake_case, nom SQL
    color: "#7c9cff",               // couleur d'en-tête (cosmétique)
    comment: "",
    x: 80, y: 60,                   // position sur le canevas
    columns: [{
      id: "c_id",
      name: "id",
      type: "uuid",                 // voir TYPES ci-dessous
      pk: true,
      nullable: false,
      unique: false,
      autoIncrement: false,
      default: "",                  // expression SQL brute, "" = aucun
      comment: "",
      ref: null                     // ou { table: "t_users", column: "c_id", onDelete: "cascade", onUpdate: "no action" }
    }],
    indexes: [{ id: "i_1", name: "users_email_idx", columns: ["c_email"], unique: false }]
  }]
}
```

- `ref.table` et `ref.column` désignent des **id** (pas des noms) ; `column.ref` porte la clé étrangère.
- Types logiques (`TYPES`) : `increments`, `bigIncrements`, `integer`, `bigInteger`, `smallInteger`, `decimal`, `float`, `boolean`, `string`, `text`, `uuid`, `date`, `datetime`, `timestamp`, `time`, `json`, `enum`, `binary`. Chaque exporteur traduit vers le dialecte cible.
- `onDelete` / `onUpdate` : `no action` | `cascade` | `set null` | `restrict` | `set default`.
- Cardinalité : déduite (colonne FK `unique` ou PK = 1-1, sinon 1-N).
