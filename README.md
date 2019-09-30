# BelongSQL

Answer "belongs to" questions about your relational database. 

## About

Note, this project is in active development, with an unstable API and limited DB support (only postgres). 

While this project is obviated by ORMs, most ORMs I found were:

* heavy weight - tons of dependencies, large API to learn
* did not provide auto-schema-reading - i.e. I have to write a ton of views / configurations to do a simple task

I am using this as a stop-gap until my project grows to need an ORM, or I find a lightweight ORM satisfying current needs.

### Motivation

A common design pattern in relational databases is to create a hierarchy (directed graph) of objects. In many applications,
it is common to ask if a child object in this hierarchy belongs to parent object. BelongSQL makes answering these types 
of questions simple.  

### Example
A freelancer billing app's database may represent a <LineItem> belonging to an <Invoice> belonging to a <Task> 
belonging to a <Contractor>. Take the case that permissions to edit a <LineItem> are assigned at the <Contractor> level (so that a <Contractor> may modify only their own <LineItem>s). 
If we are implementing an API endpoint for editing invoices, say `/edit/lineitem/:id`, with cookie or body data
identifying a `contractor_id`, we would need to validate that the <LineItem> at `:id` belongs to the <Contractor> at 
`contractor_id`. To do so in raw SQL, we might write a query like:

```sql
SELECT
  COUNT(1)
FROM contractor
JOIN task
  ON task.contractor_id = contractor.id
JOIN invoice
  ON invoice.task_id = task.id
JOIN lineitem
  ON lineitem.invoice_id = invoice.id
WHERE
  contractor.id = 'x'
  AND lineitem.id = 'y'
```

Compare to BelongSQL:

```js
const graph = SchemaGraph.fromDB(connection);
graph.belongsTo('lineItem', 'x', 'contractor', 'y');
```

Notably, SchemaGraph requires 0 configuration.