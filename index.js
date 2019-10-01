class _Linkage {
    constructor(fromColumn, toColumn) {
        this._fromColumn = fromColumn;
        this._toColumn = toColumn;
    }

    getFromColumn() {
        return this._fromColumn;
    }

    getToColumn() {
        return this._toColumn;
    }
}

class _Node {
    constructor(tableName, primaryKeyColumn) {
        this._tableName = tableName;
        this._primaryKeyColumn = primaryKeyColumn;
    }

    getPrimaryKeyColumn() {
        return this._primaryKeyColumn;
    }

    getTableName() {
        return this._tableName;
    }


}

function _binarySearch(nodeList, tableName) {
    let lower = 0;
    let upper = nodeList.length - 1;
    while (lower !== upper) {
        const currentIndex = Math.floor((upper + lower) / 2);
        if (nodeList[currentIndex].getTableName() === tableName) {
            return currentIndex;
        }
        else if (nodeList[currentIndex].getTableName() < tableName) {
            lower = currentIndex;
        }
        else {
            upper = currentIndex;
        }
    }

    return -1;
}

function _bfs(adjacency, goalIndex, path) {
    if (path.length === 0) {
        throw new Error('path must be initialized with at least one node!');
    }

    const neighbors = new Set(adjacency[path[path.length - 1]]
        .map((neighbor, index) => ({neighbor, index}))
        .filter(x => !!x.neighbor)
        .map(x => x.index));

    if (neighbors.has(goalIndex)) {
        const newPath = path.slice();
        newPath.push(goalIndex);
        return path;
    }

    const pathSet = new Set(path);

    // prevent cycles by only exploring new paths
    const newNeighbors = neighbors.filter(n => !pathSet.has(n));

    if (newNeighbors.size === 0) {
        return null;
    }

    const pathsFromHere = [];

    newNeighbors.forEach(n => {
        const newPath = path.slice();
        newPath.push(n);

        const successfulPaths = _bfs(adjacency, goalIndex, newPath).filter(x => !!x);
        pathsFromHere.concat(successfulPaths);
    });

    return pathsFromHere;
}

function _getLinkages(adjacency, nodeIndexPath) {
    const linkages = [];

     nodeIndexPath.forEach((nodeIndex, listIndex) => {
         if (listIndex > 0) {
            linkages.push(adjacency[nodeIndexPath[listIndex - 1]][nodeIndex]);
         }
     });

    return linkages;
}

function _graphSearch(adjacency, nodes, startIndex, goalIndex) {
    const nodeIndexPaths = _bfs(adjacency, goalIndex, [startIndex]);
    const pathLinkages = nodeIndexPaths.map(nodeIndexPath => _getLinkages(adjacency, nodeIndexPath));


    return {
        nodes: nodeIndexPaths.map(nodeIndexPath => nodeIndexPath.map(ix => nodes[ix])),
        linkages: pathLinkages
    };
}

// TODO this could be injected if given non-trusted input
function _pathToQuery(nodes, linkages, schema) {

    let joinParts = [];
    for (let ix = 1; ix < nodes.length; ix++) {
        const fromNode = nodes[ix -1];
        const toNode = nodes[ix];
        const linkage = linkages[ix - 1];
        const join = `JOIN "${schema}"."${toNode.getTableName()}" 
                        ON "${schema}"."${fromNode.getTableName()}"."${linkage.getFromColumn()}" = "${schema}"."${toNode.getTableName()}"."${linkage.getToColumn()}"`;

        joinParts.push(join);
    }

    return `
        SELECT
          COUNT(1) > 0 as belongs
        FROM "${schema}"."${nodes[0].getTableName()}"
        ${joinParts.join('\n')}
        WHERE
          "${nodes[0].getTableName()}"."${nodes[0].getPrimaryKeyColumn()}" = $1
          AND "${nodes[nodes.length - 1].getTableName()}"."${nodes[nodes.length - 1].getPrimaryKeyColumn()}" = $2
    `;
}

async function buildAdjacencyMatrix(con, schema, directed) {
    const tableDataQuery = {
        text: `
            WITH foreign_keys AS (
              SELECT
                'foreign' as key_type,
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
              FROM information_schema.table_constraints AS tc 
              JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
              JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
              WHERE 
                tc.constraint_type = 'FOREIGN KEY'
                AND ccu.table_schema = $1
            ),
            primary_keys AS (
                SELECT
                  'primary' as key_type,
                  tc.table_name, 
                  kcu.column_name,
                  null AS foreign_table_name,
                  null AS foreign_column_name
              FROM information_schema.table_constraints AS tc 
              JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
              JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
              WHERE 
                tc.constraint_type = 'PRIMARY KEY'
                AND ccu.table_schema = $1
            ),
            all_tables AS (
              SELECT
                table_name
              FROM information_schema.tables 
              WHERE 
                table_schema = $1
                and table_type = 'BASE TABLE'  
            )
            SELECT 
              pk.*
            FROM primary_keys pk
            JOIN all_tables at
              ON pk.table_name = at.table_name
            
            UNION ALL
            
            SELECT
              fk.*
            FROM foreign_keys fk
            JOIN all_tables at
              ON fk.table_name = at.table_name;

        `,
        values: [schema]
    };

    const rawTableData = con.query(tableDataQuery);

    // first pass: map tables to matrix indices
    // we sort alphabetically so that we can binary search to query
    const sortedNodes = rawTableData
        .filter(t => t.key_type === 'primary')
        .sort((a ,b) => {
            return a.tableName === b.tableName ?
                0 : a.tableName > b.tableName ?
                    1 : -1;
        })
        .map(t => new _Node(t.table_name, t.column_name));

    const adjacency = Array(sortedNodes.length - 1)
        .fill(null)
        .map(() => Array(sortedNodes.length - 1).fill(null));


    const foreignKeys = rawTableData.filter(t => t.key_type === 'foreign');

    foreignKeys.forEach(fk => {
        const fromIx = _binarySearch(sortedNodes, fk.table_name);
        const toIx = _binarySearch(sortedNodes, fk.foreign_table_name);

        if (fromIx < 0 || toIx < 0) {
            throw new Error(`Unexpectedly could not find one of tables in foreign key linkage (${fk.table_name} / ${fk.foreign_table_name})`);
        }

        adjacency[fromIx][toIx] = new _Linkage(fk.column_name, fk.foreign_column_name);

        if (!directed) {
            adjacency[toIx][fromIx] = new _Linkage(fk.foreign_column_name, fk.column_name);
        }
    });


    return {
        adjacency: adjacency,
        nodes: sortedNodes
    };
}

class SchemaGraph {

    constructor(adjacency, nodes) {
        this._adjacency = adjacency;
        this._nodes = nodes;
    }

    async static fromDB(con, schema='public', directed=true) {
        return buildAdjacencyMatrix(con, schema, directed)
            .then(result => {new SchemaGraph(result.adjacency, result.nodes));
    }

    /**
     * NOTE! the first 4 arguments must come from trusted sources - are vulnerable to injection attacks in current state
     * NOTE! if multiple join paths are possible, an arbitrary selection among the shortest length paths is made.
     *
     * @param fromTable <String> the table name containing the object that belongs
     * @param fromKey the key of an object in fromTable
     * @param toTable <String> the table name containing the object that owns
     * @param toKey the key of the putative object in fromTable
     * @param con a node-postgres connection object
     * @param queryLimit if more than one sequence of joins is possible to assert a "belongs-to" relationship, impose a limit on the number of resulting queries
     */
    async belongsTo(fromTable, fromKey, toTable, toKey, con,
                    queryLimit=1) {
        const fromNodeIx = this._nodes[_binarySearch(this._adjacency, this._nodes, fromTable)];
        const toNodeIx = this._nodes[_binarySearch(this._adjacency, this._nodes, toTable)];

        const {nodes, linkages} = _graphSearch(this._adjacency, this._nodes, fromNodeIx, toNodeIx);

        // queries are run serially, to avoid pegging DB in case of large queries
        // with API additions, it would make sense to run in parallel
        for (let pathIx = 0; pathIx < Math.min(queryLimit, nodes.length); pathIx++) {
            const pathLinkages = linkages[pathIx];
            const pathNodes = nodes[pathIx];

            if (pathNodes.length === 1) {
                continue;
            }

            const statement = _pathToQuery(pathNodes, pathLinkages);
            const rs = await con.query({text: statement, values: [fromKey, toKey]});
            if (rs.rows.length && rs.rows[0].belongs) {
                return true;
            }
        }

        return false;
    }
}